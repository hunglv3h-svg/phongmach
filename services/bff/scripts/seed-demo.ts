// Nạp dữ liệu demo cho M0: hai phòng khám (mỗi phòng khám một Project + tài khoản máy), bác sĩ, bệnh nhân giả,
// cùng dị ứng, tiền sử, lượt khám cũ có đơn thuốc, và "sân khấu" hàng chờ của chính ngày seed chạy.
//
//   pnpm seed                 (cần stack Medplum đang chạy; xem infra/medplum/README.md)
//   SEED_PATIENTS=1000 pnpm seed
//   SEED_DRY_RUN=1 pnpm seed  (chỉ chạy bộ kiểm tra kịch bản, KHÔNG nối Medplum, không đọc/ghi tệp phòng khám)
//
// Chạy lại được: mọi tài nguyên tạo bằng create có điều kiện theo UUID xác định, nên không bao giờ trùng.
// Ghi .demo-tenants.json (bí mật, đã gitignore). Dữ liệu hoàn toàn là giả, không dùng dữ liệu bệnh nhân thật;
// chữ ký là MÔ PHỎNG (nhãn EXTENSIONS.simulated), CCCD giả luôn có tiền tố "000" (mã tỉnh không tồn tại),
// danh mục thuốc/ICD-10 chỉ được ĐỌC từ @phongmach/catalogs (minh họa, chưa duyệt y khoa).
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MedplumClient, OperationOutcomeError } from '@medplum/core';
import type { Bundle, BundleEntry, Patient, Practitioner } from '@medplum/fhirtypes';
import { ALLERGY_CLASSES, INGREDIENTS, getDrug, getIcd10, resolveLine, type LineInput } from '@phongmach/catalogs';
import { PRIORITIES, cleanVitals, makePrescriptionCode, vnDay, type QueuePriority, type SignedLine, type Specialty, type VitalsInput } from '@phongmach/clinical';
import { DomainError, buildPatient, clientUuidQuery, normalizePhone, parseFullName, type NewPatientInput } from '@phongmach/fhir-vn-model';
import { MedplumClinicStore } from '../src/medplum.js';
import { BusyError, type CompleteCommand, type Doctor } from '../src/store.js';
import { parseTenantsFile, type DemoUser, type Tenant, type TenantsFile } from '../src/tenants.js';
import { backfillSearchKeys } from './backfill-search-keys.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient as loginTenant } from './medplum-admin.js';

const PATIENTS_PER_CLINIC = Number(process.env['SEED_PATIENTS'] ?? 400);
const OUT = process.env['TENANTS_FILE'] ?? fileURLToPath(new URL('../.demo-tenants.json', import.meta.url));
/** Chỉ chạy bộ kiểm tra kịch bản rồi in thống kê: dùng để biết image đã build lại hay chưa, không cần Medplum. */
const DRY_RUN = process.env['SEED_DRY_RUN'] === '1';
const BATCH = 100;
const MAX_ATTEMPTS = 8;
const BACKOFF_MS = 15_000;
/**
 * Trần lời dặn do SEED tự đặt cho gọn tờ đơn. CHẶT HƠN trần của tuyến API: `completeBody.prescription.advice`
 * trong services/bff/src/routes/clinical.ts là z.string().max(1000). Trần 300 ở tuyến API là của `exam.reason`
 * và `historyBody.text`; `checkInBody.reason` là 200.
 */
const ADVICE_MAX = 300;
const REASON_MAX = 300;
const CHECK_IN_REASON_MAX = 200;
const HISTORY_MAX = 300;
const MAX_LINES = 20;

interface StoryVisit {
  /** Chỉ số trong `story` của phòng khám. */
  patient: number;
  daysAgo: number;
  /** Giờ VN (0–23) của lượt khám. Mặc định 9: để các lượt cùng ngày không trùng giờ. */
  hour?: number;
  /** Phút VN (0–59). Mặc định 0. */
  minute?: number;
  doctor: string;
  specialty: Specialty;
  /** Mã ICD-10; mã ĐẦU TIÊN quyết định bộ chữ (bảng NARRATIVE) và quy tắc sinh hiệu hô hấp. */
  dx: string[];
  lines: LineInput[];
  vitals: VitalsInput;
  /** Thời lượng phiên khám (giây) để trang "Thời gian khám" có p50/p90 phân tán. Mặc định 75. */
  seconds?: number;
}

interface TodayBase {
  /** Chỉ số trong `story`. */
  patient: number;
  /** Đến cách đây bao nhiêu phút (so với lúc seed chạy). 1…600. */
  minutesAgo: number;
  priority: QueuePriority;
}

/** Phần khám + đơn của lượt đã ký; cùng hình dạng với phần tương ứng của StoryVisit. */
type TodayExam = Pick<StoryVisit, 'dx' | 'lines' | 'vitals' | 'seconds'>;

/**
 * Hàng chờ của NGÀY SEED CHẠY. Union phân biệt theo `state` để TRÌNH BIÊN DỊCH bắt lỗi khai báo:
 * lượt 'done' không thể thiếu `exam`, lượt 'waiting' không thể có `doctor`/`openedMinutesAgo`.
 *
 * Nhánh 'done' KHÔNG có `reason` (review finding 2, phương án B): `planCompletion` ghi
 * `Encounter.reasonCode` = `exam.reason` (packages/clinical/src/visit.ts, khối `closed`), nên một câu
 * "lý do đến" khai tay cho lượt đã ký sẽ bị câu của NARRATIVE ghi đè và không bao giờ hiện ra. Vì vậy
 * lượt 'done' dùng thẳng `narrative(...).reason` cho cả `checkIn` lẫn `exam` — không có cách viết sai.
 */
type TodayVisit =
  /** 'waiting' = chỉ cấp số, chưa ai gọi vào khám. */
  | (TodayBase & { state: 'waiting'; reason: string })
  /** 'in-exam' = đã gọi vào khám, chưa ký. `openedMinutesAgo` CHỈ có nghĩa ở đây. */
  | (TodayBase & { state: 'in-exam'; reason: string; doctor: string; openedMinutesAgo?: number })
  /** 'done' = đã ký xong: `exam` BẮT BUỘC. */
  | (TodayBase & { state: 'done'; doctor: string; exam: TodayExam });

interface ClinicSpec {
  slug: string;
  name: string;
  kind: 'adult' | 'pediatric';
  users: Array<{ id: string; name: string; role: DemoUser['role']; practitioner?: boolean }>;
  story: Array<Omit<NewPatientInput, 'clientUuid'>>;
  allergies: Array<{ patient: number; kind: 'class' | 'ingredient'; value: string; label?: string }>;
  history: Array<{ patient: number; text: string }>;
  visits: StoryVisit[];
  today: TodayVisit[];
}

/**
 * Liều mặc định của danh mục KHÔNG tự áp vào dòng thuốc: `resolveLine` chỉ đọc `line.*` (chỉ `timing` lấy
 * từ `drug.defaults` — xem packages/catalogs/src/instruction.ts), nơi duy nhất hợp nhất `defaults` là giao
 * diện (apps/clinic-web/src/visit/draft.ts). Vì vậy MỌI dòng thuốc của seed phải đi qua hàm này, nếu không
 * đơn in ra sẽ thiếu cách dùng và số lượng (quy tắc `incomplete-line` severity `block`).
 */
function line(code: string, over: Partial<Omit<LineInput, 'drug'>> = {}): LineInput {
  const drug = getDrug(code);
  if (!drug) throw new Error(`Thuốc demo không có trong danh mục: ${code}`);
  const d = drug.defaults;
  return {
    drug: code,
    ...(d.perDose !== undefined ? { perDose: d.perDose } : {}),
    ...(d.timesPerDay !== undefined ? { timesPerDay: d.timesPerDay } : {}),
    ...(d.days !== undefined ? { days: d.days } : {}),
    ...over,
  };
}

// Các cách dùng viết tay dùng lại nhiều lần: thuốc `asNeeded` và `manualQuantity` không tự sinh được
// cách dùng/số lượng (xem buildInstruction/computeQuantity), nên phải truyền `quantity` + `instruction`.
const PARA_500 = { perDose: 1, quantity: 10, instruction: 'Uống 1 viên mỗi lần khi sốt hoặc đau, cách nhau ít nhất 4–6 giờ, tối đa 4 viên/ngày' };
const PARA_150 = { perDose: 1, quantity: 6, instruction: 'Uống 1 gói mỗi lần khi sốt trên 38,5 độ, cách nhau ít nhất 4–6 giờ' };
const PARA_250 = { perDose: 1, quantity: 8, instruction: 'Uống 1 gói mỗi lần khi sốt trên 38,5 độ, cách nhau ít nhất 4–6 giờ' };
const ORESOL_STOOL = { perDose: 1, quantity: 10, instruction: 'Pha 1 gói với lượng nước theo hướng dẫn trên gói, uống sau mỗi lần đi ngoài phân lỏng' };
const ORESOL_DAY = { perDose: 1, quantity: 10, instruction: 'Pha 1 gói với lượng nước theo hướng dẫn trên gói, uống rải trong ngày' };
const NOSE_DROPS = { quantity: 1, instruction: 'Nhỏ mỗi bên mũi 2–3 giọt, 3–4 lần/ngày' };
const EYE_DROPS = { quantity: 1, instruction: 'Nhỏ 1 giọt mỗi mắt, 4 lần/ngày' };
const SKIN_CREAM = { quantity: 1, instruction: 'Bôi lớp mỏng lên vùng da bệnh, 2 lần/ngày' };
const GEL_NIGHT = { quantity: 1, instruction: 'Bôi lớp mỏng lên vùng da bệnh, buổi tối' };
const GEL_MORNING = { quantity: 1, instruction: 'Bôi lớp mỏng lên vùng da bệnh, buổi sáng' };
const INHALER = { perDose: 2, quantity: 1, instruction: 'Xịt 2 nhát khi khó thở, tối đa 4 lần/ngày' };
const SYRUP = { quantity: 1, instruction: 'Uống 5 ml mỗi lần khi ho, khó thở, tối đa 3 lần/ngày' };
const VITD_DROPS = { quantity: 1, instruction: 'Nhỏ 1 giọt vào miệng mỗi ngày, buổi sáng' };

interface Narrative {
  reason: string;
  symptoms: string;
  findings: string;
  advice: string;
  followUpDays?: number;
}

/**
 * Bảng tra bộ chữ của lượt khám: CHUYÊN KHOA → mã ICD-10 chính → danh sách biến thể.
 *
 * Tách theo chuyên khoa vì cùng một mã có bộ chữ khác nhau ở người lớn và ở trẻ em (J02.9, J06.9, J30.4,
 * J45.9, A09 dùng cho cả hai phòng): dùng chung một bộ sẽ cho bệnh án nhi mang câu khám của người lớn.
 * Nhiều biến thể vì mã được dùng lại nhiều lần — I10 làm mã chính 8 lần ở phòng Nội (idx 9, 16, 24, 25,
 * 26, 29, 30, 32 ⇒ `index % 3` = 0, 1, 0, 1, 2, 2, 0, 2), trong đó BẢY lượt lịch sử là của cùng bệnh nhân
 * idx 10 (idx 16, 24, 25, 26, 29, 30, 32 ⇒ biến thể 1, 0, 1, 2, 2, 0, 2) cộng một lượt `done` hôm nay là
 * 8 lượt: một bộ chữ duy nhất sẽ làm màn "Lịch sử khám" của chính ca trình diễn trông như copy-paste.
 */
