import { describe, expect, it } from 'vitest';
import {
  DomainError,
  EXTENSIONS,
  SYSTEMS,
  buildPatient,
  classifyQuery,
  clientUuidQuery,
  foldName,
  maskCccd,
  nameTokens,
  normalizeCccd,
  normalizePhone,
  parseFullName,
  patchPatient,
  rankByPhoneSuffix,
  stripDiacritics,
  toPatientSummary,
} from '../src/index.js';

const UUID = '3f2b8d1e-6c4a-4f0e-9a57-2d1c8b7e5a10';

describe('bỏ dấu tiếng Việt', () => {
  it('xử lý cả chữ đ và dấu kết hợp', () => {
    expect(stripDiacritics('Nguyễn Đức Thắng')).toBe('Nguyen Duc Thang');
    expect(stripDiacritics('Trần Thị Bích Hồng')).toBe('Tran Thi Bich Hong');
    expect(stripDiacritics('đặng Phạm')).toBe('dang Pham');
  });
  it('xử lý cả dạng NFD lẫn NFC', () => {
    const nfd = 'Nguyễn'.normalize('NFD');
    expect(stripDiacritics(nfd)).toBe('Nguyen');
  });
  it('foldName gộp khoảng trắng và chữ thường', () => {
    expect(foldName('  NGUYỄN   Văn  An ')).toBe('nguyen van an');
    expect(nameTokens('Nguyễn Văn An')).toEqual(['nguyen', 'van', 'an']);
    expect(nameTokens('   ')).toEqual([]);
  });
  it('tách họ và tên', () => {
    expect(parseFullName('Nguyễn  Văn An')).toEqual({ family: 'Nguyễn', given: ['Văn', 'An'] });
    expect(parseFullName('An')).toBeUndefined();
  });
});

describe('số điện thoại và CCCD', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['02838123456', '02838123456'],
  ])('chuẩn hóa %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
  it.each(['5678', '091234567', '1912345678', 'abc', ''])('từ chối %s', (input) => {
    expect(normalizePhone(input)).toBeUndefined();
  });
  it('CCCD đúng 12 chữ số', () => {
    expect(normalizeCccd('001 234 567 890')).toBe('001234567890');
    expect(normalizeCccd('12345678901')).toBeUndefined();
    expect(normalizeCccd('00123456789a')).toBeUndefined();
    expect(maskCccd('001234567890')).toBe('••••••••7890');
  });
});

describe('phân loại ô tìm kiếm', () => {
  it('4 số cuối là đoạn số điện thoại', () => {
    expect(classifyQuery('5678')).toEqual({ kind: 'phone-fragment', digits: '5678' });
  });
  it('số điện thoại đầy đủ, kể cả có +84', () => {
    expect(classifyQuery('0912 345 678')).toEqual({ kind: 'phone', phone: '0912345678' });
    expect(classifyQuery('+84912345678')).toEqual({ kind: 'phone', phone: '0912345678' });
  });
  it('12 chữ số là CCCD', () => {
    expect(classifyQuery('001234567890')).toEqual({ kind: 'cccd', cccd: '001234567890' });
  });
  it('tên có dấu hoặc không dấu đều ra cùng token', () => {
    expect(classifyQuery('Nguyễn Văn An')).toEqual({ kind: 'name', tokens: ['nguyen', 'van', 'an'] });
    expect(classifyQuery('nguyen van an')).toEqual({ kind: 'name', tokens: ['nguyen', 'van', 'an'] });
  });
  it('quá ngắn hoặc rỗng', () => {
    expect(classifyQuery('')).toEqual({ kind: 'empty' });
    expect(classifyQuery('  ')).toEqual({ kind: 'empty' });
    expect(classifyQuery('12')).toEqual({ kind: 'empty' });
  });
});

