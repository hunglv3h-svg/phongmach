import { randomUUID } from 'node:crypto';
import { DomainError, classifyQuery, type PatientSummary } from '@phongmach/fhir-vn-model';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { AuditAction, AuditEntry, AuditSink } from './audit.js';
import type { Session, SessionService } from './session.js';
import type { StoreFactory } from './store.js';
import type { TenantsFile } from './tenants.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

export interface AppDeps {
  tenants: TenantsFile;
  stores: StoreFactory;
  audit: AuditSink;
  sessions: SessionService;
  logLevel?: string;
  /** Dùng trong kiểm thử để bắt log. */
  logStream?: NodeJS.WritableStream;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loginBody = z.object({ tenant: z.string().min(1).max(64), userId: z.string().min(1).max(64) });
const searchQuery = z.object({ q: z.string().max(100).default(''), limit: z.coerce.number().int().min(1).max(50).default(20) });
const createBody = z.object({
  clientUuid: z.uuid(),
  fullName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  cccd: z.string().max(20).optional(),
  birthDate: z.string().max(10).optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
});
const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: {
      level: deps.logLevel ?? 'info',
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      // Quy tắc "không PII trong log": chỉ ghi phương thức và đường dẫn, bỏ chuỗi truy vấn (có thể chứa số điện thoại, CCCD, tên).
      serializers: {
        req: (req: FastifyRequest) => ({ method: req.method, path: req.url.split('?')[0], id: req.id }),
      },
      redact: ['req.headers.authorization'],
    },
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'bad-request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof DomainError) return reply.code(422).send({ error: err.code, message: err.message });
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.code ?? 'bad-request', message: err.message });
    }
    // Chỉ ghi tên và thông điệp lỗi, không ghi cả đối tượng lỗi (có thể mang theo dữ liệu bệnh nhân).
    req.log.error({ errName: err.name, errMessage: err.message }, 'lỗi không xử lý được');
    return reply.code(500).send({ error: 'internal' });
  });

  const record = (req: FastifyRequest, action: AuditAction, extra: Partial<AuditEntry> = {}) => {
    const s = req.session!;
    return deps.audit.record({
      ts: new Date().toISOString(),
      requestId: req.id,
      tenant: s.tenant,
      userId: s.userId,
      userName: s.userName,
      role: s.role,
      action,
      outcome: 'ok',
      ...extra,
    });
  };

  async function requireSession(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const session = token ? await deps.sessions.verify(token) : undefined;
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });
    req.session = session;
  }

  app.get('/api/health', async () => ({ ok: true }));

  // Phiên demo: chưa có xác thực thật (T-IDP). Server chỉ khởi động khi DEMO_AUTH=1 (xem server.ts).
  app.get('/api/session/demo-users', async () => ({
    demo: true,
    tenants: deps.tenants.tenants.map((t) => ({
      slug: t.slug,
      name: t.name,
      users: deps.tenants.users.filter((u) => u.tenant === t.slug).map((u) => ({ id: u.id, name: u.name, role: u.role })),
    })),
  }));

  app.post('/api/session', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const user = deps.tenants.users.find((u) => u.id === body.userId && u.tenant === body.tenant);
    if (!user) return reply.code(401).send({ error: 'invalid-login' });
    const session: Session = { userId: user.id, userName: user.name, role: user.role, tenant: user.tenant };
    req.session = session;
    await record(req, 'login');
    const tenant = deps.tenants.tenants.find((t) => t.slug === user.tenant)!;
    return { token: await deps.sessions.sign(session), user: { id: user.id, name: user.name, role: user.role }, tenant: { slug: tenant.slug, name: tenant.name } };
  });

  app.register(async (api) => {
    api.addHook('onRequest', requireSession);

    api.get('/api/patients/search', async (req) => {
      const { q, limit } = searchQuery.parse(req.query);
      const intent = classifyQuery(q);
      const store = await deps.stores(req.session!.tenant);
      const results = await store.searchPatients(intent, limit);
      // Ghi nhật ký trước khi trả dữ liệu: nếu ghi lỗi thì yêu cầu lỗi và không có dữ liệu nào rời khỏi BFF.
      await record(req, 'search', { queryKind: intent.kind, resultCount: results.length, resourceIds: results.map((r) => r.id) });
      return { intent: intent.kind, results };
    });

    api.post('/api/patients', async (req, reply) => {
      const body = createBody.parse(req.body);
      const store = await deps.stores(req.session!.tenant);
      const { patient, created } = await store.createPatient(body);
      await record(req, 'create', { resourceIds: [patient.id], resultCount: created ? 1 : 0 });
      return reply.code(created ? 201 : 200).send({ patient, created });
    });

    api.get<{ Params: { id: string } }>('/api/patients/:id', async (req, reply) => {
      if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not-found' });
      const store = await deps.stores(req.session!.tenant);
      const patient: PatientSummary | undefined = await store.readPatient(req.params.id);
      if (!patient) return reply.code(404).send({ error: 'not-found' });
      await record(req, 'read', { resourceIds: [patient.id] });
      return { patient };
    });

    api.get('/api/audit', async (req, reply) => {
      const { limit } = auditQuery.parse(req.query);
      if (req.session!.role !== 'owner') {
        await record(req, 'audit-read', { outcome: 'denied' });
        return reply.code(403).send({ error: 'forbidden' });
      }
      const entries = await deps.audit.recent(req.session!.tenant, limit);
      await record(req, 'audit-read', { resultCount: entries.length });
      return { entries };
    });
  });

  return app;
}
