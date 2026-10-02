import type { NewPatientInput, PatientSummary, SearchIntent } from '@phongmach/fhir-vn-model';

/** Truy cập dữ liệu của MỘT phòng khám. Mọi thứ khác trong BFF chỉ biết giao diện này, không biết Medplum. */
export interface ClinicStore {
  searchPatients(intent: SearchIntent, limit: number): Promise<PatientSummary[]>;
  /** `created` là false khi `clientUuid` đã được dùng: gửi lại không tạo bệnh nhân trùng. */
  createPatient(input: NewPatientInput): Promise<{ patient: PatientSummary; created: boolean }>;
  readPatient(id: string): Promise<PatientSummary | undefined>;
}

/** Trả về kho của phòng khám theo `slug`. `slug` luôn lấy từ phiên đã xác thực, không từ tham số của yêu cầu. */
export type StoreFactory = (tenantSlug: string) => Promise<ClinicStore>;