const NARRATIVE: Record<Specialty, Record<string, Narrative[]>> = {
  noi: {
    I10: [
      {
        reason: 'Tái khám huyết áp',
        symptoms: 'Không đau đầu, không chóng mặt; uống thuốc đều',
        findings: 'Tim đều, không tiếng thổi; phổi trong, không phù',
        advice: 'Uống thuốc đều mỗi sáng, giảm muối dưới 5 g/ngày, đo huyết áp tại nhà 2 lần/tuần và ghi lại.',
        followUpDays: 30,
      },
      {
        reason: 'Tái khám huyết áp định kỳ',
        symptoms: 'Thỉnh thoảng nặng đầu buổi chiều, ngủ kém',
        findings: 'Tim đều, mạch rõ hai bên; không phù chi dưới',
        advice: 'Duy trì thuốc, đi bộ 30 phút mỗi ngày, hạn chế rượu bia. Mang sổ đo huyết áp lần sau.',
        followUpDays: 30,
      },
      {
        // Review finding 7: bỏ ", xin khám lại" để khi cộng hậu tố Z76.0 không ra câu lặp
        // ("Hết thuốc huyết áp, xin khám lại, xin cấp lại đơn").
        reason: 'Hết thuốc huyết áp',
        symptoms: 'Không triệu chứng; đã hết thuốc 3 ngày',
        findings: 'Tim đều, phổi trong; cân nặng không đổi',
        advice: 'Không tự bỏ thuốc khi thấy huyết áp bình thường; tái khám trước khi hết thuốc.',
        followUpDays: 30,
      },
    ],
    'E11.9': [
      {
        reason: 'Tái khám đái tháo đường',
        symptoms: 'Khát nước ít hơn, không hạ đường huyết; ăn theo chế độ',
        findings: 'Không loét bàn chân, mạch mu chân rõ hai bên',
        advice: 'Uống metformin sau ăn, thử đường huyết đói mỗi tuần, khám mắt và bàn chân mỗi năm.',
        followUpDays: 30,
      },
    ],
    'E78.5': [
      {
        reason: 'Tái khám rối loạn lipid máu',
        symptoms: 'Không đau cơ, không mệt khi dùng thuốc',
        findings: 'Không u mỡ dưới da, gan không to',
        advice: 'Uống statin buổi tối, giảm mỡ động vật và nội tạng, tập thể dục 150 phút mỗi tuần.',
        followUpDays: 90,
      },
      {
        reason: 'Khám lại mỡ máu và gút',
        symptoms: 'Không đau khớp đợt này; ăn nhiều đạm dịp lễ',
        findings: 'Khớp bàn ngón chân không sưng nóng',
        advice: 'Hạn chế bia, thịt đỏ và hải sản; uống đủ 2 lít nước mỗi ngày.',
        followUpDays: 90,
      },
    ],
    'M10.9': [
      {
        reason: 'Đau sưng khớp bàn ngón chân',
        symptoms: 'Đau dữ dội về đêm, sưng đỏ ngón chân cái 2 ngày',
        findings: 'Khớp bàn ngón I sưng nóng đỏ, hạn chế vận động',
        advice: 'Nghỉ, kê cao chân, chườm mát; tránh bia và hải sản. Khám lại nếu đau quá 3 ngày.',
        followUpDays: 7,
      },
    ],
    'J02.9': [
      {
        reason: 'Đau họng, sốt 2 ngày',
        symptoms: 'Đau rát họng khi nuốt, sốt về chiều',
        findings: 'Họng đỏ, amidan không mủ; hạch góc hàm nhỏ',
        advice: 'Uống nhiều nước ấm, nghỉ ngơi. Tái khám nếu sốt quá 3 ngày hoặc khó thở.',
      },
    ],
    'J01.9': [
      {
        reason: 'Ngạt mũi, đau vùng mặt 5 ngày',
        symptoms: 'Chảy mũi đặc, đau nặng vùng gò má, giảm mùi',
        findings: 'Ấn đau điểm xoang hàm hai bên, niêm mạc mũi phù nề',
        advice: 'Rửa mũi bằng nước muối 3 lần/ngày; uống hết kháng sinh dù đã đỡ.',
        followUpDays: 7,
      },
    ],
    'J06.9': [
      {
        reason: 'Sổ mũi, ho 3 ngày',
        symptoms: 'Sổ mũi, ho khan, người gai lạnh',
        findings: 'Họng hơi đỏ, phổi thông khí đều hai bên',
        advice: 'Giữ ấm, uống nhiều nước. Tái khám nếu sốt cao hoặc ho nhiều hơn.',
      },
    ],
    'J30.4': [
      {
        reason: 'Hắt hơi, ngạt mũi từng cơn',
        symptoms: 'Hắt hơi buổi sáng, chảy mũi trong, ngứa mắt',
        findings: 'Niêm mạc mũi nhợt, phù nề; không mủ',
        advice: 'Tránh bụi và phấn hoa, giặt vỏ gối hằng tuần, dùng thuốc đủ đợt.',
        followUpDays: 14,
      },
      {
        reason: 'Viêm mũi dị ứng tái phát',
        symptoms: 'Ngạt mũi về đêm, ngủ không sâu, ho húng hắng',
        findings: 'Cuốn mũi dưới phù hai bên, không lệch vách ngăn',
        advice: 'Rửa mũi nước muối trước khi ngủ, không nằm điều hòa dưới 26 độ.',
        followUpDays: 14,
      },
      {
        reason: 'Ngứa mũi, chảy nước mũi khi đổi thời tiết',
        symptoms: 'Hắt hơi thành cơn, mất ngủ nhẹ',
        findings: 'Niêm mạc mũi nhợt hai bên, không hạch',
        advice: 'Giữ ấm khi ra ngoài sáng sớm; dùng thuốc đúng liều, không tự tăng liều.',
        followUpDays: 14,
      },
    ],
    'J45.9': [
      {
        reason: 'Khó thở khi gắng sức, ho đêm',
        symptoms: 'Ho về đêm, khò khè khi leo cầu thang',
        findings: 'Phổi ran rít rải rác hai bên, không co kéo',
        advice: 'Mang theo thuốc cắt cơn và xịt đúng kỹ thuật; tránh khói thuốc, bụi.',
        followUpDays: 30,
      },
    ],
    K30: [
      {
        reason: 'Đầy bụng, khó tiêu sau ăn',
        symptoms: 'Đầy hơi, ợ hơi, nhanh no; không sụt cân',
        findings: 'Bụng mềm, không điểm đau khu trú',
        advice: 'Ăn chậm, chia nhỏ bữa, tránh rượu bia và đồ chiên. Khám lại nếu sụt cân hoặc nôn.',
        followUpDays: 14,
      },
    ],
    'K21.9': [
      {
        reason: 'Nóng rát sau xương ức, ợ chua',
        symptoms: 'Ợ chua về đêm, rát sau xương ức sau ăn',
        findings: 'Bụng mềm, ấn đau nhẹ thượng vị',
        advice: 'Uống thuốc trước ăn 30 phút, không ăn trong 3 giờ trước khi ngủ, gối cao đầu.',
        followUpDays: 14,
      },
    ],
    'K29.7': [
      {
        reason: 'Đau thượng vị kéo dài',
        symptoms: 'Đau âm ỉ thượng vị, đỡ sau ăn; không nôn ra máu',
        findings: 'Ấn đau thượng vị, gan lách không to',
        advice: 'Ăn đúng giờ, bỏ rượu bia, tránh thuốc giảm đau NSAID. Khám lại nếu đau tăng.',
        followUpDays: 14,
      },
    ],
    A09: [
      {
        reason: 'Đi ngoài phân lỏng 2 ngày',
        symptoms: 'Đi ngoài 4–5 lần/ngày, đau quặn bụng, không sốt cao',
        findings: 'Bụng mềm, không phản ứng thành bụng; không dấu mất nước',
        advice: 'Uống oresol sau mỗi lần đi ngoài, ăn cháo loãng. Khám ngay nếu phân có máu.',
        followUpDays: 3,
      },
    ],
    'M54.2': [
      {
        reason: 'Đau mỏi vai cổ',
        symptoms: 'Đau mỏi vai cổ lan xuống bả vai, tăng khi ngồi lâu',
        findings: 'Co cứng cơ thang hai bên, không yếu chi',
        advice: 'Đổi tư thế mỗi 45 phút, tập giãn cổ; uống thuốc dạ dày cùng thuốc giảm đau.',
        followUpDays: 14,
      },
    ],
    'M54.5': [
      {
        reason: 'Đau vùng thắt lưng',
        symptoms: 'Đau thắt lưng sau khi bê nặng, không tê chân',
        findings: 'Ấn đau cạnh sống L4–L5, nghiệm pháp Lasegue âm tính',
        advice: 'Tránh bê nặng và cúi gập người; chườm ấm, đi lại nhẹ. Khám lại nếu tê hoặc yếu chân.',
        followUpDays: 10,
      },
    ],
    'M17.9': [
      {
        reason: 'Đau khớp gối hai bên',
        symptoms: 'Đau khi lên xuống cầu thang, cứng khớp buổi sáng',
        findings: 'Khớp gối lục cục khi vận động, không sưng nóng',
        advice: 'Giảm cân, tránh ngồi xổm và leo cầu thang nhiều; tập cơ đùi mỗi ngày.',
        followUpDays: 30,
      },
      {
        reason: 'Khám lại khớp gối',
        symptoms: 'Đau giảm hơn lần trước, đi bộ được 15 phút',
        findings: 'Gối không tràn dịch, biên độ gấp hạn chế nhẹ',
        advice: 'Duy trì bài tập cơ đùi; dùng thuốc giảm đau khi cần, uống kèm thuốc dạ dày.',
        followUpDays: 30,
      },
    ],
    'G43.9': [
      {
        reason: 'Đau nửa đầu từng cơn',
        symptoms: 'Đau nửa đầu mạch đập, sợ sáng, buồn nôn',
        findings: 'Không dấu thần kinh khu trú, đáy mắt không phù gai',
        advice: 'Ngủ đủ giờ, tránh bỏ bữa và ánh sáng chói; ghi sổ các cơn đau để lần sau xem.',
        followUpDays: 30,
      },
    ],
    'N39.0': [
      {
        reason: 'Đi tiểu buốt, tiểu nhiều lần',
        symptoms: 'Tiểu buốt, tiểu gấp, không sốt rét run',
        findings: 'Không đau hố thận, ấn đau nhẹ hạ vị',
        advice: 'Uống 2 lít nước mỗi ngày, uống hết kháng sinh. Khám ngay nếu sốt hoặc đau lưng.',
        followUpDays: 7,
      },
    ],
    'N30.0': [
      {
        reason: 'Tiểu buốt một ngày nay',
        symptoms: 'Tiểu buốt cuối bãi, nước tiểu đục',
        findings: 'Ấn đau hạ vị, không đau hố thận',
        advice: 'Uống nhiều nước, không nhịn tiểu. Khám lại nếu còn buốt sau 3 ngày.',
        followUpDays: 5,
      },
    ],
    'L70.0': [
      {
        reason: 'Mụn vùng mặt nhiều lên',
        symptoms: 'Mụn viêm hai bên má và trán, nặng hơn khi thức khuya',
        findings: 'Nhiều sẩn viêm và mụn đầu đen vùng chữ T, không sẹo lồi',
        advice: 'Rửa mặt dịu nhẹ 2 lần/ngày, bôi đúng vùng, tránh nắng; thuốc uống sau ăn.',
        followUpDays: 30,
      },
    ],
    'L50.9': [
      {
        reason: 'Nổi mày đay toàn thân',
        symptoms: 'Sẩn phù ngứa nhiều về đêm, không khó thở',
        findings: 'Sẩn phù rải rác thân mình, không phù môi mắt',
        advice: 'Tránh thức ăn lạ và thuốc giảm đau NSAID. Đi cấp cứu nếu sưng môi, khó thở.',
        followUpDays: 7,
      },
    ],
  },
  nhi: {
    'B34.9': [
      {
        reason: 'Sốt 2 ngày, ho',
        symptoms: 'Sốt 38–38,5 độ, ho khan, ăn kém hơn',
        findings: 'Họng đỏ nhẹ, phổi không ran, không ban',
        advice: 'Hạ sốt khi trên 38,5 độ, uống nhiều nước. Khám lại nếu sốt quá 3 ngày hoặc thở nhanh.',
        followUpDays: 3,
      },
    ],
    A09: [
      {
        reason: 'Đi ngoài phân lỏng 2 ngày',
        symptoms: 'Đi ngoài 5–6 lần/ngày, nôn 1 lần, trẻ vẫn chơi',
        findings: 'Môi còn ướt, mắt không trũng; bụng mềm',
        advice: 'Pha oresol đúng tỷ lệ, cho uống sau mỗi lần đi ngoài; vẫn cho ăn, không bỏ bữa.',
        followUpDays: 2,
      },
      {
        reason: 'Tiêu chảy, đau bụng',
        symptoms: 'Phân lỏng nhiều nước, đau quặn từng cơn, không sốt cao',
        findings: 'Không dấu mất nước, bụng không chướng',
        advice: 'Uống oresol, tránh nước ngọt có ga. Khám ngay nếu nôn liên tục hoặc đi tiểu ít.',
        followUpDays: 2,
      },
      {
        reason: 'Đi ngoài nhiều lần từ hôm qua',
        symptoms: 'Phân lỏng 4 lần, trẻ còn ăn uống được',
        findings: 'Trẻ tỉnh, da đàn hồi tốt, không sốt',
        advice: 'Tiếp tục ăn uống bình thường kèm oresol; rửa tay trước khi cho trẻ ăn.',
        followUpDays: 2,
      },
    ],
    'A08.4': [
      {
        reason: 'Nôn và đi ngoài từ tối qua',
        symptoms: 'Nôn 3 lần, phân lỏng nhiều nước, sốt nhẹ',
        findings: 'Không dấu mất nước, bụng mềm, không chướng',
        advice: 'Cho uống oresol từng thìa nhỏ, chờ 10 phút sau nôn. Khám lại nếu nôn liên tục.',
        followUpDays: 2,
      },
    ],
    'J02.9': [
      {
        reason: 'Đau họng, sốt',
        symptoms: 'Đau họng khi ăn, sốt 38,5 độ, quấy',
        findings: 'Họng đỏ, amidan to không mủ; hạch cổ nhỏ',
        advice: 'Uống hết kháng sinh dù đã đỡ; cho ăn mềm, uống nhiều nước.',
        followUpDays: 3,
      },
    ],
    'J03.9': [
      {
        reason: 'Sốt cao, đau họng 2 ngày',
        symptoms: 'Sốt 39 độ, đau họng nhiều, ăn kém',
        findings: 'Amidan to đỏ, có mủ trắng; hạch góc hàm đau',
        advice: 'Uống kháng sinh đủ 7 ngày, hạ sốt khi trên 38,5 độ. Khám lại nếu sau 48 giờ chưa hạ sốt.',
        followUpDays: 3,
      },
      {
        reason: 'Viêm amidan tái phát',
        symptoms: 'Đau họng, hơi thở nặng mùi, ngủ ngáy',
        findings: 'Amidan quá phát hai bên, không nhiều mủ',
        advice: 'Uống đủ đợt kháng sinh; ghi lại số đợt viêm trong năm để bác sĩ xem xét.',
        followUpDays: 7,
      },
    ],
    J00: [
      {
        reason: 'Chảy mũi, ho nhẹ',
        symptoms: 'Chảy mũi trong, ho húng hắng, không sốt',
        findings: 'Niêm mạc mũi nề nhẹ, phổi trong',
        advice: 'Nhỏ nước muối và hút mũi trước khi ăn và khi ngủ. Không cần kháng sinh.',
      },
    ],
    'J06.9': [
      {
        reason: 'Ho, sổ mũi 3 ngày',
        symptoms: 'Ho, sổ mũi, sốt nhẹ, ăn kém hơn',
        findings: 'Họng đỏ, phổi không ran, không co kéo',
        advice: 'Cho trẻ uống nhiều nước, hạ sốt khi trên 38,5 độ. Khám lại nếu thở nhanh hoặc bỏ bú.',
        followUpDays: 3,
      },
    ],
    'J20.9': [
      {
        reason: 'Ho nhiều 4 ngày',
        symptoms: 'Ho có đờm, ho nhiều về đêm, không khó thở',
        findings: 'Phổi ran ẩm rải rác, không rút lõm lồng ngực',
        advice: 'Vỗ rung nhẹ sau khi dậy, uống nhiều nước ấm. Khám ngay nếu thở nhanh hoặc tím môi.',
        followUpDays: 3,
      },
    ],
    'J05.0': [
      {
        reason: 'Khàn tiếng, ho ông ổng về đêm',
        symptoms: 'Ho như tiếng sủa, khàn tiếng, thở rít khi quấy',
        findings: 'Thở rít thanh quản khi gắng sức, không rút lõm lúc nghỉ',
        advice: 'Giữ không khí ẩm, đừng để trẻ quấy khóc nhiều. Đi cấp cứu nếu thở rít lúc nằm yên.',
        followUpDays: 2,
      },
    ],
    'J30.4': [
      {
        reason: 'Hắt hơi, ngạt mũi buổi sáng',
        symptoms: 'Hắt hơi từng cơn, chảy mũi trong, ngứa mắt',
        findings: 'Niêm mạc mũi nhợt, phù nề hai bên',
        advice: 'Rửa mũi nước muối hằng ngày, giặt vỏ gối mỗi tuần, tránh thú nhồi bông.',
        followUpDays: 14,
      },
    ],
    'J45.9': [
      {
        reason: 'Khám lại hen, ho đêm',
        symptoms: 'Ho về đêm, khò khè khi chạy nhảy',
        findings: 'Phổi ran rít nhẹ hai bên, không co kéo',
        advice: 'Dùng thuốc phòng mỗi ngày dù không có cơn; mang thuốc cắt cơn khi đi học.',
        followUpDays: 30,
      },
    ],
    'R50.9': [
      {
        reason: 'Sốt một ngày, chưa rõ nguyên nhân',
        symptoms: 'Sốt 38,8 độ, không ho, không đi ngoài lỏng',
        findings: 'Họng không đỏ, phổi trong, không ban, không cứng cổ',
        advice: 'Theo dõi sát, hạ sốt và bù nước. Khám lại trong 24 giờ nếu còn sốt hoặc nổi ban.',
        followUpDays: 1,
      },
    ],
    'K59.0': [
      {
        reason: 'Đi ngoài khó, 3 ngày một lần',
        symptoms: 'Phân khô cứng, đau khi đi, sợ đi ngoài',
        findings: 'Bụng mềm, sờ thấy khối phân hố chậu trái',
        advice: 'Tăng rau và nước, tập đi ngoài sau bữa sáng; không tự dùng thuốc nhuận kéo dài.',
        followUpDays: 14,
      },
    ],
    'K00.7': [
      {
        reason: 'Quấy, chảy nước dãi nhiều',
        symptoms: 'Quấy về đêm, hay cho tay vào miệng, ăn kém',
        findings: 'Nướu vùng răng sắp mọc nề đỏ, không ổ mủ',
        advice: 'Cho trẻ gặm vòng mát; hạ sốt khi trên 38,5 độ. Không bôi thuốc tê lên nướu.',
      },
    ],
    'H10.9': [
      {
        reason: 'Mắt đỏ, nhiều dử',
        symptoms: 'Mắt đỏ hai bên, dử dính mi buổi sáng, không đau nhức',
        findings: 'Kết mạc cương tụ, giác mạc trong, không giảm thị lực',
        advice: 'Lau mắt bằng gạc sạch riêng từng mắt, không dùng chung khăn; nghỉ học 3 ngày.',
        followUpDays: 3,
      },
    ],
    'H66.9': [
      {
        reason: 'Đau tai, sốt sau đợt cảm',
        symptoms: 'Đau tai phải, quấy đêm, nghe kém hơn',
        findings: 'Màng nhĩ đỏ, phồng nhẹ, không chảy dịch',
        advice: 'Uống đủ đợt kháng sinh, không nhỏ gì vào tai. Khám lại nếu tai chảy dịch.',
        followUpDays: 7,
      },
    ],
    'B08.4': [
      {
        reason: 'Loét miệng, nổi ban tay chân',
        symptoms: 'Ăn kém vì đau miệng, sốt nhẹ, ban ở tay chân',
        findings: 'Vài nốt loét niêm mạc miệng, ban dạng nước lòng bàn tay chân',
        advice: 'Cho ăn nguội và mềm, uống nhiều nước. Đi cấp cứu nếu giật mình chới với, nôn nhiều, sốt cao khó hạ.',
        followUpDays: 2,
      },
    ],
    'L20.9': [
      {
        reason: 'Khô, ngứa da vùng khoeo',
        symptoms: 'Ngứa nhiều về đêm, trẻ cào xước da',
        findings: 'Da khô, mảng đỏ bong vảy vùng khoeo và khuỷu; không bội nhiễm',
        advice: 'Dưỡng ẩm 2 lần/ngày sau tắm, tắm nước ấm vừa, mặc cotton; bôi thuốc đúng đợt.',
        followUpDays: 14,
      },
    ],
    'D50.9': [
      {
        reason: 'Da xanh, hay mệt',
        symptoms: 'Mệt khi chạy nhảy, ăn ít thịt, kém tập trung',
        findings: 'Da lòng bàn tay nhợt, gan lách không to',
        advice: 'Uống sắt lúc đói kèm nước cam, không uống cùng sữa; ăn thêm thịt đỏ và rau xanh.',
        followUpDays: 30,
      },
    ],
    'E55.9': [
      {
        reason: 'Khám sức khỏe, ra mồ hôi đêm nhiều',
        symptoms: 'Ra mồ hôi đầu khi ngủ, ngủ không sâu; ít ra nắng',
        findings: 'Thóp đã kín, không biến dạng xương; cân nặng theo tuổi bình thường',
        advice: 'Cho trẻ ra nắng sớm 15 phút mỗi ngày, nhỏ vitamin D đúng liều mỗi sáng.',
        followUpDays: 30,
      },
    ],
  },
};

