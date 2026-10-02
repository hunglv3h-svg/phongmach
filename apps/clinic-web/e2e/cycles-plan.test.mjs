// Kiểm kế hoạch của bài e2e 20 chu kỳ: cùng hạt giống thì cùng kế hoạch, và hạt giống nào cũng gây đủ các kiểu lỗi mà bài cần
// (nếu không, một lần chạy "xanh" có thể chỉ vì hạt giống đó không đụng tới ca khó).
import { describe as suite, expect, it } from 'vitest';
import { ACTIONS, TEMPLATES, VITAL_GROUPS, WRITES, describe, makePlan, parseSeed } from './cycles-plan.mjs';

const SEEDS = [0, 1, 7, 12345, 20261113, 2 ** 32 - 1, ...Array.from({ length: 200 }, (_, i) => 1000 + i * 7919)];
const SIGN = ACTIONS.length - 1;

suite('makePlan', () => {
  it('cùng hạt giống và số chu kỳ thì ra đúng một kế hoạch; hạt giống khác thì ra kế hoạch khác', () => {
    expect(makePlan(12345, 20)).toEqual(makePlan(12345, 20));
    expect(makePlan(12345, 20).map(describe)).not.toEqual(makePlan(12346, 20).map(describe));
  });

  it('mỗi chu kỳ đúng một lần ngắt rồi một lần khôi phục, ít nhất một thao tác làm lúc mất mạng', () => {
    for (const seed of SEEDS) {
      for (const c of makePlan(seed, 20)) {
        expect(c.cut).toBeGreaterThanOrEqual(0);
        expect(c.restore).toBeGreaterThan(c.cut);
        expect(c.restore).toBeLessThanOrEqual(ACTIONS.length);
      }
    }
  });

  it('mất phản hồi chỉ ở thao tác ghi làm lúc có mạng; 20 chu kỳ thì mỗi thao tác ghi bị mất phản hồi đúng 4 lần', () => {
    for (const seed of SEEDS) {
      const plan = makePlan(seed, 20);
      for (const c of plan.filter((x) => x.lost !== undefined)) {
        expect(WRITES).toContain(c.lost);
        expect(c.lost < c.cut || c.lost >= c.restore).toBe(true);
      }
      for (const action of WRITES) expect(plan.filter((c) => c.lost === action)).toHaveLength(4);
    }
  });

  it('tải lại trang chỉ trong lúc đang ngắt mạng; 20 chu kỳ thì có 8 lần, trừ những lần rơi vào sau khi ký ở chu kỳ máy sập', () => {
    for (const seed of SEEDS) {
      const reloads = makePlan(seed, 20).filter((c) => c.reload !== undefined);
      for (const c of reloads) {
        expect(c.reload).toBeGreaterThanOrEqual(c.cut);
        expect(c.reload).toBeLessThan(c.restore);
      }
      expect(reloads.length).toBeGreaterThanOrEqual(4);
      expect(reloads.length).toBeLessThanOrEqual(8);
    }
  });

  it('máy sập lúc in chỉ ở chu kỳ ký trong lúc mất mạng, luôn có ít nhất một lần, và không còn tải lại trang sau khi ký ở chu kỳ đó', () => {
    for (const seed of SEEDS) {
      for (const cycles of [5, 20, 100]) {
        const crashes = makePlan(seed, cycles).filter((c) => c.crash);
        expect(crashes.length).toBeGreaterThanOrEqual(1);
        for (const c of crashes) {
          expect(c.cut <= SIGN && c.restore === ACTIONS.length).toBe(true);
          expect(c.reload).not.toBe(SIGN);
        }
      }
    }
  });

  it('dữ liệu nhập: bệnh nhân khác nhau trong một lần chạy, tên chỉ có chữ, số bản ghi phải có khớp với những gì sẽ nhập', () => {
    for (const cycles of [20, 100]) {
      const plan = makePlan(12345, cycles);
      for (const key of ['fullName', 'phone', 'cccd']) expect(new Set(plan.map((c) => c.patient[key])).size).toBe(cycles);
      for (const c of plan) {
        expect(c.patient.fullName).toMatch(/^Zc \p{L}+ \p{L}+/u);
        expect(c.patient.fullName).not.toMatch(/\d/);
        expect(c.patient.phone).toMatch(/^09\d{8}$/);
        expect(c.patient.cccd).toMatch(/^000\d{9}$/);
        expect(c.expect.medicationRequests).toBe(TEMPLATES.find((t) => t.id === c.template).lines);
        expect(c.expect.conditions).toBe(c.extraDx ? 2 : 1);
        // Mỗi nhóm sinh hiệu một Observation; huyết áp phải có đủ cả hai số.
        expect(c.expect.observations).toBe(VITAL_GROUPS.filter((g) => Object.keys(g).every((f) => f in c.vitals)).length);
        expect('systolic' in c.vitals).toBe('diastolic' in c.vitals);
      }
    }
  });

  it('mô tả chu kỳ nêu đủ lúc ngắt, lúc bật lại và các lỗi thêm', () => {
    expect(describe({ cut: 1, restore: 5, lost: 0, reload: 3, crash: true })).toBe('ngắt trước "cấp số", bật lại sau khi ký; mất phản hồi ở "tạo bệnh nhân"; tải lại trang sau "khám"; máy sập lúc in');
    expect(describe({ cut: 0, restore: 2, crash: false })).toBe('ngắt trước "tạo bệnh nhân", bật lại trước "gọi vào khám"');
  });
});

suite('parseSeed', () => {
  it('nhận số nguyên không âm dưới 2^32, từ chối thứ khác; không có thì tự chọn', () => {
    expect(parseSeed('12345')).toBe(12345);
    expect(parseSeed('0')).toBe(0);
    expect(() => parseSeed('abc')).toThrow(/Hạt giống/);
    expect(() => parseSeed('-1')).toThrow(/Hạt giống/);
    expect(() => parseSeed('4294967296')).toThrow(/Hạt giống/);
    const picked = parseSeed(undefined);
    expect(Number.isInteger(picked) && picked >= 0 && picked < 2 ** 32).toBe(true);
  });
});