describe('dựng Patient', () => {
  it('thêm tên không dấu để tìm kiếm, đánh dấu bằng extension', () => {
    const p = buildPatient({ clientUuid: UUID, fullName: 'Nguyễn Văn An', phone: '+84 912 345 678', cccd: '001234567890', birthDate: '1985-03-15', gender: 'male' });
    expect(p.name).toHaveLength(2);
    expect(p.name?.[0]).toMatchObject({ use: 'official', family: 'Nguyễn', given: ['Văn', 'An'] });
    expect(p.name?.[1]).toMatchObject({ use: 'nickname', family: 'Nguyen', given: ['Van', 'An'] });
    expect(p.name?.[1]?.extension?.[0]?.url).toBe(EXTENSIONS.nameFolded);
    expect(p.telecom?.[0]?.value).toBe('0912345678');
    expect(p.identifier?.map((i) => i.system)).toEqual([SYSTEMS.clientUuid, SYSTEMS.cccd]);
  });
  it('không thêm tên thứ hai nếu tên vốn không dấu', () => {
    const p = buildPatient({ clientUuid: UUID, fullName: 'Tran Van Binh' });
    expect(p.name).toHaveLength(1);
  });
  it('clientUuid thành truy vấn If-None-Exist', () => {
    expect(clientUuidQuery(UUID)).toBe(`identifier=urn:phongmach:client-uuid|${UUID}`);
  });
  it.each([
    [{ fullName: 'An' }, 'invalid-name'],
    [{ fullName: 'Nguyễn Văn An', phone: '123' }, 'invalid-phone'],
    [{ fullName: 'Nguyễn Văn An', cccd: '123' }, 'invalid-cccd'],
    [{ fullName: 'Nguyễn Văn An', birthDate: '1985-02-30' }, 'invalid-birth-date'],
    [{ fullName: 'Nguyễn Văn An', birthDate: '2999-01-01' }, 'invalid-birth-date'],
  ])('từ chối dữ liệu sai %j', (input, code) => {
    expect(() => buildPatient({ clientUuid: UUID, ...input })).toThrowError(DomainError);
    try {
      buildPatient({ clientUuid: UUID, ...input });
    } catch (e) {
      expect((e as DomainError).code).toBe(code);
    }
  });
  it('từ chối clientUuid không phải UUID', () => {
    expect(() => buildPatient({ clientUuid: 'abc', fullName: 'Nguyễn Văn An' })).toThrowError(DomainError);
  });
  it('bản tóm tắt hiện tên có dấu và che CCCD', () => {
    const p = buildPatient({ clientUuid: UUID, fullName: 'Nguyễn Văn An', cccd: '001234567890', phone: '0912345678' });
    p.id = 'abc';
    expect(toPatientSummary(p)).toEqual({ id: 'abc', fullName: 'Nguyễn Văn An', phone: '0912345678', cccdMasked: '••••••••7890' });
  });
});

describe('xếp hạng theo 4 số cuối', () => {
  it('số kết thúc bằng đoạn đó lên trước', () => {
    const ranked = rankByPhoneSuffix([{ phone: '0956781234' }, { phone: '0912345678' }, { phone: '0907785678' }], '5678');
    expect(ranked.map((r) => r.phone)).toEqual(['0912345678', '0907785678', '0956781234']);
  });
});

describe('patchPatient', () => {
  const base = buildPatient({ clientUuid: '11111111-1111-4111-8111-111111111111', fullName: 'Nguyễn Văn An' });
  it('bổ sung CCCD và ngày sinh, giữ nguyên phần còn lại', () => {
    const p = patchPatient(base, { cccd: '000 123 456 789', birthDate: '1985-03-15' });
    expect(p.birthDate).toBe('1985-03-15');
    expect(p.identifier?.map((i) => i.value)).toEqual(['11111111-1111-4111-8111-111111111111', '000123456789']);
    expect(p.name).toEqual(base.name);
  });
  it('thay CCCD cũ chứ không thêm bản thứ hai', () => {
    const once = patchPatient(base, { cccd: '000123456789' });
    const twice = patchPatient(once, { cccd: '000987654321' });
    expect(twice.identifier?.filter((i) => i.system === SYSTEMS.cccd).map((i) => i.value)).toEqual(['000987654321']);
  });
  it('từ chối dữ liệu sai và không đụng vào bản gốc', () => {
    expect(() => patchPatient(base, { cccd: '123' })).toThrow(DomainError);
    expect(() => patchPatient(base, { birthDate: '2999-01-01' })).toThrow(DomainError);
    expect(base.identifier).toHaveLength(1);
  });
});