/** Chọn biến thể theo chỉ số lượt: xác định, chạy lại ra cùng kết quả, và kiểm được bằng tay. */
function narrative(specialty: Specialty, dx: string[], index: number): Narrative {
  const variants = NARRATIVE[specialty][dx[0]!];
  if (!variants?.length) throw new Error(`Chưa có bộ chữ mẫu cho mã ${dx[0]} (${specialty})`);
  const n = variants[index % variants.length]!;
  // Z76.0 (cấp lại đơn) KHÔNG bao giờ là mã đầu tiên; nó chỉ thêm hậu tố vào lý do khám.
  return dx.includes('Z76.0') ? { ...n, reason: `${n.reason}, xin cấp lại đơn` } : n;
}

/**
 * Cân nặng theo BỆNH NHÂN (khóa = chỉ số trong `story`), không theo lượt: review finding 12 đòi cân của
 * cùng một người không lệch quá 10 % giữa các lượt gần nhau, và cách rẻ nhất để bảo đảm điều đó theo cấu
 * trúc là một bảng hằng. Mọi lượt của người đó dùng đúng giá trị này.
 */
const WEIGHT_NOI: Record<number, number> = {
  0: 68, 1: 62, 2: 54, 3: 72, 4: 58, 5: 51, 6: 56, 7: 64, 8: 70, 9: 66, 10: 61, 11: 78, 12: 49, 13: 74, 14: 52,
};
/** Cân theo tuổi (mục 7.5 của thiết kế): 3 t → 14; 4 t → 16; 5 t → 17,5; 6 t → 20; 7 t → 22; 8 t → 25; 10 t → 32 kg. */
const WEIGHT_NHI: Record<number, number> = {
  0: 17.5, 1: 22, 2: 25, 3: 32, 4: 20, 5: 25, 6: 32, 7: 16, 8: 32, 9: 14, 10: 32,
};

