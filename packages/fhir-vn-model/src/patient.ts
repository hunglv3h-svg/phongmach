import type { HumanName, Patient } from '@medplum/fhirtypes';
import { normalizeCccd, maskCccd } from './cccd.js';
import { EXTENSIONS, SYSTEMS } from './identifiers.js';
import { normalizePhone } from './phone.js';
import { parseFullName, stripDiacritics } from './text.js';

export type Gender = 'male' | 'female' | 'other' | 'unknown';

export interface NewPatientInput {
  /** UUID do client sinh một lần cho mỗi biểu mẫu, để gửi lại không tạo bệnh nhân trùng (T-IDEM). */
  clientUuid: string;
  fullName: string;
  phone?: string;
  cccd?: string;
  /** YYYY-MM-DD */
  birthDate?: string;
  gender?: Gender;
}

export class DomainError extends Error {
  constructor(
    public readonly code: 'invalid-name' | 'invalid-phone' | 'invalid-cccd' | 'invalid-birth-date' | 'invalid-client-uuid',
    message: string
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dựng tài nguyên Patient từ dữ liệu nhập nhanh ở quầy tiếp đón.
 * Thêm một HumanName thứ hai không dấu (đánh dấu bằng extension) để tìm "nguyen" ra "Nguyễn" (T-NAME).
 */
export function buildPatient(input: NewPatientInput): Patient {
  if (!UUID_RE.test(input.clientUuid)) throw new DomainError('invalid-client-uuid', 'clientUuid phải là UUID');

  const parsed = parseFullName(input.fullName);
  if (!parsed) throw new DomainError('invalid-name', 'Nhập đủ họ và tên (ít nhất hai từ)');
  const { family, given } = parsed;

  const names: HumanName[] = [{ use: 'official', family, given, text: [family, ...given].join(' ') }];
  const foldedFamily = stripDiacritics(family);
  const foldedGiven = given.map(stripDiacritics);
  if (foldedFamily !== family || foldedGiven.some((g, i) => g !== given[i])) {
    names.push({
      use: 'nickname',
      family: foldedFamily,
      given: foldedGiven,
      text: [foldedFamily, ...foldedGiven].join(' '),
      extension: [{ url: EXTENSIONS.nameFolded, valueBoolean: true }],
    });
  }

  const patient: Patient = {
    resourceType: 'Patient',
    identifier: [{ system: SYSTEMS.clientUuid, value: input.clientUuid.toLowerCase() }],
    name: names,
  };

  if (input.phone?.trim()) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new DomainError('invalid-phone', 'Số điện thoại không hợp lệ');
    patient.telecom = [{ system: 'phone', value: phone, use: 'mobile' }];
  }

  if (input.cccd?.trim()) {
    const cccd = normalizeCccd(input.cccd);
    if (!cccd) throw new DomainError('invalid-cccd', 'CCCD phải gồm 12 chữ số');
    patient.identifier!.push({ system: SYSTEMS.cccd, value: cccd });
  }

  if (input.birthDate) {
    const date = new Date(`${input.birthDate}T00:00:00Z`);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(input.birthDate) && date <= new Date();
    if (!valid) throw new DomainError('invalid-birth-date', 'Ngày sinh không hợp lệ (YYYY-MM-DD, không ở tương lai)');
    patient.birthDate = input.birthDate;
  }

  if (input.gender) patient.gender = input.gender;
  return patient;
}

export interface PatientSummary {
  id: string;
  fullName: string;
  phone?: string;
  cccdMasked?: string;
  birthDate?: string;
  gender?: Gender;
}

/** Bản tóm tắt gửi cho giao diện: tên có dấu, CCCD đã che. */
export function toPatientSummary(patient: Patient): PatientSummary {
  const official = patient.name?.find((n) => !n.extension?.some((e) => e.url === EXTENSIONS.nameFolded)) ?? patient.name?.[0];
  const fullName = official?.text ?? [official?.family, ...(official?.given ?? [])].filter(Boolean).join(' ');
  const cccd = patient.identifier?.find((i) => i.system === SYSTEMS.cccd)?.value;
  const phone = patient.telecom?.find((t) => t.system === 'phone')?.value;
  return {
    id: patient.id ?? '',
    fullName,
    ...(phone ? { phone } : {}),
    ...(cccd ? { cccdMasked: maskCccd(cccd) } : {}),
    ...(patient.birthDate ? { birthDate: patient.birthDate } : {}),
    ...(patient.gender ? { gender: patient.gender as Gender } : {}),
  };
}

/** Xếp kết quả tìm theo đoạn số: số kết thúc bằng đoạn đó lên trước (4 số cuối), số chỉ chứa ở giữa xuống sau. */
export function rankByPhoneSuffix<T extends { phone?: string }>(items: T[], digits: string): T[] {
  const score = (p?: string) => (p?.endsWith(digits) ? 0 : 1);
  return [...items].sort((a, b) => score(a.phone) - score(b.phone));
}

