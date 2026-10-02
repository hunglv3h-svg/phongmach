import { MedplumClient, isNotFound, normalizeOperationOutcome } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import {
  SYSTEMS,
  buildPatient,
  clientUuidQuery,
  rankByPhoneSuffix,
  toPatientSummary,
  type NewPatientInput,
  type PatientSummary,
  type SearchIntent,
} from '@phongmach/fhir-vn-model';
import type { ClinicStore, StoreFactory } from './store.js';
import type { Tenant } from './tenants.js';

/** Số kết quả lấy về khi tìm theo đoạn số, trước khi xếp hạng theo "kết thúc bằng". */
const FRAGMENT_FETCH = 50;

export class MedplumClinicStore implements ClinicStore {
  constructor(private readonly medplum: MedplumClient) {}

  async searchPatients(intent: SearchIntent, limit: number): Promise<PatientSummary[]> {
    switch (intent.kind) {
      case 'empty':
        return [];
      case 'cccd':
        return this.search({ identifier: `${SYSTEMS.cccd}|${intent.cccd}`, _count: String(limit) });
      case 'phone':
        return this.search({ phone: intent.phone, _count: String(limit) });
      case 'phone-fragment': {
        const found = await this.search({ 'phone:contains': intent.digits, _count: String(FRAGMENT_FETCH) });
        return rankByPhoneSuffix(found, intent.digits).slice(0, limit);
      }
      case 'name': {
        // Mỗi token là một điều kiện AND; tên không dấu khớp nhờ HumanName không dấu thêm lúc tạo (T-NAME).
        const params = new URLSearchParams();
        for (const token of intent.tokens) params.append('name', token);
        params.set('_count', String(limit));
        return this.search(params);
      }
    }
  }

  async createPatient(input: NewPatientInput): Promise<{ patient: PatientSummary; created: boolean }> {
    const patient = buildPatient(input);
    const query = clientUuidQuery(input.clientUuid.toLowerCase());
    const existing = await this.medplum.searchOne('Patient', query);
    if (existing) return { patient: toPatientSummary(existing), created: false };
    // Create có điều kiện để hai yêu cầu đồng thời cùng một clientUuid vẫn chỉ tạo một bản ghi.
    const saved = await this.medplum.createResourceIfNoneExist(patient, query);
    return { patient: toPatientSummary(saved), created: true };
  }

  async readPatient(id: string): Promise<PatientSummary | undefined> {
    try {
      return toPatientSummary(await this.medplum.readResource('Patient', id));
    } catch (err) {
      if (isNotFound(normalizeOperationOutcome(err))) return undefined;
      throw err;
    }
  }

  private async search(query: URLSearchParams | Record<string, string>): Promise<PatientSummary[]> {
    const patients: Patient[] = await this.medplum.searchResources('Patient', query);
    return patients.map(toPatientSummary);
  }
}

/** Mỗi phòng khám một MedplumClient đăng nhập bằng tài khoản máy riêng (client credentials). */
export class MedplumTenants {
  private readonly clients = new Map<string, Promise<MedplumClient>>();
  private readonly tenants: Map<string, Tenant>;

  constructor(
    private readonly baseUrl: string,
    tenants: Tenant[]
  ) {
    this.tenants = new Map(tenants.map((t) => [t.slug, t]));
  }

  readonly store: StoreFactory = async (slug) => new MedplumClinicStore(await this.client(slug));

  private client(slug: string): Promise<MedplumClient> {
    const tenant = this.tenants.get(slug);
    if (!tenant) return Promise.reject(new Error(`Phòng khám không tồn tại: ${slug}`));
    let client = this.clients.get(slug);
    if (!client) {
      client = this.login(tenant);
      this.clients.set(slug, client);
      // Đăng nhập lỗi thì lần sau thử lại thay vì giữ kết quả lỗi mãi.
      client.catch(() => this.clients.delete(slug));
    }
    return client;
  }

  private async login(tenant: Tenant): Promise<MedplumClient> {
    // cacheTime 0: BFF phục vụ nhiều người dùng, không được trả bản đọc cũ từ bộ nhớ đệm của client.
    const medplum = new MedplumClient({ baseUrl: this.baseUrl, clientId: tenant.clientId, clientSecret: tenant.secret, cacheTime: 0 });
    await medplum.startClientLogin(tenant.clientId, tenant.secret);
    return medplum;
  }
}