const CLINICS: ClinicSpec[] = [
  {
    slug: 'noi-tong-quat',
    name: 'Phòng khám Nội tổng quát (demo)',
    kind: 'adult',
    users: [
      { id: 'noi-owner', name: 'BS. Trần Quốc Hưng (chủ phòng khám)', role: 'owner', practitioner: true },
      { id: 'noi-doctor', name: 'BS. Lê Thị Thu Hà', role: 'doctor', practitioner: true },
      { id: 'noi-assistant', name: 'Phụ tá Nguyễn Thị Lan', role: 'assistant' },
    ],
    // Bệnh nhân dùng trong kịch bản trình diễn: tìm theo tên không dấu, 4 số cuối, CCCD; có ca trùng và
    // gần trùng họ tên để chứng minh độ chính xác của ô tìm kiếm.
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI**: khóa xác định tính theo CHỈ SỐ (`<slug>:story:<i>`), chèn/xóa/đảo giữa
    // mảng sẽ đổi khóa của mọi mục sau nó và sinh bản trùng trên tenant đã seed.
    story: [
      { fullName: 'Nguyễn Văn An', phone: '0912345678', cccd: '000123456789', birthDate: '1985-03-15', gender: 'male' },
      { fullName: 'Nguyễn Văn Ân', phone: '0903115678', cccd: '000987654321', birthDate: '1991-11-02', gender: 'male' },
      { fullName: 'Trần Thị Bình', phone: '0987665678', cccd: '000555444333', birthDate: '1972-08-20', gender: 'female' },
      // Trùng tên hoàn toàn với idx 0 nhưng nhập KHÔNG DẤU — chủ ý, để demo tìm "nguyen van an".
      { fullName: 'Nguyen Van An', phone: '0913451234', cccd: '000112233445', birthDate: '1979-07-04', gender: 'male' },
      { fullName: 'Nguyễn Văn Ánh', phone: '0918881234', cccd: '000223344556', birthDate: '1996-02-29', gender: 'male' },
      { fullName: 'Nguyễn Vân Anh', phone: '0938881234', cccd: '000334455667', birthDate: '1990-05-12', gender: 'female' },
      { fullName: 'Nguyễn Thị An', phone: '0909991234', cccd: '000445566778', birthDate: '1968-09-30', gender: 'female' },
      { fullName: 'Nguyễn Văn Anh', phone: '0977771234', cccd: '000556677889', birthDate: '2001-12-01', gender: 'male' },
      { fullName: 'Trần Văn An', phone: '0966661234', cccd: '000667788990', birthDate: '1983-04-18', gender: 'male' },
      { fullName: 'Phạm Văn An', phone: '0944335678', cccd: '000778899001', birthDate: '1958-11-11', gender: 'male' },
      { fullName: 'Võ Thị Kim Chi', phone: '0905557788', cccd: '000889900112', birthDate: '1965-06-05', gender: 'female' },
      { fullName: 'Hoàng Minh Tuấn', phone: '0912227788', cccd: '000990011223', birthDate: '1977-01-23', gender: 'male' },
      { fullName: 'Đỗ Thị Hạnh', phone: '0988447788', cccd: '000101112131', birthDate: '1949-03-08', gender: 'female' },
      { fullName: 'Bùi Quốc Thắng', phone: '0933117788', cccd: '000121314151', birthDate: '1988-08-08', gender: 'male' },
      { fullName: 'Lý Thị Thu Hiền', phone: '0977229999', cccd: '000131415161', birthDate: '1994-10-10', gender: 'female' },
    ],
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI** (khóa `<slug>:allergy:<i>`).
    // Không đơn thuốc nào trong seed được chứa thuốc xung đột với dị ứng của chính bệnh nhân đó
    // (`validateScenario` soát theo đúng ngữ nghĩa `checkPrescription`): cảnh báo dị ứng được trình diễn
    // trực tiếp trên sân khấu khi bác sĩ thêm thuốc xung đột, không bằng dữ liệu bẩn.
    allergies: [
      { patient: 0, kind: 'class', value: 'penicillin' },
      { patient: 2, kind: 'class', value: 'nsaid' },
      { patient: 1, kind: 'ingredient', value: 'sulfamethoxazol' },
      { patient: 3, kind: 'class', value: 'nsaid' },
      { patient: 5, kind: 'class', value: 'quinolone' },
      { patient: 6, kind: 'ingredient', value: 'azithromycin' },
      { patient: 9, kind: 'class', value: 'sulfonamide' },
      { patient: 10, kind: 'class', value: 'macrolide' },
      { patient: 12, kind: 'class', value: 'salicylate' },
      { patient: 13, kind: 'class', value: 'tetracycline' },
      { patient: 14, kind: 'class', value: 'nsaid' },
    ],
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI** (khóa `<slug>:history:<i>`).
    history: [
      { patient: 0, text: 'Tăng huyết áp 3 năm, đang dùng amlodipin' },
      { patient: 2, text: 'Viêm mũi dị ứng theo mùa' },
      { patient: 3, text: 'Hút thuốc 10 điếu/ngày, chưa bỏ được' },
      { patient: 5, text: 'Hai lần nhiễm khuẩn tiết niệu trong năm nay' },
      { patient: 6, text: 'Thoái hóa cột sống cổ, đau tái phát khi làm việc máy tính lâu' },
      { patient: 8, text: 'Hen phế quản từ nhỏ, dùng salbutamol khi lên cơn' },
      { patient: 9, text: 'Đái tháo đường typ 2 10 năm, tăng huyết áp; đã bỏ thuốc lá 5 năm' },
      { patient: 10, text: 'Tăng huyết áp 8 năm; đái tháo đường typ 2 phát hiện 2021, đang dùng metformin' },
      { patient: 11, text: 'Rối loạn lipid máu; cơn gút cấp khoảng 2 lần mỗi năm' },
      { patient: 12, text: 'Thoái hóa khớp gối hai bên; đau thắt lưng tái phát nhiều năm' },
      { patient: 13, text: 'Viêm dạ dày HP dương tính, đã điều trị diệt HP năm 2023' },
      { patient: 14, text: 'Viêm mũi dị ứng quanh năm, mày đay tái phát' },
    ],
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI** (khóa `<slug>:visit:<i>:in` và `:done`). Thứ tự `daysAgo` tăng dần chỉ là
    // tiện lợi một lần; bất biến "chỉ thêm vào cuối" mạnh hơn nó.
    // `spo2` (phòng Nội KHÔNG ghi `respiratoryRate`) có mặt đúng và chỉ đúng ở các lượt có `dx[0]` bắt đầu
    // bằng J hoặc là R50.9: idx 0, 2, 3, 6, 7, 14, 17, 20, 28. `spo2: 98` của idx 0 và 2 được thêm theo
    // phương án A của review finding 1 (sửa nội dung mục đã seed không có tác dụng trên tenant cũ nên an
    // toàn, mà quy tắc soát hai chiều vẫn áp cho TOÀN BỘ dữ liệu).
    visits: [
      {
        patient: 0, daysAgo: 45, hour: 9, minute: 10, doctor: 'noi-doctor', specialty: 'noi', seconds: 75,
        vitals: { temperatureC: 36.8, pulse: 78, systolic: 128, diastolic: 82, spo2: 98, weightKg: WEIGHT_NOI[0]! }, dx: ['J06.9'],
        lines: [line('PARACETAMOL-500-MG', PARA_500), line('CETIRIZIN-10-MG')],
      },
      {
        patient: 0, daysAgo: 35, hour: 9, minute: 40, doctor: 'noi-doctor', specialty: 'noi', seconds: 75,
        vitals: { pulse: 74, systolic: 135, diastolic: 85, weightKg: WEIGHT_NOI[0]! }, dx: ['I10'],
        lines: [line('AMLODIPIN-5-MG')],
      },
      {
        patient: 2, daysAgo: 40, hour: 10, minute: 20, doctor: 'noi-doctor', specialty: 'noi', seconds: 75,
        vitals: { temperatureC: 36.6, pulse: 72, systolic: 118, diastolic: 76, spo2: 98, weightKg: WEIGHT_NOI[2]! }, dx: ['J30.4'],
        lines: [line('CETIRIZIN-10-MG', { days: 14 })],
      },
      {
        patient: 2, daysAgo: 1, hour: 8, minute: 45, doctor: 'noi-doctor', specialty: 'noi', seconds: 38,
        vitals: { temperatureC: 36.6, pulse: 74, systolic: 118, diastolic: 76, spo2: 98, weightKg: WEIGHT_NOI[2]! }, dx: ['J30.4', 'Z76.0'],
        lines: [line('CETIRIZIN-10-MG', { days: 14 })],
      },
      {
        patient: 1, daysAgo: 2, hour: 15, minute: 40, doctor: 'noi-owner', specialty: 'noi', seconds: 56,
        vitals: { temperatureC: 37.4, pulse: 84, systolic: 124, diastolic: 78, weightKg: WEIGHT_NOI[1]! }, dx: ['N39.0'],
        lines: [line('CEFIXIM-200-MG')],
      },
      {
        patient: 9, daysAgo: 2, hour: 10, minute: 40, doctor: 'noi-doctor', specialty: 'noi', seconds: 116,
        vitals: { temperatureC: 36.7, pulse: 78, systolic: 142, diastolic: 88, weightKg: WEIGHT_NOI[9]! }, dx: ['E11.9', 'I10'],
        lines: [line('METFORMIN-850-MG'), line('LOSARTAN-50-MG'), line('ATORVASTATIN-20-MG')],
      },
      {
        patient: 8, daysAgo: 3, hour: 8, minute: 55, doctor: 'noi-owner', specialty: 'noi', seconds: 70,
        vitals: { temperatureC: 36.8, pulse: 88, systolic: 126, diastolic: 80, spo2: 96, weightKg: WEIGHT_NOI[8]! }, dx: ['J45.9'],
        lines: [line('SALBUTAMOL-100-MCG-LIEU-BINH-XIT', INHALER), line('MONTELUKAST-10-MG', { days: 30 })],
      },
      {
        patient: 14, daysAgo: 3, hour: 11, minute: 20, doctor: 'noi-doctor', specialty: 'noi', seconds: 52,
        vitals: { temperatureC: 36.5, pulse: 72, systolic: 116, diastolic: 74, spo2: 98, weightKg: WEIGHT_NOI[14]! }, dx: ['J30.4', 'Z76.0'],
        lines: [line('MONTELUKAST-10-MG'), line('FEXOFENADIN-180-MG', { days: 14 })],
      },
      {
        patient: 5, daysAgo: 4, hour: 16, minute: 20, doctor: 'noi-owner', specialty: 'noi', seconds: 41,
        vitals: { temperatureC: 37, pulse: 80, systolic: 120, diastolic: 78, weightKg: WEIGHT_NOI[5]! }, dx: ['N30.0'],
        lines: [line('FOSFOMYCIN-3-G')],
      },
      {
        patient: 0, daysAgo: 5, hour: 9, minute: 5, doctor: 'noi-doctor', specialty: 'noi', seconds: 47,
        vitals: { temperatureC: 36.6, pulse: 76, systolic: 138, diastolic: 86, weightKg: WEIGHT_NOI[0]! }, dx: ['I10', 'Z76.0'],
        lines: [line('AMLODIPIN-5-MG'), line('ATORVASTATIN-20-MG')],
      },
      {
        patient: 7, daysAgo: 6, hour: 17, minute: 5, doctor: 'noi-doctor', specialty: 'noi', seconds: 92,
        vitals: { temperatureC: 36.7, pulse: 82, systolic: 122, diastolic: 78, weightKg: WEIGHT_NOI[7]! }, dx: ['L70.0'],
        lines: [line('ADAPALEN-0-1-GEL', GEL_NIGHT), line('BENZOYL-PEROXID-2-5-GEL', GEL_MORNING), line('DOXYCYCLIN-100-MG', { days: 14 })],
      },
      {
        patient: 12, daysAgo: 6, hour: 9, minute: 50, doctor: 'noi-owner', specialty: 'noi', seconds: 104,
        vitals: { temperatureC: 36.5, pulse: 70, systolic: 130, diastolic: 82, weightKg: WEIGHT_NOI[12]! }, dx: ['M17.9', 'Z76.0'],
        lines: [line('GLUCOSAMIN-500-MG'), line('CALCI-CARBONAT-VITAMIN-D3')],
      },
      {
        patient: 4, daysAgo: 7, hour: 11, minute: 0, doctor: 'noi-doctor', specialty: 'noi', seconds: 61,
        vitals: { temperatureC: 36.6, pulse: 78, systolic: 118, diastolic: 76, weightKg: WEIGHT_NOI[4]! }, dx: ['K30'],
        lines: [line('OMEPRAZOL-20-MG'), line('SIMETHICON-40-MG')],
      },
      {
        patient: 13, daysAgo: 8, hour: 14, minute: 35, doctor: 'noi-doctor', specialty: 'noi', seconds: 44,
        vitals: { temperatureC: 36.8, pulse: 80, systolic: 124, diastolic: 80, weightKg: WEIGHT_NOI[13]! }, dx: ['K21.9'],
        lines: [line('ESOMEPRAZOL-40-MG'), line('DOMPERIDON-10-MG')],
      },
      {
        patient: 2, daysAgo: 9, hour: 10, minute: 15, doctor: 'noi-doctor', specialty: 'noi', seconds: 76,
        vitals: { temperatureC: 37.6, pulse: 86, systolic: 120, diastolic: 78, spo2: 97, weightKg: WEIGHT_NOI[2]! }, dx: ['J01.9'],
        lines: [line('CEFUROXIM-500-MG'), line('ACETYLCYSTEIN-200-MG'), line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS)],
      },
      {
        patient: 6, daysAgo: 10, hour: 9, minute: 30, doctor: 'noi-doctor', specialty: 'noi', seconds: 64,
        vitals: { temperatureC: 36.5, pulse: 74, systolic: 126, diastolic: 80, weightKg: WEIGHT_NOI[6]! }, dx: ['M54.2'],
        lines: [line('MELOXICAM-7-5-MG'), line('EPERISON-50-MG'), line('OMEPRAZOL-20-MG', { days: 5 })],
      },
      {
        patient: 10, daysAgo: 10, hour: 8, minute: 30, doctor: 'noi-owner', specialty: 'noi', seconds: 84,
        vitals: { temperatureC: 36.6, pulse: 76, systolic: 145, diastolic: 90, weightKg: WEIGHT_NOI[10]! }, dx: ['I10', 'E11.9', 'Z76.0'],
        lines: [line('AMLODIPIN-5-MG'), line('METFORMIN-500-MG'), line('ATORVASTATIN-20-MG')],
      },
      {
        patient: 3, daysAgo: 11, hour: 14, minute: 10, doctor: 'noi-owner', specialty: 'noi', seconds: 50,
        vitals: { temperatureC: 37.8, pulse: 88, systolic: 122, diastolic: 78, spo2: 97, weightKg: WEIGHT_NOI[3]! }, dx: ['J06.9'],
        lines: [line('PARACETAMOL-500-MG', PARA_500), line('CETIRIZIN-10-MG'), line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS)],
      },
      {
        patient: 13, daysAgo: 11, hour: 10, minute: 5, doctor: 'noi-owner', specialty: 'noi', seconds: 58,
        vitals: { temperatureC: 36.6, pulse: 72, systolic: 118, diastolic: 76, weightKg: WEIGHT_NOI[13]! }, dx: ['G43.9'],
        lines: [line('FLUNARIZIN-5-MG'), line('PARACETAMOL-500-MG', PARA_500)],
      },
      {
        patient: 11, daysAgo: 12, hour: 15, minute: 10, doctor: 'noi-doctor', specialty: 'noi', seconds: 148,
        vitals: { temperatureC: 36.7, pulse: 78, systolic: 128, diastolic: 82, weightKg: WEIGHT_NOI[11]! }, dx: ['E78.5', 'Z76.0'],
        lines: [line('ATORVASTATIN-20-MG'), line('ALLOPURINOL-300-MG')],
      },
      {
        patient: 0, daysAgo: 13, hour: 8, minute: 20, doctor: 'noi-doctor', specialty: 'noi', seconds: 54,
        vitals: { temperatureC: 38.2, pulse: 92, systolic: 126, diastolic: 80, spo2: 97, weightKg: WEIGHT_NOI[0]! }, dx: ['J02.9'],
        lines: [line('AZITHROMYCIN-500-MG'), line('PARACETAMOL-500-MG', PARA_500)],
      },
      {
        // Phiên bỏ dở có chủ ý (> 30 phút): để cột "Phiên bị loại" của trang "Thời gian khám" có số khác 0.
        patient: 12, daysAgo: 13, hour: 16, minute: 45, doctor: 'noi-doctor', specialty: 'noi', seconds: 1920,
        vitals: { temperatureC: 36.5, pulse: 72, systolic: 128, diastolic: 82, weightKg: WEIGHT_NOI[12]! }, dx: ['M54.5'],
        lines: [line('MELOXICAM-7-5-MG'), line('EPERISON-50-MG'), line('OMEPRAZOL-20-MG', { days: 5 })],
      },
      {
        patient: 1, daysAgo: 20, hour: 17, minute: 15, doctor: 'noi-owner', specialty: 'noi', seconds: 53,
        vitals: { temperatureC: 37.2, pulse: 84, systolic: 116, diastolic: 74, weightKg: WEIGHT_NOI[1]! }, dx: ['A09'],
        lines: [line('ORESOL-MUOI-BU-NUOC', ORESOL_STOOL), line('RACECADOTRIL-100-MG', { days: 3 }), line('MEN-VI-SINH-LACTOBACILLUS')],
      },
      {
        patient: 14, daysAgo: 25, hour: 11, minute: 35, doctor: 'noi-doctor', specialty: 'noi', seconds: 62,
        vitals: { temperatureC: 36.6, pulse: 80, systolic: 118, diastolic: 76, weightKg: WEIGHT_NOI[14]! }, dx: ['L50.9'],
        lines: [line('DESLORATADIN-5-MG'), line('HYDROCORTISON-1-KEM', SKIN_CREAM)],
      },
      {
        patient: 10, daysAgo: 30, hour: 8, minute: 40, doctor: 'noi-doctor', specialty: 'noi', seconds: 46,
        vitals: { temperatureC: 36.5, pulse: 74, systolic: 148, diastolic: 92, weightKg: WEIGHT_NOI[10]! }, dx: ['I10', 'E11.9'],
        lines: [line('AMLODIPIN-5-MG'), line('METFORMIN-500-MG')],
      },
      {
        patient: 10, daysAgo: 60, hour: 9, minute: 15, doctor: 'noi-owner', specialty: 'noi', seconds: 53,
        vitals: { temperatureC: 36.6, pulse: 78, systolic: 150, diastolic: 92, weightKg: WEIGHT_NOI[10]! }, dx: ['I10', 'E11.9', 'Z76.0'],
        lines: [line('AMLODIPIN-5-MG'), line('METFORMIN-500-MG'), line('ATORVASTATIN-20-MG')],
      },
      {
        patient: 10, daysAgo: 90, hour: 8, minute: 25, doctor: 'noi-doctor', specialty: 'noi', seconds: 62,
        vitals: { temperatureC: 36.7, pulse: 76, systolic: 152, diastolic: 94, weightKg: WEIGHT_NOI[10]! }, dx: ['I10', 'E11.9'],
        lines: [line('AMLODIPIN-5-MG'), line('METFORMIN-500-MG')],
      },
      {
        patient: 11, daysAgo: 95, hour: 16, minute: 0, doctor: 'noi-doctor', specialty: 'noi', seconds: 113,
        vitals: { temperatureC: 36.8, pulse: 82, systolic: 130, diastolic: 84, weightKg: WEIGHT_NOI[11]! }, dx: ['M10.9'],
        lines: [line('ETORICOXIB-60-MG'), line('OMEPRAZOL-20-MG', { days: 5 })],
      },
      {
        patient: 14, daysAgo: 110, hour: 10, minute: 50, doctor: 'noi-doctor', specialty: 'noi', seconds: 46,
        vitals: { temperatureC: 36.5, pulse: 74, systolic: 116, diastolic: 74, spo2: 98, weightKg: WEIGHT_NOI[14]! }, dx: ['J30.4'],
        lines: [line('FEXOFENADIN-180-MG'), line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS)],
      },
      {
        patient: 10, daysAgo: 120, hour: 10, minute: 30, doctor: 'noi-owner', specialty: 'noi', seconds: 71,
        vitals: { temperatureC: 36.6, pulse: 80, systolic: 155, diastolic: 95, weightKg: WEIGHT_NOI[10]! }, dx: ['I10', 'Z76.0'],
        lines: [line('AMLODIPIN-5-MG'), line('METFORMIN-500-MG'), line('ATORVASTATIN-20-MG')],
      },
      {
        patient: 10, daysAgo: 150, hour: 9, minute: 0, doctor: 'noi-doctor', specialty: 'noi', seconds: 88,
        vitals: { temperatureC: 36.5, pulse: 78, systolic: 150, diastolic: 90, weightKg: WEIGHT_NOI[10]! }, dx: ['I10', 'E11.9'],
        lines: [line('AMLODIPIN-5-MG'), line('METFORMIN-500-MG')],
      },
      {
        patient: 13, daysAgo: 160, hour: 15, minute: 25, doctor: 'noi-owner', specialty: 'noi', seconds: 79,
        vitals: { temperatureC: 36.7, pulse: 76, systolic: 122, diastolic: 78, weightKg: WEIGHT_NOI[13]! }, dx: ['K29.7'],
        lines: [line('OMEPRAZOL-20-MG'), line('DOMPERIDON-10-MG'), line('NHOM-HYDROXYD-MAGNESI-HYDROXYD')],
      },
      {
        patient: 10, daysAgo: 180, hour: 11, minute: 10, doctor: 'noi-owner', specialty: 'noi', seconds: 97,
        vitals: { temperatureC: 36.6, pulse: 74, systolic: 140, diastolic: 88, weightKg: WEIGHT_NOI[10]! }, dx: ['I10'],
        lines: [line('AMLODIPIN-5-MG')],
      },
      {
        patient: 12, daysAgo: 200, hour: 9, minute: 40, doctor: 'noi-doctor', specialty: 'noi', seconds: 67,
        vitals: { temperatureC: 36.5, pulse: 72, systolic: 126, diastolic: 80, weightKg: WEIGHT_NOI[12]! }, dx: ['M17.9'],
        lines: [line('MELOXICAM-7-5-MG'), line('OMEPRAZOL-20-MG', { days: 5 }), line('GLUCOSAMIN-500-MG')],
      },
      {
        patient: 11, daysAgo: 240, hour: 14, minute: 50, doctor: 'noi-owner', specialty: 'noi', seconds: 59,
        vitals: { temperatureC: 36.7, pulse: 78, systolic: 130, diastolic: 84, weightKg: WEIGHT_NOI[11]! }, dx: ['E78.5', 'M10.9'],
        lines: [line('ATORVASTATIN-20-MG'), line('ALLOPURINOL-300-MG')],
      },
    ],
    // Sân khấu của NGÀY SEED CHẠY (khóa có `vnDay(now)` nên mỗi ngày dựng lại một hàng chờ mới).
    today: [
      {
        patient: 10, minutesAgo: 55, priority: 'appointment', state: 'done', doctor: 'noi-doctor',
        exam: {
          dx: ['I10', 'E11.9', 'Z76.0'], seconds: 57,
          vitals: { temperatureC: 36.6, pulse: 76, systolic: 146, diastolic: 90, weightKg: WEIGHT_NOI[10]! },
          lines: [line('AMLODIPIN-5-MG'), line('METFORMIN-500-MG'), line('ATORVASTATIN-20-MG')],
        },
      },
      {
        patient: 0, minutesAgo: 40, priority: 'normal', state: 'done', doctor: 'noi-owner',
        exam: {
          dx: ['I10'], seconds: 110,
          vitals: { temperatureC: 36.7, pulse: 78, systolic: 140, diastolic: 88, weightKg: WEIGHT_NOI[0]! },
          lines: [line('AMLODIPIN-5-MG')],
        },
      },
      { patient: 3, minutesAgo: 22, priority: 'normal', state: 'in-exam', doctor: 'noi-doctor', openedMinutesAgo: 3, reason: 'Ho, đau họng 2 ngày' },
      { patient: 6, minutesAgo: 15, priority: 'appointment', state: 'waiting', reason: 'Đau vai cổ, đã hẹn sáng nay' },
      { patient: 8, minutesAgo: 9, priority: 'normal', state: 'waiting', reason: 'Khó thở nhẹ khi gắng sức' },
      { patient: 12, minutesAgo: 4, priority: 'urgent', state: 'waiting', reason: 'Đau ngực, mệt nhiều' },
    ],
  },
  {
    slug: 'nhi',
    name: 'Phòng khám Nhi (demo)',
    kind: 'pediatric',
    // KHÔNG thêm người dùng mới vào đây: `reuseExisting()` dùng lại .demo-tenants.json và không bổ sung
    // người dùng, nên trên tenant đã tạo `file.users.find(...)` sẽ trả undefined và seed chết.
    // `validateScenario` có một phép kiểm báo rõ việc này bằng tiếng Việt.
    users: [
      { id: 'nhi-owner', name: 'BS. Phạm Thanh Mai (chủ phòng khám)', role: 'owner', practitioner: true },
      { id: 'nhi-assistant', name: 'Phụ tá Võ Thị Hạnh', role: 'assistant' },
    ],
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI**. Không ai có CCCD (đều dưới 14 tuổi — quy tắc `cccdMinAgeYears: 14`);
    // điện thoại là của người đưa trẻ đi khám. Có hai cặp trùng tên hoàn toàn (idx 0/6, idx 1/8).
    story: [
      { fullName: 'Lê Minh Khang', phone: '0934567890', birthDate: '2021-06-10', gender: 'male' },
      { fullName: 'Đặng Bảo Ngọc', phone: '0976543210', birthDate: '2019-01-25', gender: 'female' },
      { fullName: 'Nguyễn Văn Khoa', phone: '0911112345', birthDate: '2018-03-12', gender: 'male' },
      { fullName: 'Nguyễn Văn Khôi', phone: '0922222345', birthDate: '2016-07-22', gender: 'male' },
      { fullName: 'Nguyễn Vân Khanh', phone: '0933332345', birthDate: '2020-09-09', gender: 'female' },
      { fullName: 'Trần Minh Khang', phone: '0944442345', birthDate: '2017-11-30', gender: 'male' },
      { fullName: 'Lê Minh Khang', phone: '0955552345', birthDate: '2016-02-14', gender: 'male' },
      { fullName: 'Phạm Bảo Ngọc', phone: '0966662345', birthDate: '2022-04-01', gender: 'female' },
      { fullName: 'Đặng Bảo Ngọc', phone: '0912343210', birthDate: '2015-12-05', gender: 'female' },
      { fullName: 'Hoàng Gia Bảo', phone: '0977772345', birthDate: '2023-08-19', gender: 'male' },
      { fullName: 'Vũ Ngọc Diệp', phone: '0988882345', birthDate: '2016-05-06', gender: 'female' },
    ],
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI**.
    allergies: [
      { patient: 1, kind: 'class', value: 'cephalosporin' },
      { patient: 2, kind: 'ingredient', value: 'ibuprofen' },
      { patient: 3, kind: 'class', value: 'nsaid' },
      { patient: 5, kind: 'class', value: 'penicillin' },
      { patient: 8, kind: 'ingredient', value: 'amoxicillin' },
      { patient: 9, kind: 'class', value: 'cephalosporin' },
      { patient: 10, kind: 'class', value: 'sulfonamide' },
    ],
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI**.
    history: [
      { patient: 0, text: 'Sinh đủ tháng, tiêm chủng đủ theo lịch' },
      { patient: 1, text: 'Viêm amidan tái đi tái lại khoảng 4 lần mỗi năm' },
      { patient: 3, text: 'Viêm mũi dị ứng theo mùa; bố có hen phế quản' },
      { patient: 5, text: 'Viêm da cơ địa từ 6 tháng tuổi, bùng phát khi trời lạnh' },
      { patient: 6, text: 'Hen phế quản bậc nhẹ, theo dõi từ năm 2024' },
      { patient: 8, text: 'Thiếu máu thiếu sắt, đã bổ sung sắt 3 tháng' },
      { patient: 9, text: 'Sinh non 35 tuần, cân nặng lúc sinh 2,3 kg' },
      { patient: 10, text: 'Cận thị 1,5 D hai mắt, đeo kính từ năm 2025' },
    ],
    // **CHỈ ĐƯỢC THÊM VÀO CUỐI**. Phòng Nhi ghi CẢ `respiratoryRate` và `spo2` ở các lượt có `dx[0]` bắt
    // đầu bằng J hoặc là R50.9: idx 0, 2, 5, 6, 7, 8, 11, 12, 13, 15, 18. `respiratoryRate: 28` của idx 0
    // được thêm theo phương án A của review finding 1 (xem chú thích tương ứng ở phòng Nội).
    // KHÔNG ghi huyết áp cho trẻ; trẻ dưới 6 tuổi (BN idx 0, 7, 9) chỉ dùng dạng gói/siro/giọt hoặc thuốc
    // có cờ `paediatric` để không phát sinh cảnh báo `paediatric-form` khi bác sĩ bấm "kê lại".
    visits: [
      {
        patient: 0, daysAgo: 30, hour: 9, minute: 30, doctor: 'nhi-owner', specialty: 'nhi', seconds: 75,
        vitals: { temperatureC: 38.2, pulse: 110, respiratoryRate: 28, spo2: 98, weightKg: WEIGHT_NHI[0]! }, dx: ['J06.9'],
        lines: [line('PARACETAMOL-150-MG-GOI', PARA_150), line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS)],
      },
      {
        patient: 10, daysAgo: 2, hour: 11, minute: 30, doctor: 'nhi-owner', specialty: 'nhi', seconds: 105,
        vitals: { temperatureC: 36.8, pulse: 88, weightKg: WEIGHT_NHI[10]! }, dx: ['H10.9'],
        lines: [line('TOBRAMYCIN-0-3-NHO-MAT', EYE_DROPS), line('NATRI-CLORID-0-9-NHO-MAT', EYE_DROPS)],
      },
      {
        patient: 8, daysAgo: 3, hour: 16, minute: 10, doctor: 'nhi-owner', specialty: 'nhi', seconds: 56,
        vitals: { temperatureC: 38.6, pulse: 102, respiratoryRate: 22, spo2: 98, weightKg: WEIGHT_NHI[8]! }, dx: ['R50.9'],
        lines: [line('PARACETAMOL-250-MG-GOI', PARA_250), line('ORESOL-MUOI-BU-NUOC', ORESOL_DAY)],
      },
      {
        patient: 5, daysAgo: 4, hour: 15, minute: 30, doctor: 'nhi-owner', specialty: 'nhi', seconds: 63,
        vitals: { temperatureC: 36.6, pulse: 92, weightKg: WEIGHT_NHI[5]! }, dx: ['K59.0'],
        lines: [line('LACTULOSE-10-G-15-ML'), line('MEN-VI-SINH-LACTOBACILLUS')],
      },
      {
        patient: 0, daysAgo: 5, hour: 8, minute: 30, doctor: 'nhi-owner', specialty: 'nhi', seconds: 45,
        vitals: { temperatureC: 38.3, pulse: 112, weightKg: WEIGHT_NHI[0]! }, dx: ['B34.9'],
        lines: [line('PARACETAMOL-150-MG-GOI', PARA_150), line('ORESOL-MUOI-BU-NUOC', ORESOL_DAY)],
      },
      {
        patient: 3, daysAgo: 6, hour: 14, minute: 15, doctor: 'nhi-owner', specialty: 'nhi', seconds: 48,
        vitals: { temperatureC: 36.5, pulse: 86, respiratoryRate: 20, spo2: 98, weightKg: WEIGHT_NHI[3]! }, dx: ['J30.4'],
        lines: [line('LORATADIN-10-MG', { days: 10 }), line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS)],
      },
      {
        patient: 7, daysAgo: 7, hour: 10, minute: 5, doctor: 'nhi-owner', specialty: 'nhi', seconds: 51,
        vitals: { temperatureC: 37.9, pulse: 116, respiratoryRate: 26, spo2: 97, weightKg: WEIGHT_NHI[7]! }, dx: ['J06.9'],
        lines: [line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS), line('PARACETAMOL-150-MG-GOI', PARA_150)],
      },
      {
        patient: 6, daysAgo: 8, hour: 9, minute: 45, doctor: 'nhi-owner', specialty: 'nhi', seconds: 90,
        vitals: { temperatureC: 36.7, pulse: 96, respiratoryRate: 22, spo2: 96, weightKg: WEIGHT_NHI[6]! }, dx: ['J45.9'],
        lines: [line('SALBUTAMOL-2-MG-5-ML-SIRO', SYRUP), line('MONTELUKAST-10-MG', { days: 30 })],
      },
      {
        patient: 2, daysAgo: 9, hour: 10, minute: 25, doctor: 'nhi-owner', specialty: 'nhi', seconds: 59,
        vitals: { temperatureC: 38.4, pulse: 100, respiratoryRate: 22, spo2: 98, weightKg: WEIGHT_NHI[2]! }, dx: ['J02.9'],
        lines: [line('CEFIXIM-100-MG-GOI', { perDose: 1 }), line('PARACETAMOL-250-MG-GOI', PARA_250)],
      },
      {
        patient: 9, daysAgo: 10, hour: 8, minute: 15, doctor: 'nhi-owner', specialty: 'nhi', seconds: 70,
        vitals: { temperatureC: 37.5, pulse: 118, weightKg: WEIGHT_NHI[9]! }, dx: ['A09'],
        lines: [line('ORESOL-MUOI-BU-NUOC', ORESOL_STOOL), line('KEM-10-MG', { perDose: 1 }), line('RACECADOTRIL-30-MG-GOI', { perDose: 1 })],
      },
      {
        patient: 1, daysAgo: 11, hour: 9, minute: 10, doctor: 'nhi-owner', specialty: 'nhi', seconds: 53,
        vitals: { temperatureC: 37.2, pulse: 94, weightKg: WEIGHT_NHI[1]! }, dx: ['A09'],
        lines: [line('ORESOL-MUOI-BU-NUOC', ORESOL_STOOL), line('KEM-10-MG', { perDose: 1 }), line('MEN-VI-SINH-LACTOBACILLUS')],
      },
      {
        // Phiên bỏ dở có chủ ý (> 30 phút): cột "Phiên bị loại" của phòng Nhi cũng có số khác 0.
        patient: 3, daysAgo: 12, hour: 17, minute: 0, doctor: 'nhi-owner', specialty: 'nhi', seconds: 1920,
        vitals: { temperatureC: 38.8, pulse: 104, respiratoryRate: 20, spo2: 97, weightKg: WEIGHT_NHI[3]! }, dx: ['J03.9'],
        lines: [line('AMOXICILLIN-250-MG-GOI', { perDose: 1 }), line('PARACETAMOL-250-MG-GOI', PARA_250)],
      },
      {
        patient: 4, daysAgo: 13, hour: 8, minute: 50, doctor: 'nhi-owner', specialty: 'nhi', seconds: 40,
        vitals: { temperatureC: 36.9, pulse: 98, respiratoryRate: 24, spo2: 99, weightKg: WEIGHT_NHI[4]! }, dx: ['J00'],
        lines: [line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS), line('PARACETAMOL-250-MG-GOI', PARA_250)],
      },
      {
        patient: 0, daysAgo: 20, hour: 9, minute: 25, doctor: 'nhi-owner', specialty: 'nhi', seconds: 58,
        vitals: { temperatureC: 37.8, pulse: 110, respiratoryRate: 28, spo2: 96, weightKg: WEIGHT_NHI[0]! }, dx: ['J20.9'],
        lines: [line('PARACETAMOL-150-MG-GOI', PARA_150), line('ACETYLCYSTEIN-200-MG')],
      },
      {
        patient: 7, daysAgo: 25, hour: 16, minute: 30, doctor: 'nhi-owner', specialty: 'nhi', seconds: 44,
        vitals: { temperatureC: 37.6, pulse: 114, weightKg: WEIGHT_NHI[7]! }, dx: ['K00.7'],
        lines: [line('PARACETAMOL-150-MG-GOI', PARA_150)],
      },
      {
        patient: 4, daysAgo: 30, hour: 11, minute: 15, doctor: 'nhi-owner', specialty: 'nhi', seconds: 83,
        vitals: { temperatureC: 37.7, pulse: 102, respiratoryRate: 24, spo2: 96, weightKg: WEIGHT_NHI[4]! }, dx: ['J05.0'],
        lines: [line('BUDESONID-0-5-MG-2-ML-KHI-DUNG'), line('PARACETAMOL-250-MG-GOI', PARA_250)],
      },
      {
        patient: 2, daysAgo: 40, hour: 15, minute: 5, doctor: 'nhi-owner', specialty: 'nhi', seconds: 74,
        vitals: { temperatureC: 38.2, pulse: 98, weightKg: WEIGHT_NHI[2]! }, dx: ['H66.9'],
        lines: [line('AMOXICILLIN-250-MG-GOI', { perDose: 1 }), line('PARACETAMOL-250-MG-GOI', PARA_250)],
      },
      {
        patient: 9, daysAgo: 45, hour: 8, minute: 10, doctor: 'nhi-owner', specialty: 'nhi', seconds: 52,
        vitals: { temperatureC: 36.7, pulse: 116, weightKg: WEIGHT_NHI[9]! }, dx: ['E55.9'],
        lines: [line('VITAMIN-D3-400-IU-GIOT', VITD_DROPS)],
      },
      {
        patient: 1, daysAgo: 60, hour: 10, minute: 40, doctor: 'nhi-owner', specialty: 'nhi', seconds: 66,
        vitals: { temperatureC: 38.5, pulse: 100, respiratoryRate: 22, spo2: 97, weightKg: WEIGHT_NHI[1]! }, dx: ['J03.9'],
        lines: [line('AMOXICILLIN-250-MG-GOI', { perDose: 1 }), line('PARACETAMOL-250-MG-GOI', PARA_250)],
      },
      {
        patient: 3, daysAgo: 75, hour: 8, minute: 35, doctor: 'nhi-owner', specialty: 'nhi', seconds: 49,
        vitals: { temperatureC: 38, pulse: 92, weightKg: WEIGHT_NHI[3]! }, dx: ['B08.4'],
        lines: [line('PARACETAMOL-250-MG-GOI', PARA_250), line('ORESOL-MUOI-BU-NUOC', ORESOL_DAY)],
      },
      {
        patient: 6, daysAgo: 90, hour: 9, minute: 55, doctor: 'nhi-owner', specialty: 'nhi', seconds: 55,
        vitals: { temperatureC: 37.4, pulse: 96, weightKg: WEIGHT_NHI[6]! }, dx: ['A08.4'],
        lines: [line('ORESOL-MUOI-BU-NUOC', ORESOL_STOOL), line('KEM-10-MG', { perDose: 1 }), line('MEN-VI-SINH-LACTOBACILLUS')],
      },
      {
        patient: 5, daysAgo: 120, hour: 14, minute: 45, doctor: 'nhi-owner', specialty: 'nhi', seconds: 61,
        vitals: { temperatureC: 36.6, pulse: 90, weightKg: WEIGHT_NHI[5]! }, dx: ['L20.9'],
        lines: [line('HYDROCORTISON-1-KEM', SKIN_CREAM), line('DESLORATADIN-5-MG', { days: 10 })],
      },
      {
        patient: 8, daysAgo: 150, hour: 10, minute: 20, doctor: 'nhi-owner', specialty: 'nhi', seconds: 72,
        vitals: { temperatureC: 36.5, pulse: 88, weightKg: WEIGHT_NHI[8]! }, dx: ['D50.9'],
        lines: [line('SAT-FUMARAT-ACID-FOLIC'), line('VITAMIN-C-500-MG')],
      },
    ],
    // Hai lượt `done` dùng `exam.seconds` 52 và 88 (review finding 4): bộ số cũ 78 và 120 nằm TRÊN trung
    // vị lịch sử nên khung "Hôm nay" của phòng Nhi có p50 = 78 > TARGET_P50_SECONDS = 60 ngay ngày đầu,
    // và mỗi ngày seed chạy lại đẩy thêm 2 lượt vào khung 14 ngày. Với 52 / 88: khung 14 ngày p50 = 56 /
    // p90 = 90 (ngày 2 và 3 vẫn 56), khung "Hôm nay" p50 = 52 / p90 = 88 — cả hai dưới ngưỡng.
    today: [
      {
        patient: 1, minutesAgo: 50, priority: 'appointment', state: 'done', doctor: 'nhi-owner',
        exam: {
          dx: ['J06.9'], seconds: 52,
          vitals: { temperatureC: 37.6, pulse: 96, respiratoryRate: 22, spo2: 98, weightKg: WEIGHT_NHI[1]! },
          lines: [line('NATRI-CLORID-0-9-NHO-MUI', NOSE_DROPS), line('PARACETAMOL-250-MG-GOI', PARA_250)],
        },
      },
      {
        patient: 9, minutesAgo: 35, priority: 'normal', state: 'done', doctor: 'nhi-owner',
        exam: {
          dx: ['A09'], seconds: 88,
          vitals: { temperatureC: 37.3, pulse: 116, weightKg: WEIGHT_NHI[9]! },
          lines: [line('ORESOL-MUOI-BU-NUOC', ORESOL_STOOL), line('KEM-10-MG', { perDose: 1 }), line('MEN-VI-SINH-LACTOBACILLUS')],
        },
      },
      { patient: 0, minutesAgo: 18, priority: 'normal', state: 'in-exam', doctor: 'nhi-owner', openedMinutesAgo: 3, reason: 'Sốt 2 ngày, ho' },
      { patient: 6, minutesAgo: 12, priority: 'appointment', state: 'waiting', reason: 'Khám lại hen, đã hẹn' },
      { patient: 7, minutesAgo: 6, priority: 'normal', state: 'waiting', reason: 'Quấy, chảy nước mũi' },
      { patient: 4, minutesAgo: 3, priority: 'urgent', state: 'waiting', reason: 'Sốt cao 39,5 độ, nôn' },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------

const FAMILY = ['Nguyễn', 'Nguyễn', 'Nguyễn', 'Trần', 'Trần', 'Lê', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const MALE = { middle: ['Văn', 'Minh', 'Quốc', 'Hữu', 'Đức', 'Thanh', 'Gia', 'Bảo'], given: ['An', 'Bình', 'Dũng', 'Hùng', 'Khang', 'Long', 'Nam', 'Phúc', 'Sơn', 'Tuấn', 'Quân', 'Hải', 'Đạt', 'Huy'] };
const FEMALE = { middle: ['Thị', 'Ngọc', 'Thu', 'Kim', 'Bảo', 'Thanh', 'Hồng'], given: ['Anh', 'Châu', 'Hà', 'Hạnh', 'Lan', 'Linh', 'Mai', 'Ngân', 'Phương', 'Quỳnh', 'Trang', 'Yến', 'Vy', 'Nhi'] };

/** Bộ sinh số giả ngẫu nhiên xác định (mulberry32) để chạy lại ra cùng dữ liệu. */
function rng(seed: string) {
  let a = createHash('sha1').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID xác định từ chuỗi (dạng v5, dùng SHA-1) để tạo có điều kiện không bao giờ trùng khi chạy lại. */
function stableUuid(name: string): string {
  const h = createHash('sha1').update(`phongmach-demo:${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generatePatients(spec: ClinicSpec, count: number): NewPatientInput[] {
  const rand = rng(spec.slug);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  const usedPhones = new Set(spec.story.map((s) => s.phone));
  const out: NewPatientInput[] = spec.story.map((s, i) => ({ ...s, clientUuid: stableUuid(`${spec.slug}:story:${i}`) }));
  const now = new Date();
  for (let i = 0; out.length < count; i++) {
    const male = rand() < 0.5;
    const pool = male ? MALE : FEMALE;
    const fullName = `${pick(FAMILY)} ${pick(pool.middle)} ${pick(pool.given)}`;
    let phone: string;
    do {
      phone = `09${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    const ageYears = spec.kind === 'pediatric' ? rand() * 14 : 18 + rand() * 67;
    const birth = new Date(now.getTime() - ageYears * 365.25 * 86_400_000);
    const adult = spec.kind === 'adult';
    out.push({
      clientUuid: stableUuid(`${spec.slug}:${i}`),
      fullName,
      phone,
      // CCCD giả có tiền tố 000 (mã tỉnh không tồn tại) để không nhầm với số thật.
      ...(adult ? { cccd: `000${String(Math.floor(rand() * 1e9)).padStart(9, '0')}` } : {}),
      birthDate: birth.toISOString().slice(0, 10),
      gender: male ? 'male' : 'female',
    });
  }
  return out;
}

// --------------------------------------------------------------------------------- bộ kiểm tra kịch bản

/** Tuổi (năm) tại một thời điểm, tính theo ngày sinh. */
function ageYearsAt(birthDate: string, at: Date): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  return (at.getTime() - birth.getTime()) / (365.25 * 86_400_000);
}

const NUMBER_RANGES = {
  /** Người lớn (mục 7.5 của thiết kế). */
  adult: { temperatureC: [36.4, 38.8], pulse: [62, 96], weightKg: [48, 82], spo2: [95, 99] },
  /** Huyết áp người lớn: bệnh thường / lượt có I10 hoặc E11.9 ở BẤT KỲ vị trí trong `dx`. */
  bpNormal: { systolic: [108, 132], diastolic: [68, 84] },
  bpHigh: { systolic: [135, 158], diastolic: [85, 96] },
  /**
   * Trẻ em. Mạch và nhịp thở dùng BAO HÌNH của hai khoảng theo tuổi (3–5 t: mạch 100–120, nhịp thở
   * 24–30; 6–10 t: mạch 84–104, nhịp thở 18–24) chứ không soát theo từng nhóm tuổi: tuổi tính từ
   * `birthDate` nên nó TRÔI theo lịch, và một phép kiểm theo nhóm tuổi sẽ biến seed thành bom hẹn giờ
   * (một cháu bước qua mốc 6 tuổi là seed thoát 1 và demo chết). Giá trị trong hai bảng dữ liệu vẫn
   * được chọn đúng theo nhóm tuổi tại thời điểm viết. Nhiệt độ của trẻ: thiết kế không chốt khoảng,
   * seed tự chốt 36,4–39,5 °C.
   */
  child: { temperatureC: [36.4, 39.5], pulse: [84, 120], respiratoryRate: [18, 30], weightKg: [14, 32], spo2: [95, 99] },
} as const;

/** `dx[0]` quyết định có ghi `respiratoryRate`/`spo2` hay không (mục 7.5), không theo cảm nhận. */
const isRespiratory = (dx: string[]): boolean => dx[0]!.startsWith('J') || dx[0] === 'R50.9';

/** Soát một con số nằm trong khoảng; trả về thông điệp lỗi hoặc undefined. */
function outOfRange(what: string, value: number | undefined, range: readonly [number, number] | readonly number[]): string | undefined {
  if (value === undefined) return undefined;
  const [min, max] = range as readonly [number, number];
  return value < min || value > max ? `${what} ${value} ngoài khoảng ${min}–${max}` : undefined;
}

interface ExamLike {
  dx: string[];
  lines: LineInput[];
  vitals: VitalsInput;
  seconds?: number;
}

/**
 * Soát toàn bộ `CLINICS` TRƯỚC khi ghi: một ký tự sai trong mã thuốc hiện chỉ lộ ra sau vài phút seed,
 * giữa lúc đã ghi nửa dữ liệu. Hàm THUẦN, không gọi mạng, không đọc đồng hồ ngoài `now` truyền vào.
 */
function validateScenario(now = new Date()): string[] {
  const errors: string[] = [];
  const keys = new Map<string, string>();
  const key = (what: string, name: string): void => {
    const uuid = stableUuid(name);
    const other = keys.get(uuid);
    if (other) errors.push(`khóa demo bị trùng: ${what} và ${other} cùng cho ${name}`);
    else keys.set(uuid, what);
  };

  for (const spec of CLINICS) {
    const expectedSpecialty: Specialty = spec.kind === 'adult' ? 'noi' : 'nhi';
    const doctors = new Map(spec.users.map((u) => [u.id, u]));
    const ages = new Map<number, number>();
    const phones = new Set<string>();
    const cccds = new Set<string>();

    // ---------------------------------------------------------------- bệnh nhân kịch bản
    spec.story.forEach((s, i) => {
      const at = `${spec.slug}/story ${i}`;
      key(at, `${spec.slug}:story:${i}`);
      if (!parseFullName(s.fullName)) errors.push(`${at}: họ tên "${s.fullName}" phải có ít nhất hai từ`);
      const phone = s.phone ? normalizePhone(s.phone) : undefined;
      if (!phone) errors.push(`${at}: số điện thoại "${s.phone ?? ''}" không hợp lệ`);
      else if (phones.has(phone)) errors.push(`${at}: số điện thoại ${phone} trùng với một ca kịch bản khác`);
      else phones.add(phone);
      if (!s.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(s.birthDate)) {
        errors.push(`${at}: ngày sinh phải có dạng YYYY-MM-DD`);
        return;
      }
      const born = new Date(`${s.birthDate}T00:00:00Z`);
      if (Number.isNaN(born.getTime()) || !born.toISOString().startsWith(s.birthDate)) {
        errors.push(`${at}: ngày sinh ${s.birthDate} không tồn tại`);
        return;
      }
      if (born.getTime() > now.getTime()) errors.push(`${at}: ngày sinh ${s.birthDate} ở tương lai`);
      const age = ageYearsAt(s.birthDate, now);
      ages.set(i, age);
      if (spec.kind === 'pediatric' && age >= 14) errors.push(`${at}: ${Math.floor(age)} tuổi — phòng Nhi chỉ nhận ca dưới 14 tuổi (làm mới dữ liệu demo)`);
      if (spec.kind === 'adult' && age < 18) errors.push(`${at}: ${Math.floor(age)} tuổi — phòng Nội chỉ nhận ca từ 18 tuổi`);
      // CCCD giả: 12 chữ số, tiền tố "000" (mã tỉnh không tồn tại), chỉ người từ 14 tuổi.
      if (age >= 14 && !s.cccd) errors.push(`${at}: từ 14 tuổi phải có CCCD giả`);
      if (age < 14 && s.cccd) errors.push(`${at}: dưới 14 tuổi không được có CCCD`);
      if (s.cccd) {
        if (!/^000\d{9}$/.test(s.cccd)) errors.push(`${at}: CCCD ${s.cccd} phải gồm 12 chữ số và bắt đầu bằng "000"`);
        if (cccds.has(s.cccd)) errors.push(`${at}: CCCD ${s.cccd} trùng với một ca kịch bản khác`);
        cccds.add(s.cccd);
      }
    });
    if (PATIENTS_PER_CLINIC < spec.story.length) {
      // Cảnh báo, không chặn: generatePatients vẫn tạo đủ số ca kịch bản.
      process.stdout.write(`Cảnh báo: SEED_PATIENTS=${PATIENTS_PER_CLINIC} nhỏ hơn ${spec.story.length} ca kịch bản của ${spec.slug} — sẽ tạo ${spec.story.length} bệnh nhân\n`);
    }

    // ---------------------------------------------------------------- dị ứng và tiền sử
    const allergiesOf = new Map<number, Array<{ kind: 'class' | 'ingredient'; value: string }>>();
    spec.allergies.forEach((a, i) => {
      const at = `${spec.slug}/allergy ${i}`;
      key(at, `${spec.slug}:allergy:${i}`);
      if (a.patient < 0 || a.patient >= spec.story.length) errors.push(`${at}: trỏ tới bệnh nhân không tồn tại (${a.patient})`);
      const known = a.kind === 'class' ? ALLERGY_CLASSES.some((c) => c.id === a.value) : INGREDIENTS.includes(a.value);
      if (!known) errors.push(`${at}: ${a.kind === 'class' ? 'nhóm' : 'hoạt chất'} "${a.value}" không có trong danh mục`);
      allergiesOf.set(a.patient, [...(allergiesOf.get(a.patient) ?? []), { kind: a.kind, value: a.value }]);
    });
    spec.history.forEach((h, i) => {
      const at = `${spec.slug}/history ${i}`;
      key(at, `${spec.slug}:history:${i}`);
      if (h.patient < 0 || h.patient >= spec.story.length) errors.push(`${at}: trỏ tới bệnh nhân không tồn tại (${h.patient})`);
      const text = h.text.trim();
      if (!text) errors.push(`${at}: nội dung tiền sử rỗng`);
      if (text.length > HISTORY_MAX) errors.push(`${at}: tiền sử ${text.length} ký tự, vượt ${HISTORY_MAX}`);
    });

    /** Phần dùng chung giữa lượt lịch sử và lượt `done` của hôm nay: đơn thuốc, chẩn đoán, bộ chữ, sinh hiệu. */
    const checkExam = (at: string, patient: number, exam: ExamLike, index: number): void => {
      if (patient < 0 || patient >= spec.story.length) {
        errors.push(`${at}: trỏ tới bệnh nhân không tồn tại (${patient})`);
        return;
      }
      // Chẩn đoán
      if (!exam.dx.length) errors.push(`${at}: không có chẩn đoán nào`);
      for (const code of exam.dx) if (!getIcd10(code)) errors.push(`${at}: mã ICD-10 không có trong danh mục: ${code}`);
      if (exam.dx[0] === 'Z76.0') errors.push(`${at}: Z76.0 không được là mã đầu tiên (nó chỉ thêm hậu tố vào lý do khám)`);
      const variants = NARRATIVE[expectedSpecialty][exam.dx[0]!];
      if (!variants?.length) {
        errors.push(`${at}: chưa có bộ chữ mẫu cho mã ${exam.dx[0]} (${expectedSpecialty})`);
      } else {
        const n = narrative(expectedSpecialty, exam.dx, index);
        const reason = n.reason.trim();
        const advice = n.advice.trim();
        if (!reason) errors.push(`${at}: thiếu lý do khám`);
        if (reason.length > REASON_MAX) errors.push(`${at}: lý do khám ${reason.length} ký tự, vượt ${REASON_MAX}`);
        if (reason.length > CHECK_IN_REASON_MAX) errors.push(`${at}: lý do khám ${reason.length} ký tự, vượt ${CHECK_IN_REASON_MAX} của lúc cấp số`);
        if (!advice) errors.push(`${at}: thiếu lời dặn`);
        // ADVICE_MAX là trần tự đặt của seed, CHẶT HƠN trần 1000 của completeBody.prescription.advice.
        if (advice.length > ADVICE_MAX) errors.push(`${at}: lời dặn ${advice.length} ký tự, vượt trần ${ADVICE_MAX} của seed`);
        if (!n.symptoms.trim()) errors.push(`${at}: thiếu phần triệu chứng`);
        if (!n.findings.trim()) errors.push(`${at}: thiếu phần khám thấy`);
        if (n.followUpDays !== undefined && (!Number.isInteger(n.followUpDays) || n.followUpDays < 1 || n.followUpDays > 365)) {
          errors.push(`${at}: số ngày tái khám ${n.followUpDays} phải là số nguyên 1…365`);
        }
      }

      // Đơn thuốc: lời dặn CHỈ được lưu khi lượt có đơn (planCompletion ghi advice vào List.note).
      if (!exam.lines.length) errors.push(`${at}: không có dòng thuốc nào — lời dặn sẽ không được lưu`);
      if (exam.lines.length > MAX_LINES) errors.push(`${at}: ${exam.lines.length} dòng thuốc, vượt trần ${MAX_LINES} của tuyến API`);
      const chronic = exam.dx.some((code) => getIcd10(code)?.chronic);
      const maxDays = chronic ? 90 : 30;
      exam.lines.forEach((input, n) => {
        const drug = getDrug(input.drug);
        if (!drug) {
          errors.push(`${at} dòng ${n + 1}: thuốc không có trong danh mục: ${input.drug}`);
          return;
        }
        const resolved = resolveLine(drug, input);
        if (!resolved.instruction) errors.push(`${at} dòng ${n + 1}: thiếu liều hoặc số lượng (cách dùng rỗng)`);
        if (!drug.manualQuantity && resolved.quantity === undefined) errors.push(`${at} dòng ${n + 1}: không tính được số lượng`);
        if (drug.manualQuantity && resolved.quantity === undefined) errors.push(`${at} dòng ${n + 1}: thuốc nhập số lượng tay nhưng không có quantity`);
        if (input.days !== undefined && input.days > maxDays) errors.push(`${at} dòng ${n + 1}: ${input.days} ngày vượt trần ${maxDays} ngày`);
        // Nhất quán dị ứng ↔ đơn, theo đúng ngữ nghĩa checkPrescription (class → drug.classes, ingredient → drug.ingredients).
        for (const allergy of allergiesOf.get(patient) ?? []) {
          const hit = allergy.kind === 'class' ? drug.classes.includes(allergy.value) : drug.ingredients.includes(allergy.value);
          if (hit) errors.push(`${at} dòng ${n + 1}: ${drug.code} xung đột dị ứng '${allergy.value}' của bệnh nhân ${patient}`);
        }
      });

      // Thời lượng phiên khám
      const seconds = exam.seconds ?? 75;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) errors.push(`${at}: thời lượng ${seconds} giây phải là số nguyên 1…3600`);

      // Sinh hiệu
      try {
        cleanVitals(exam.vitals);
      } catch (err) {
        errors.push(`${at}: sinh hiệu không hợp lệ — ${err instanceof DomainError ? err.message : String(err)}`);
      }
      const v = exam.vitals;
      const age = ages.get(patient);
      const wants = isRespiratory(exam.dx);
      const problems: Array<string | undefined> = [];
      if (spec.kind === 'adult') {
        if (v.pulse === undefined || v.systolic === undefined || v.diastolic === undefined || v.weightKg === undefined) {
          problems.push('lượt người lớn phải có mạch, huyết áp (cả hai số) và cân nặng');
        }
        if (v.respiratoryRate !== undefined) problems.push('phòng Nội không ghi nhịp thở (quy tắc mục 7.5)');
        const bp = exam.dx.some((code) => code === 'I10' || code === 'E11.9') ? NUMBER_RANGES.bpHigh : NUMBER_RANGES.bpNormal;
        problems.push(outOfRange('nhiệt độ', v.temperatureC, NUMBER_RANGES.adult.temperatureC));
        problems.push(outOfRange('mạch', v.pulse, NUMBER_RANGES.adult.pulse));
        problems.push(outOfRange('cân nặng', v.weightKg, NUMBER_RANGES.adult.weightKg));
        problems.push(outOfRange('huyết áp tâm thu', v.systolic, bp.systolic));
        problems.push(outOfRange('huyết áp tâm trương', v.diastolic, bp.diastolic));
        problems.push(outOfRange('SpO2', v.spo2, NUMBER_RANGES.adult.spo2));
      } else {
        if (v.temperatureC === undefined || v.pulse === undefined || v.weightKg === undefined) problems.push('lượt nhi phải có nhiệt độ, mạch và cân nặng');
        if (age !== undefined && age < 12 && v.weightKg === undefined) problems.push('trẻ dưới 12 tuổi phải có cân nặng');
        if (v.systolic !== undefined || v.diastolic !== undefined) problems.push('không ghi huyết áp cho trẻ');
        problems.push(outOfRange('nhiệt độ', v.temperatureC, NUMBER_RANGES.child.temperatureC));
        problems.push(outOfRange('mạch', v.pulse, NUMBER_RANGES.child.pulse));
        problems.push(outOfRange('nhịp thở', v.respiratoryRate, NUMBER_RANGES.child.respiratoryRate));
        problems.push(outOfRange('cân nặng', v.weightKg, NUMBER_RANGES.child.weightKg));
        problems.push(outOfRange('SpO2', v.spo2, NUMBER_RANGES.child.spo2));
        // Soát HAI CHIỀU nhịp thở: thiếu khi quy tắc đòi là lỗi, có khi quy tắc không đòi cũng là lỗi.
        if (wants && v.respiratoryRate === undefined) problems.push(`mã ${exam.dx[0]} là hô hấp/sốt nhưng không có nhịp thở`);
        if (!wants && v.respiratoryRate !== undefined) problems.push(`mã ${exam.dx[0]} không phải hô hấp/sốt nhưng có nhịp thở`);
      }
      // Soát HAI CHIỀU SpO2, áp cho cả hai phòng.
      if (wants && v.spo2 === undefined) problems.push(`mã ${exam.dx[0]} là hô hấp/sốt nhưng không có spo2`);
      if (!wants && v.spo2 !== undefined) problems.push(`mã ${exam.dx[0]} không phải hô hấp/sốt nhưng có spo2`);
      for (const p of problems) if (p) errors.push(`${at}: ${p}`);
    };

    const checkDoctor = (at: string, id: string): void => {
      const user = doctors.get(id);
      if (!user) errors.push(`${at}: bác sĩ '${id}' không có trong danh sách người dùng của phòng khám`);
      else if (!user.practitioner) errors.push(`${at}: '${id}' không phải bác sĩ (thiếu practitioner: true)`);
    };

    // ---------------------------------------------------------------- lượt khám cũ
    /** Cân nặng của cùng một bệnh nhân trong 30 ngày gần nhất: lệch không quá 10 % (review finding 12). */
    const recentWeights = new Map<number, number[]>();
    spec.visits.forEach((v, i) => {
      const at = `${spec.slug}/visit ${i}`;
      key(`${at} (cấp số)`, `${spec.slug}:visit:${i}:in`);
      key(`${at} (hoàn tất)`, `${spec.slug}:visit:${i}:done`);
      if (v.specialty !== expectedSpecialty) errors.push(`${at}: chuyên khoa '${v.specialty}' không khớp phòng khám (${expectedSpecialty})`);
      if (!Number.isInteger(v.daysAgo) || v.daysAgo < 0) errors.push(`${at}: daysAgo ${v.daysAgo} phải là số nguyên không âm`);
      const hour = v.hour ?? 9;
      const minute = v.minute ?? 0;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) errors.push(`${at}: giờ ${hour} phải là số nguyên 0…23`);
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) errors.push(`${at}: phút ${minute} phải là số nguyên 0…59`);
      checkDoctor(at, v.doctor);
      checkExam(at, v.patient, v, i);
      if (v.daysAgo <= 30 && v.vitals.weightKg !== undefined) {
        recentWeights.set(v.patient, [...(recentWeights.get(v.patient) ?? []), v.vitals.weightKg]);
      }
    });

    // ---------------------------------------------------------------- sân khấu hôm nay
    const day = vnDay(now);
    spec.today.forEach((t, i) => {
      const at = `${spec.slug}/today ${i}`;
      key(`${at} (cấp số)`, `${spec.slug}:today:${day}:${i}:in`);
      if (t.state === 'done') key(`${at} (hoàn tất)`, `${spec.slug}:today:${day}:${i}:done`);
      if (!PRIORITIES.includes(t.priority)) errors.push(`${at}: mức ưu tiên '${t.priority}' không hợp lệ`);
      if (!Number.isInteger(t.minutesAgo) || t.minutesAgo < 1 || t.minutesAgo > 600) errors.push(`${at}: minutesAgo ${t.minutesAgo} phải là số nguyên 1…600`);
      if (t.patient < 0 || t.patient >= spec.story.length) {
        errors.push(`${at}: trỏ tới bệnh nhân không tồn tại (${t.patient})`);
        return;
      }
      if (t.state === 'done') {
        checkDoctor(at, t.doctor);
        checkExam(at, t.patient, t.exam, i);
        const seconds = t.exam.seconds ?? 75;
        if (t.minutesAgo <= seconds / 60 + 1) errors.push(`${at}: đến cách đây ${t.minutesAgo} phút nhưng phiên khám ${seconds} giây ⇒ giờ ký sẽ ở tương lai`);
        if (t.exam.vitals.weightKg !== undefined) recentWeights.set(t.patient, [...(recentWeights.get(t.patient) ?? []), t.exam.vitals.weightKg]);
      } else {
        const reason = t.reason.trim();
        if (!reason) errors.push(`${at}: thiếu lý do đến`);
        if (reason.length > CHECK_IN_REASON_MAX) errors.push(`${at}: lý do đến ${reason.length} ký tự, vượt ${CHECK_IN_REASON_MAX}`);
        if (t.state === 'in-exam') {
          checkDoctor(at, t.doctor);
          const opened = t.openedMinutesAgo ?? Math.ceil(t.minutesAgo / 2);
          if (!Number.isInteger(opened) || opened < 1 || opened > t.minutesAgo) errors.push(`${at}: mở hồ sơ cách đây ${opened} phút — phải là số nguyên 1…${t.minutesAgo} (không mở trước giờ đến)`);
        }
      }
    });

    for (const [patient, weights] of recentWeights) {
      const min = Math.min(...weights);
      const max = Math.max(...weights);
      if (max > min * 1.1) errors.push(`${spec.slug}/story ${patient}: cân nặng trong 30 ngày lệch quá 10 % (${min}–${max} kg)`);
    }
  }
  return errors;
}

