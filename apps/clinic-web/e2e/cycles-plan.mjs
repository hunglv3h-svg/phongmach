// Kế hoạch của bài e2e 20 chu kỳ (M0-2), sinh từ một hạt giống: cùng hạt giống thì cùng kế hoạch, để chạy lại đúng một lần chạy cũ.
// Hàm thuần, không đụng trình duyệt hay mạng (có kiểm thử đơn vị ở cycles-plan.test.mjs).
//
// Mỗi chu kỳ một bệnh nhân mới đi hết đường trên một máy, qua năm thao tác:
export const ACTIONS = ['tạo bệnh nhân', 'cấp số', 'gọi vào khám', 'khám', 'ký và in'];
/** Thao tác có gửi một yêu cầu ghi lên máy chủ (thao tác "khám" chỉ ghi bản nháp trên máy). */
export const WRITES = [0, 1, 2, 4];
const SIGN = 4;

/** Đơn mẫu người lớn dùng trong bài, kèm số dòng thuốc của mỗi đơn (bài so lại với số dòng trên màn hình). */
export const TEMPLATES = [
  { id: 'viem-hong-cap', lines: 2 },
  { id: 'nhiem-tru-ho-hap-tren', lines: 3 },
  { id: 'viem-phe-quan-cap', lines: 2 },
  { id: 'viem-da-day', lines: 3 },
  { id: 'tieu-chay-cap', lines: 3 },
];
/** Chẩn đoán thêm ngoài chẩn đoán của đơn mẫu: chuỗi gõ tắt và mã ICD-10 được chọn. */
export const EXTRA_DX = { query: 'tang huyet ap', code: 'I10' };
/** Nhóm sinh hiệu; mỗi nhóm thành đúng một Observation (huyết áp là một bảng gồm hai số). */
export const VITAL_GROUPS = [
  { temperatureC: ['36,6', '37,2', '38,5'] },
  { pulse: ['72', '88', '96'] },
  { systolic: ['118', '126', '135'], diastolic: ['76', '82', '85'] },
  { weightKg: ['54', '61,5', '68'] },
  { spo2: ['97', '98', '99'] },
];

const FAMILY = ['An', 'Bình', 'Châu', 'Dung', 'Giang', 'Hạnh', 'Khánh', 'Lâm', 'Minh', 'Ngân'];
const GIVEN = ['Phúc', 'Quỳnh', 'Sơn', 'Thảo', 'Uyên', 'Vinh', 'Xuân', 'Yến', 'Đạt', 'Huy'];

/** Bộ sinh số giả ngẫu nhiên xác định (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hạt giống từ biến môi trường (số nguyên không âm dưới 2^32); không có thì chọn ngẫu nhiên. */
export function parseSeed(text) {
  if (text === undefined || text === '') return Math.floor(Math.random() * 2 ** 32);
  if (!/^\d{1,10}$/.test(text) || Number(text) >= 2 ** 32) throw new Error(`Hạt giống phải là số nguyên từ 0 đến ${2 ** 32 - 1}, đang là "${text}"`);
  return Number(text);
}

/**
 * Kế hoạch cho `cycles` chu kỳ. Mỗi chu kỳ:
 * - `cut`, `restore`: ngắt mạng (`context.setOffline`) ngay trước thao tác số `cut`, bật lại ngay trước thao tác số `restore`
 *   (5 = sau khi ký). Luôn có 0 ≤ cut < restore ≤ 5, tức mỗi chu kỳ đúng một lần ngắt và một lần khôi phục, ít nhất một thao tác
 *   làm lúc mất mạng.
 * - `lost`: thao tác ghi làm lúc CÓ mạng (trước khi ngắt hoặc sau khi bật lại) bị mất phản hồi: máy chủ đã ghi nhưng trình duyệt thấy
 *   lỗi mạng. Bốn thao tác ghi và "không mất" chia đều qua các chu kỳ.
 * - `reload`: tải lại trang ngay sau thao tác này, khi đang mất mạng (vỏ ứng dụng từ service worker). Khoảng 40% số chu kỳ.
 * - `crash`: máy "sập" đúng lúc tờ đơn ký khi mất mạng được in (trang bị đóng ngay bên trong print()). Chỉ ở chu kỳ ký trong lúc
 *   mất mạng, cứ hai chu kỳ như vậy thì một; luôn có ít nhất một chu kỳ như vậy khi có từ 5 chu kỳ.
 * - dữ liệu nhập: bệnh nhân, sinh hiệu, đơn mẫu, chẩn đoán thêm, và số bản ghi máy chủ phải có (`expect`).
 */
