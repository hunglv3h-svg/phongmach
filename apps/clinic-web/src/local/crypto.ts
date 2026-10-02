// Mã hóa dữ liệu lưu trên máy (kế hoạch, OFF-5). Giới hạn: khóa nằm cùng máy với dữ liệu; xem kế hoạch mục 5.8 trước khi
// coi đây là biện pháp bảo vệ trước người có quyền vào máy.

/** Một giá trị đã mã hóa: IV ngẫu nhiên 96 bit + bản mã AES-GCM (kèm thẻ xác thực 128 bit). */
export interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  ct: ArrayBuffer;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Khóa AES-GCM 256 bit, `extractable: false`: JavaScript (kể cả của chính ứng dụng) không xuất được khóa thô,
 * chỉ dùng được để mã hóa và giải mã. Khóa vẫn được trình duyệt lưu trên đĩa khi cất vào IndexedDB.
 */
export function newKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Mã hóa `value` (dạng JSON). `aad` (dữ liệu kèm) gắn bản mã với chỗ của nó (bảng + id):
 * chép bản mã sang chỗ khác thì giải mã thất bại thay vì trả về dữ liệu của bản ghi khác.
 */
export async function seal(key: CryptoKey, aad: string, value: unknown): Promise<Sealed> {
  // IV mới cho mỗi lần ghi: dùng lại IV với cùng khóa làm lộ nội dung của AES-GCM.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, encoder.encode(JSON.stringify(value)));
  return { iv, ct };
}

/** Giải mã; bản mã bị sửa, bị chuyển chỗ hoặc khác khóa đều làm hàm này ném lỗi. */
export async function unseal<T>(key: CryptoKey, aad: string, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: encoder.encode(aad) }, key, sealed.ct);
  return JSON.parse(decoder.decode(plain)) as T;
}