const scenarioStats = (spec: ClinicSpec): string =>
  `${spec.slug}: ${spec.story.length} bệnh nhân kịch bản, ${spec.visits.length} lượt khám cũ, ${spec.today.length} lượt hôm nay, ${spec.allergies.length} dị ứng, ${spec.history.length} tiền sử`;

// ------------------------------------------------------------------------------------------- ghi dữ liệu

type Say = (msg: string) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tenantClient = (t: Tenant) => loginTenant(MEDPLUM_URL, t);
const sha256Base64 = (text: string) => createHash('sha256').update(text).digest('base64');
/** Số giây một chữ số thập phân, viết theo kiểu Việt Nam (dấu phẩy). */
const since = (from: number): string => ((Date.now() - from) / 1000).toFixed(1).replace('.', ',');
const pad2 = (n: number): string => String(n).padStart(2, '0');

const outcomeId = (err: unknown): string | undefined => (err instanceof OperationOutcomeError ? err.outcome.id : undefined);

/**
 * Chờ hạn mức FHIR rồi thử lại. Hai thứ được bắt: 429 ném ra ngoài (`too-many-requests`) và `BusyError`
 * (giành số hết lượt). Một lượt khám ≈ 2.500 điểm ghi, hạn mức ~50.000 điểm/phút/tài khoản máy, nên 429
 * ở giai đoạn lượt khám là chuyện thường trực chứ không phải ngoại lệ — thử lại KHÔNG chờ sẽ nằm trọn
 * trong cùng phút bị khóa và seed chết giữa buổi nạp.
 */
