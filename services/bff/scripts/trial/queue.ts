// `pnpm trial queue` xếp sẵn hàng chờ cho một bác sĩ trước lượt thử của người đó; `pnpm trial clear` dọn sau lượt.
// Cả hai đi qua đúng kho của ứng dụng (cấp số, hủy lượt), nên hàng chờ trên màn hình giống hệt khi phụ tá tự cấp số.
import type { Encounter } from '@medplum/fhirtypes';
import { SPECIALTY_LABEL, sortQueue, vnDay, type QueueItem, type Specialty } from '@phongmach/clinical';
import { casesOf } from '@phongmach/trial';
import { USERS, openClinic, patientIndex, stableUuid, type DoctorId } from './common.js';

const active = (i: QueueItem) => i.status === 'waiting' || i.status === 'in-exam';
const pad3 = (n: number) => String(n).padStart(3, '0');

export interface QueueOptions {
  /** Xếp các ca làm quen (không tính số đo) thay cho các ca tính số đo. */
  warmup: boolean;
  /** Lần xếp thứ mấy trong ngày cho cùng bác sĩ và cùng nhóm ca. Lần 1 chạy lại không tạo thêm gì; muốn làm lại cả lượt thì dùng lần 2. */
  round: number;
  /** Vẫn xếp dù hàng chờ đang có lượt chưa xong của người khác. */
  force: boolean;
}

export async function queue(doctor: DoctorId, specialty: Specialty, opts: QueueOptions): Promise<void> {
  const { medplum, store } = await openClinic();
  const now = new Date();
  const day = vnDay(now);
  const index = await patientIndex(medplum);
  const plan = casesOf(specialty, opts.warmup);
  const mine = new Set(plan.map((c) => index.idOf(doctor, c)));

  // Hàng chờ là của cả phòng khám: lượt chưa xong của bác sĩ trước (hoặc nhóm ca khác) sẽ lẫn vào hàng chờ của bác sĩ này.
  const others = (await store.listQueue(day)).filter((i) => active(i) && !mine.has(i.patientId));
  if (others.length && !opts.force) {
    throw new Error(
      `Hàng chờ hôm nay còn ${others.length} lượt chưa xong không thuộc nhóm ca này (${others.slice(0, 4).map((i) => `${pad3(i.number)} ${i.patientName}`).join(', ')}${others.length > 4 ? ', …' : ''}).\n` +
        'Chạy "pnpm trial clear" trước, hoặc thêm "force" nếu cố ý xếp chồng (ví dụ ca làm quen chưa xong).'
    );
  }

  const rows: Array<{ number: number; id: string; name: string; title: string; created: boolean }> = [];
  for (const c of plan) {
    // UUID theo (bác sĩ, ca, ngày, lần): chạy lại lệnh trong ngày không cấp số lần hai; hôm sau là một lượt mới.
    const clientUuid = stableUuid(`checkin:${doctor}:${c.id}:${day}:${opts.round}`);
    const result = await store.checkIn({ clientUuid, patientId: index.idOf(doctor, c), specialty, priority: 'normal', reason: c.reason }, new Date());
    if (!result) throw new Error(`Không cấp số được cho ca ${c.id}`);
    rows.push({ number: result.item.number, id: c.id, name: c.patient.fullName, title: c.title, created: result.created });
  }

  const who = USERS.find((u) => u.id === doctor)!.name;
  const fresh = rows.filter((r) => r.created).length;
  console.log(`${who} · ${SPECIALTY_LABEL[specialty]} · ${opts.warmup ? 'CA LÀM QUEN (không tính số đo)' : 'ca tính số đo'} · ngày ${day} · lần ${opts.round}`);
  console.log(fresh === rows.length ? `Đã xếp ${fresh} lượt vào hàng chờ:` : `Đã có sẵn ${rows.length - fresh} lượt từ lần chạy trước, xếp thêm ${fresh} lượt:`);
  for (const r of rows) console.log(`  số ${pad3(r.number)}  ${r.id.padEnd(4)} ${r.name.padEnd(22)} ${r.title}${r.created ? '' : '  (đã có)'}`);
  if (fresh < rows.length) console.log('Lượt "đã có" có thể đã khám xong hoặc đã hủy: xem màn hình "Hàng chờ". Muốn xếp lại cả nhóm, thêm "round=2".');
}

export async function clear(opts: { force: boolean }): Promise<void> {
  const { medplum, store } = await openClinic();
  const day = vnDay(new Date());
  const items = sortQueue(await store.listQueue(day));
  let cancelled = 0;
  for (const i of items.filter((x) => x.status === 'waiting')) {
    if ((await store.cancelVisit(i.id)) === 'ok') cancelled += 1;
  }
  console.log(`Đã hủy ${cancelled} lượt đang chờ của ngày ${day}.`);

  const inExam = items.filter((x) => x.status === 'in-exam');
  if (!inExam.length) return;
  if (!opts.force) {
    console.log(`Còn ${inExam.length} lượt ĐANG KHÁM DỞ (đã mở hồ sơ, chưa ký), giữ nguyên:`);
    for (const i of inExam) console.log(`  số ${pad3(i.number)}  ${i.patientName} · ${i.doctorName ?? '?'}`);
    console.log('Lượt khám dở không tính vào p50/p90 (chưa ký) và được đếm riêng khi xuất. Bác sĩ đó ký tiếp được bằng "Tiếp tục khám".');
    console.log('Muốn hủy luôn để hàng chờ sạch cho bác sĩ sau: "pnpm trial clear force" (ghi lại trong phiếu quan sát).');
    return;
  }
  // Ứng dụng không có thao tác hủy lượt đang khám. Ở phòng khám thử, lệnh dọn sửa thẳng trạng thái bằng tài khoản máy:
  // lượt bị hủy không bao giờ thành "đã xong", nên không vào p50/p90, và vẫn được đếm ở cột "mở rồi không ký" khi xuất.
  for (const i of inExam) {
    const enc = await medplum.readResource('Encounter', i.id);
    await medplum.updateResource<Encounter>({ ...enc, status: 'cancelled' });
    console.log(`Đã hủy lượt đang khám dở: số ${pad3(i.number)}  ${i.patientName} · ${i.doctorName ?? '?'}`);
  }
}