export function makePlan(seed, cycles) {
  const rand = rng(seed);
  const int = (n) => Math.floor(rand() * n);
  const pick = (list) => list[int(list.length)];
  const shuffled = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const deck = (kinds) => shuffled(Array.from({ length: cycles }, (_, i) => kinds[i % kinds.length]));

  const lostDeck = deck([...WRITES, undefined]);
  const reloadDeck = deck([true, true, false, false, false]);
  const phones = new Set();
  const plan = [];
  for (let i = 0; i < cycles; i++) {
    const lost = lostDeck[i];
    const windows = [];
    for (let cut = 0; cut < ACTIONS.length; cut++) {
      for (let restore = cut + 1; restore <= ACTIONS.length; restore++) {
        if (lost === undefined || lost < cut || lost >= restore) windows.push({ cut, restore });
      }
    }
    const { cut, restore } = pick(windows);
    const reload = reloadDeck[i] ? cut + int(restore - cut) : undefined;

    let phone;
    do phone = `09${String(int(1e8)).padStart(8, '0')}`;
    while (phones.has(phone));
    phones.add(phone);
    const vitals = {};
    let observations = 0;
    for (const group of VITAL_GROUPS) {
      if (rand() < 0.5) continue;
      const choice = int(3);
      for (const [field, values] of Object.entries(group)) vitals[field] = values[choice];
      observations += 1;
    }
    const template = pick(TEMPLATES);
    const extraDx = rand() < 0.3;
    const n = String(i + 1).padStart(3, '0');
    plan.push({
      index: i + 1,
      cut,
      restore,
      ...(lost !== undefined ? { lost } : {}),
      ...(reload !== undefined ? { reload } : {}),
      crash: false,
      patient: {
        // Tên chỉ có chữ (ô tìm hiểu chuỗi có số là số điện thoại); khác nhau giữa các chu kỳ của một lần chạy.
        fullName: `Zc ${FAMILY[Math.floor(i / GIVEN.length) % FAMILY.length]} ${GIVEN[i % GIVEN.length]}${i >= FAMILY.length * GIVEN.length ? ` ${pick(FAMILY)} ${pick(GIVEN)}` : ''}`,
        phone,
        // CCCD giả có tiền tố 000 (mã tỉnh không tồn tại) để không nhầm với số thật.
        cccd: `000${String(int(1e9)).padStart(9, '0')}`,
        birthDate: `${1950 + int(50)}-${String(1 + int(12)).padStart(2, '0')}-${String(1 + int(28)).padStart(2, '0')}`,
        gender: pick(['male', 'female']),
      },
      vitals,
      symptoms: `Triệu chứng của chu kỳ ${n}: ho, đau họng`,
      template: template.id,
      extraDx,
      expect: { observations, conditions: 1 + (extraDx ? 1 : 0), medicationRequests: template.lines },
    });
  }

  // Máy sập đúng lúc in: chỉ ở chu kỳ ký trong lúc mất mạng (đơn in từ dữ liệu trên máy, máy chủ chưa có gì).
  const offlineSign = (c) => c.cut <= SIGN && c.restore > SIGN;
  if (cycles >= 5 && !plan.some(offlineSign)) plan.find((c) => c.lost === undefined).restore = ACTIONS.length;
  plan.filter(offlineSign).forEach((c, k) => {
    if (k % 2 === 0) c.crash = true;
    // Trang đã bị đóng lúc in thì không còn gì để tải lại sau khi ký.
    if (c.crash && c.reload === SIGN) delete c.reload;
  });
  return plan;
}

/** Một dòng mô tả kế hoạch của một chu kỳ, để in ra và đối chiếu khi chạy lại. */
export function describe(c) {
  const parts = [`ngắt trước "${ACTIONS[c.cut]}", bật lại ${c.restore < ACTIONS.length ? `trước "${ACTIONS[c.restore]}"` : 'sau khi ký'}`];
  if (c.lost !== undefined) parts.push(`mất phản hồi ở "${ACTIONS[c.lost]}"`);
  if (c.reload !== undefined) parts.push(`tải lại trang sau "${ACTIONS[c.reload]}"`);
  if (c.crash) parts.push('máy sập lúc in');
  return parts.join('; ');
}