async function withQuotaRetry<T>(say: Say, what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const quota = outcomeId(err) === 'too-many-requests' || err instanceof BusyError;
      if (!quota || attempt >= MAX_ATTEMPTS) throw err;
      say(`  hạn mức FHIR khi ${what}: chờ ${BACKOFF_MS / 1000}s rồi thử lại`);
      await sleep(BACKOFF_MS);
    }
  }
}

/**
 * `completeVisit` còn một kiểu 429 nữa: nằm TRONG gói, trả về `kind: 'incomplete'`. `writeAll` và
 * `retryOnConflict` chỉ thử lại xung đột giao dịch (HTTP 409 + mã PostgreSQL 40001, xem
 * services/bff/src/conflict.ts), nên 429 của một phần tử rơi vào `failedEntries`. Gửi lại cùng
 * `clientUuid` là an toàn: mọi mục đều tạo có điều kiện.
 */
async function completeWithQuotaRetry(store: MedplumClinicStore, say: Say, what: string, cmd: CompleteCommand) {
  for (let attempt = 1; ; attempt++) {
    const r = await withQuotaRetry(say, what, () => store.completeVisit(cmd));
    if (r.kind !== 'incomplete') return r;
    if (attempt >= MAX_ATTEMPTS) throw new Error(`${what}: còn ghi dở sau ${attempt} lần gửi lại`);
    say(`  ${what}: ghi dở (${r.failed.map((f) => f.status).join(',')}) — chờ ${BACKOFF_MS / 1000}s rồi gửi lại cùng clientUuid`);
    await sleep(BACKOFF_MS);
  }
}

