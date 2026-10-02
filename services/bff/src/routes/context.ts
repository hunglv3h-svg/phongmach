import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SimulatedGateway } from '../gateway.js';
import type { AuditAction, AuditEntry, AuditSink } from '../audit.js';
import type { ClinicStore, StoreFactory } from '../store.js';
import type { Role, TenantsFile } from '../tenants.js';
import type { RulesConfig } from '@phongmach/rules';

export const ALL_ROLES: Role[] = ['owner', 'doctor', 'assistant'];
export const CLINICAL_ROLES: Role[] = ['owner', 'doctor'];

export interface RouteContext {
  tenants: TenantsFile;
  audit: AuditSink;
  simulator?: SimulatedGateway | undefined;
  rules?: Partial<RulesConfig> | undefined;
  now: () => Date;
  store(req: FastifyRequest): Promise<ClinicStore>;
  /** Ghi nhật ký truy cập. Gọi TRƯỚC khi trả dữ liệu: ghi lỗi thì yêu cầu lỗi và không có dữ liệu nào rời BFF. */
  record(req: FastifyRequest, action: AuditAction, extra?: Partial<AuditEntry>): Promise<void>;
  /** preHandler chỉ cho các vai trò được liệt kê; ghi nhật ký lần bị từ chối. */
  guard(action: AuditAction, ...roles: Role[]): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  stores: StoreFactory;
}
