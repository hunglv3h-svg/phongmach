import { describe, expect, it } from 'vitest';
import { ageText, formatDate, shortId } from './format';

const NOW = new Date('2026-10-02T09:00:00');

describe('tuổi', () => {
  it.each([
    ['1985-03-15', '41 tuổi'],
    ['1985-10-03', '40 tuổi'], // chưa đến sinh nhật năm nay
    ['1985-10-02', '41 tuổi'], // đúng sinh nhật
    ['2021-06-10', '5 tuổi'],
    ['2024-08-01', '2 tuổi 2 tháng'],
    ['2024-10-02', '2 tuổi'],
    ['2026-06-01', '4 tháng'],
    ['2026-10-01', '0 tháng'],
  ])('%s → %s', (birth, expected) => {
    expect(ageText(birth, NOW)).toBe(expected);
  });
  it('ngày sinh ở tương lai hoặc rỗng thì không hiện tuổi', () => {
    expect(ageText('2027-01-01', NOW)).toBeUndefined();
    expect(ageText(undefined, NOW)).toBeUndefined();
    expect(ageText('khong-phai-ngay', NOW)).toBeUndefined();
  });
  it('định dạng ngày và mã rút gọn', () => {
    expect(formatDate('1985-03-15')).toBe('15/03/1985');
    expect(shortId('4c8cb966-1111-2222-3333-444444444444')).toBe('4c8cb966');
  });
});