interface FullVisit {
  /** Nhãn ngắn để mọi thông điệp lỗi biết sửa ở đâu: "<slug>/visit 12". */
  what: string;
  inKey: string;
  doneKey: string;
  patientId: string;
  specialty: Specialty;
  priority: QueuePriority;
  doctor: Doctor;
  /** Giờ đến, cũng là mốc mở hồ sơ ⇒ số đo đúng bằng `seconds`. */
  at: Date;
  seconds: number;
  dx: string[];
  lines: LineInput[];
  vitals: VitalsInput;
  narrative: Narrative;
}

/**
 * Một lượt khám đi hết đường: cấp số → mở hồ sơ → ký (có đơn). Dùng cho CẢ lượt lịch sử và lượt `done`
 * của hôm nay. `openVisit` chỉ nhận BA tham số ⇒ `examOpenedSource = 'server'` (số đo vào cột thường,
 * không phải "Đo ở máy khám" — xem markCalled trong packages/clinical/src/queue.ts).
 */
async function runFullVisit(store: MedplumClinicStore, say: Say, v: FullVisit): Promise<void> {
  const checkedIn = await withQuotaRetry(say, v.what, () =>
    store.checkIn({ clientUuid: v.inKey, patientId: v.patientId, specialty: v.specialty, priority: v.priority, reason: v.narrative.reason }, v.at)
  );
  if (!checkedIn) throw new Error(`${v.what}: không cho vào hàng chờ được (bệnh nhân không tìm thấy)`);
  const opened = await withQuotaRetry(say, v.what, () => store.openVisit(checkedIn.item.id, v.doctor, v.at));
  switch (opened.kind) {
    case 'ok':
      break;
    case 'closed':
      // ĐÚNG đường chạy lại: lượt đã hoàn tất từ lần seed trước (Encounter `finished`). Đi tiếp —
      // `wasCompletedBy` được kiểm TRƯỚC kiểm trạng thái trong completeVisit nên nó trả
      // { kind: 'ok', replayed: true } mà không ghi gì.
      break;
    case 'taken':
      throw new Error(`${v.what}: hồ sơ đang do ${opened.doctorName ?? 'người khác'} khám — đóng lượt đó rồi chạy lại seed`);
    case 'not-found':
      throw new Error(`${v.what}: không đọc được lượt khám vừa cấp số`);
  }
  const lines: SignedLine[] = v.lines.map((input) => {
    const drug = getDrug(input.drug)!;
    return { drug, input, resolved: resolveLine(drug, input) };
  });
  const result = await completeWithQuotaRetry(store, say, v.what, {
    clientUuid: v.doneKey,
    encounterId: checkedIn.item.id,
    doctor: v.doctor,
    now: new Date(v.at.getTime() + v.seconds * 1000),
    exam: { reason: v.narrative.reason, symptoms: v.narrative.symptoms, findings: v.narrative.findings, vitals: v.vitals },
    diagnoses: v.dx.map((c) => getIcd10(c)!),
    prescription: {
      code: makePrescriptionCode(vnDay(v.at), createHash('sha256').update(v.doneKey).digest()),
      lines,
      advice: v.narrative.advice,
      followUpDays: v.narrative.followUpDays,
      acks: [],
      digestBase64: sha256Base64,
    },
  });
  if (result.kind !== 'ok') throw new Error(`${v.what}: ${result.kind}`);
}

/** Dùng lại các phòng khám đã tạo nếu thông tin đăng nhập trong file còn dùng được. */
async function reuseExisting(): Promise<TenantsFile | undefined> {
  if (!existsSync(OUT)) return undefined;
  try {
    const file = parseTenantsFile(JSON.parse(readFileSync(OUT, 'utf8')));
    const wanted = new Set(CLINICS.map((c) => c.slug));
    if (file.tenants.length !== wanted.size || !file.tenants.every((t) => wanted.has(t.slug))) return undefined;
    for (const t of file.tenants) await tenantClient(t);
    return file;
  } catch {
    return undefined;
  }
}

async function createTenants(): Promise<TenantsFile> {
  const admin = await adminClient();
  const tenants: Tenant[] = [];
  const users: DemoUser[] = [];
  for (const spec of CLINICS) {
    const tenant = await createTenantProject(admin, spec.slug, spec.name);
    tenants.push(tenant);
    const medplum = await tenantClient(tenant);
    for (const u of spec.users) {
      let practitionerId: string | undefined;
      if (u.practitioner) {
        const [family, ...given] = u.name.replace(/^(BS\.|Phụ tá)\s*/, '').replace(/\s*\(.*\)$/, '').split(' ');
        const p = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family, given }] });
        practitionerId = p.id;
      }
      users.push({ id: u.id, name: u.name, role: u.role, tenant: spec.slug, ...(practitionerId ? { practitionerId } : {}) });
    }
  }
  return { tenants, users };
}

async function runBatch(medplum: MedplumClient, say: Say, entries: BundleEntry[]): Promise<void> {
  let pending = entries;
  for (let attempt = 1; pending.length; attempt++) {
    const result = (await medplum.executeBatch({ resourceType: 'Bundle', type: 'batch', entry: pending } satisfies Bundle)) as Bundle;
    const failed: BundleEntry[] = [];
    (result.entry ?? []).forEach((e, i) => {
      const status = String(e.response?.status ?? '');
      if (status.startsWith('2')) return;
      if (!status.startsWith('429')) throw new Error(`Phần tử batch lỗi: ${status}`);
      failed.push(pending[i]!);
    });
    if (!failed.length) return;
    if (attempt >= MAX_ATTEMPTS) throw new Error(`Vẫn còn ${failed.length} phần tử bị giới hạn tốc độ sau ${MAX_ATTEMPTS} lần thử`);
    say(`  hạn mức FHIR: chờ ${BACKOFF_MS / 1000}s rồi gửi lại ${failed.length} phần tử`);
    await sleep(BACKOFF_MS);
    pending = failed;
  }
}

async function seedPatients(medplum: MedplumClient, spec: ClinicSpec, say: Say): Promise<number> {
  const inputs = generatePatients(spec, PATIENTS_PER_CLINIC);
  for (let i = 0; i < inputs.length; i += BATCH) {
    const entries: BundleEntry[] = inputs.slice(i, i + BATCH).map((input) => ({
      request: { method: 'POST', url: 'Patient', ifNoneExist: clientUuidQuery(input.clientUuid) },
      resource: buildPatient(input) satisfies Patient,
    }));
    await runBatch(medplum, say, entries);
  }
  // Bệnh nhân đã có từ lần seed trước (tạo có điều kiện nên không được ghi lại) có thể chưa mang khóa tìm chính xác: ghi bổ sung.
  const { updated } = await backfillSearchKeys(medplum, say);
  if (updated) say(`  ghi khóa tìm cho ${updated} bệnh nhân đã có`);
  const counted = await medplum.search('Patient', '_summary=count&_total=accurate');
  return counted.total ?? 0;
}

/**
 * Dị ứng, tiền sử, lượt khám cũ có đơn và hàng chờ của ngày seed chạy: đi qua đúng đường ghi của ứng dụng
 * (cùng `MedplumClinicStore`), nên dữ liệu demo có cùng hình dạng với dữ liệu thật. Chạy lại được: mọi
 * khóa đều xác định, mục đã có thì được nhận ra và bỏ qua.
 *
 * BA THỨ TÍCH TỤ LẠI THEO NGÀY — không phải lỗi dữ liệu, đừng đi sửa:
 *  1. 3 Encounter `arrived` mỗi phòng mỗi ngày (ba lượt `waiting`). `listQueue(day)` lọc theo ngày nên
 *     hàng chờ hôm nay không thấy chúng.
 *  2. 1 Encounter `in-progress` mỗi phòng mỗi ngày (lượt `in-exam`) KHÔNG BAO GIỜ được đóng: ngày sau
 *     không ai ký nó, và khóa của seed ngày sau mang `vnDay(now)` mới. Vô hại với cả ba đường đọc
 *     (`listQueue` lọc theo ngày; `finishedVisits` và `patientVisits` chỉ lấy `finished`).
 *  3. 2 lượt `done` mỗi phòng mỗi ngày: chúng `finished` nên ĐI VÀO `finishedVisits` (số đo Metrics
 *     khung 14/30 ngày) và `patientVisits` (lịch sử khám của ca trình diễn dài thêm 1 lượt mỗi ngày).
 *     Đây là nguồn của review finding 4 — vì vậy `exam.seconds` của hai lượt đó phải nằm quanh trung vị.
 */
async function seedClinical(file: TenantsFile, spec: ClinicSpec, store: MedplumClinicStore, medplum: MedplumClient, now: Date, say: Say): Promise<string[]> {
  const parts: string[] = [];
  const cache = new Map<number, string>();
  const patientId = async (index: number): Promise<string> => {
    const hit = cache.get(index);
    if (hit) return hit;
    const found = await medplum.searchOne('Patient', clientUuidQuery(stableUuid(`${spec.slug}:story:${index}`)));
    if (!found?.id) throw new Error(`Không thấy bệnh nhân demo ${spec.slug}:${index}`);
    cache.set(index, found.id);
    return found.id;
  };
  const doctorOf = (id: string): Doctor => {
    const user = file.users.find((u) => u.id === id);
    if (!user) throw new Error(`Người dùng '${id}' không có trong .demo-tenants.json — tenant này được tạo trước khi bạn thêm người dùng vào CLINICS; tạo tenant mới (slug khác) hoặc bỏ người dùng đó đi`);
    return { userId: user.id, name: user.name.replace(/\s*\(.*\)$/, ''), practitionerId: user.practitionerId };
  };

  // --------------------------------------------------- dị ứng và tiền sử
  let t0 = Date.now();
  for (const [i, a] of spec.allergies.entries()) {
    const what = `${spec.slug}/allergy ${i}`;
    const pid = await patientId(a.patient);
    await withQuotaRetry(say, what, () =>
      store.addAllergy(pid, { clientUuid: stableUuid(`${spec.slug}:allergy:${i}`), kind: a.kind, value: a.value, ...(a.label ? { label: a.label } : {}) }, now)
    );
  }
  for (const [i, h] of spec.history.entries()) {
    const what = `${spec.slug}/history ${i}`;
    const pid = await patientId(h.patient);
    await withQuotaRetry(say, what, () => store.addHistory(pid, { clientUuid: stableUuid(`${spec.slug}:history:${i}`), text: h.text }, now));
  }
  parts.push(`${spec.allergies.length} dị ứng + ${spec.history.length} tiền sử (${since(t0)} giây)`);

  // --------------------------------------------------- lượt khám cũ
  t0 = Date.now();
  for (const [i, v] of spec.visits.entries()) {
    const what = `${spec.slug}/visit ${i}`;
    // Mốc dựng theo giờ VN tường minh (hậu tố +07:00) nên không phụ thuộc TZ của container (chạy UTC).
    const day = vnDay(new Date(now.getTime() - v.daysAgo * 86_400_000));
    const at = new Date(`${day}T${pad2(v.hour ?? 9)}:${pad2(v.minute ?? 0)}:00+07:00`);
    await runFullVisit(store, say, {
      what,
      inKey: stableUuid(`${spec.slug}:visit:${i}:in`),
      doneKey: stableUuid(`${spec.slug}:visit:${i}:done`),
      patientId: await patientId(v.patient),
      specialty: v.specialty,
      priority: 'normal',
      doctor: doctorOf(v.doctor),
      at,
      seconds: v.seconds ?? 75,
      dx: v.dx,
      lines: v.lines,
      vitals: v.vitals,
      narrative: narrative(v.specialty, v.dx, i),
    });
  }
  parts.push(`${spec.visits.length} lượt khám cũ (${since(t0)} giây)`);

  // --------------------------------------------------- sân khấu hôm nay
  t0 = Date.now();
  const specialty: Specialty = spec.kind === 'adult' ? 'noi' : 'nhi';
  const day = vnDay(now);
  // Kẹp HAI ĐẦU (review finding 8): sàn là 00:05 giờ VN của ngày hôm nay (nếu seed chạy lúc 00:30 thì
  // `now − 55 phút` rơi sang ngày hôm trước và listQueue(vnDay(now)) không thấy lượt đó), trần là `now`
  // (nếu seed chạy lúc 00:02 thì sàn lại ở tương lai và hàng chờ hiện "chờ −3 phút").
  const floor = Date.parse(`${day}T00:05:00+07:00`);
  const clamp = (ms: number, lower: number): Date => new Date(Math.min(Math.max(ms, lower), now.getTime()));
  const counts = { waiting: 0, inExam: 0, done: 0 };
  for (const [i, t] of spec.today.entries()) {
    const what = `${spec.slug}/today ${i}`;
    const at = clamp(now.getTime() - t.minutesAgo * 60_000, floor);
    const inKey = stableUuid(`${spec.slug}:today:${day}:${i}:in`);
    const pid = await patientId(t.patient);
    if (t.state === 'done') {
      counts.done += 1;
      await runFullVisit(store, say, {
        what,
        inKey,
        doneKey: stableUuid(`${spec.slug}:today:${day}:${i}:done`),
        patientId: pid,
        specialty,
        priority: t.priority,
        doctor: doctorOf(t.doctor),
        at,
        seconds: t.exam.seconds ?? 75,
        dx: t.exam.dx,
        lines: t.exam.lines,
        vitals: t.exam.vitals,
        narrative: narrative(specialty, t.exam.dx, i),
      });
      continue;
    }
    const checkedIn = await withQuotaRetry(say, what, () =>
      store.checkIn({ clientUuid: inKey, patientId: pid, specialty, priority: t.priority, reason: t.reason }, at)
    );
    if (!checkedIn) throw new Error(`${what}: không cho vào hàng chờ được (bệnh nhân không tìm thấy)`);
    if (t.state === 'waiting') {
      counts.waiting += 1;
      continue; // chỉ cấp số: không mở hồ sơ, không ký
    }
    counts.inExam += 1;
    // Lượt đang khám: mốc mở MUỘN hơn giờ đến (bệnh nhân chờ rồi mới được gọi vào), kẹp hai đầu, KHÔNG ký.
    const openedAt = clamp(now.getTime() - (t.openedMinutesAgo ?? Math.ceil(t.minutesAgo / 2)) * 60_000, at.getTime());
    const opened = await withQuotaRetry(say, what, () => store.openVisit(checkedIn.item.id, doctorOf(t.doctor), openedAt));
    if (opened.kind === 'taken') throw new Error(`${what}: hồ sơ đang do ${opened.doctorName ?? 'người khác'} khám`);
    if (opened.kind === 'not-found') throw new Error(`${what}: không đọc được lượt khám vừa cấp số`);
  }
  parts.push(`${spec.today.length} lượt hôm nay: ${counts.waiting} chờ, ${counts.inExam} đang khám, ${counts.done} đã xong (${since(t0)} giây)`);
  return parts;
}

async function seedOneClinic(file: TenantsFile, spec: ClinicSpec): Promise<void> {
  const say: Say = (msg) => process.stdout.write(`${spec.slug}: ${msg.trim()}\n`);
  const tenant = file.tenants.find((t) => t.slug === spec.slug)!;
  const medplum = await tenantClient(tenant);
  const store = new MedplumClinicStore(medplum);
  const now = new Date();
  const started = Date.now();
  const total = await seedPatients(medplum, spec, say);
  const parts = [`${total} bệnh nhân (${since(started)} giây)`];
  parts.push(...(await seedClinical(file, spec, store, medplum, now, say)));
  // Gom thành MỘT dòng in khi phòng khám xong: hai phòng chạy song song nên log rời sẽ xen nhau.
  process.stdout.write(`${spec.slug}: ${parts.join(', ')}\n`);
}

async function main() {
  const problems = validateScenario();
  if (problems.length) {
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stderr.write(`Bộ kiểm tra kịch bản tìm thấy ${problems.length} lỗi — chưa ghi gì vào Medplum.\n`);
    process.exit(1);
  }
  for (const spec of CLINICS) console.log(scenarioStats(spec));
  if (DRY_RUN) {
    console.log('SEED_DRY_RUN=1: chỉ chạy bộ kiểm tra kịch bản, không nối Medplum.');
    return;
  }

  const startedAll = Date.now();
  const reused = await reuseExisting();
  const file = reused ?? (await createTenants());
  console.log(reused ? 'Dùng lại các phòng khám demo đã có.' : 'Đã tạo các phòng khám demo mới.');
  writeFileSync(OUT, JSON.stringify(file, null, 2), { mode: 0o600 });
  chmodSync(OUT, 0o600);

  // Hai phòng khám = hai Project + hai tài khoản máy ⇒ HAI HẠN MỨC TÁCH BIỆT, nên chạy song song rút
  // gần một nửa thời gian seed (bậc 1 của thang lùi trong thiết kế) mà không làm nghèo dữ liệu.
  //
  // CÁCH ĐẾM DUY NHẤT của khối lượng ghi (dùng cho mọi ước lượng, đừng đếm kiểu khác):
  //   58 lượt đi hết đường  = 54 lượt lịch sử MỚI (32 Nội + 22 Nhi) + 4 lượt `done` của hôm nay
  // + 8 lượt chỉ cấp số / chỉ mở hồ sơ (6 `waiting` + 2 `in-exam`)
  // + 4 lượt lịch sử CŨ (3 Nội + 1 Nhi, đã có từ lần seed trước) — chạy lại không ghi gì.
  await Promise.all(CLINICS.map((spec) => seedOneClinic(file, spec)));

  const seconds = Math.round((Date.now() - startedAll) / 1000);
  console.log(`Tổng thời gian seed: ${Math.floor(seconds / 60)} phút ${seconds % 60} giây`);
  console.log(`\nĐã ghi ${OUT}`);
  console.log('Người dùng demo:');
  for (const u of file.users) console.log(`  ${u.tenant} / ${u.id}  (${u.role})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});


