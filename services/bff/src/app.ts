import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import { DomainError, classifyQuery, type PatientSummary } from '@phongmach/fhir-vn-model';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { RulesConfig } from '@phongmach/rules';
import type { AuditAction, AuditEntry, AuditSink } from './audit.js';
import type { SimulatedGateway } from './gateway.js';
import type { IdentityStore, StaffClaim } from './identity/index.js';
import { mfaRequired } from './identity/index.js';
import { registerClinicalRoutes } from './routes/clinical.js';
import type { RouteContext } from './routes/context.js';
import type { Session, SessionService } from './session.js';
import type { SessionStore } from './sessionStore.js';
import type { Role } from './tenants.js';
import { BusyError, type StoreFactory } from './store.js';
import type { TenantsFile } from './tenants.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

export type AppMode = 'real' | 'demo';

export interface AppDeps {
  /** Chế độ xác thực. 'real' và 'demo' LOẠI TRỪ nhau: chỉ một bộ route được đăng ký (§5.1). */
  mode: AppMode;
  tenants: TenantsFile;
  stores: StoreFactory;
  audit: AuditSink;
  sessions: SessionService;
  /** Bắt buộc ở mode 'real': danh tính nhân viên + kho phiên có thu hồi. */
  identity?: IdentityStore;
  sessionStore?: SessionStore;
  /** Tuổi refresh token (ms) ở mode 'real'. */
  refreshTtlMs?: number;
  /** Cổng mô phỏng (chỉ demo): có thì mở các điều khiển chèn lỗi. */
  simulator?: SimulatedGateway;
  /** Ngưỡng quy tắc kê đơn ghi đè mặc định (T-RULE). */
  rules?: Partial<RulesConfig>;
  /** Đồng hồ, để kiểm thử xác định. */
  now?: () => Date;
  logLevel?: string;
  /** Dùng trong kiểm thử để bắt log. */
  logStream?: NodeJS.WritableStream;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const demoLoginBody = z.object({ tenant: z.string().min(1).max(64), userId: z.string().min(1).max(64) });
const loginBody = z.object({ loginId: z.string().min(1).max(64), password: z.string().min(1).max(200) });
const mfaBody = z.object({ mfaToken: z.string().min(1), code: z.string().min(1).max(16), secret: z.string().max(64).optional() });
const selectTenantBody = z.object({ pretenantToken: z.string().min(1), tenant: z.string().min(1).max(64) });
const createStaffBody = z.object({
  userId: z.string().min(1).max(64),
  loginId: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  role: z.enum(['owner', 'doctor', 'assistant']),
  tenants: z.array(z.string().min(1).max(64)).min(1),
  password: z.string().min(8).max(200),
  practitionerId: z.string().max(64).optional(),
});
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

const REFRESH_COOKIE = 'pm_refresh';

export function buildApp(deps: AppDeps): FastifyInstance {
  const now = deps.now ?? (() => new Date());
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: {
      level: deps.logLevel ?? 'info',
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      // Quy tắc "không PII trong log": chỉ ghi phương thức và đường dẫn, bỏ chuỗi truy vấn (có thể chứa số điện thoại, CCCD, tên).
      // KHÔNG serialize body (route đăng nhập nhận mật khẩu/OTP/loginId trong body — không được lọt vào log, kể cả khi 400).
      serializers: {
        req: (req: FastifyRequest) => ({ method: req.method, path: req.url.split('?')[0], id: req.id }),
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  // Cookie refresh (HttpOnly, Secure, SameSite=Strict, path giới hạn /api/session) chỉ dùng ở mode 'real'.
  void app.register(cookie);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof ZodError) {
      // KHÔNG echo giá trị body (có thể là mật khẩu/OTP): chỉ nêu đường dẫn trường và thông điệp zod cố định.
      return reply.code(400).send({ error: 'bad-request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof DomainError) return reply.code(422).send({ error: err.code, message: err.message });
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.code ?? 'bad-request', message: err.message });
    }
    if (err instanceof BusyError) {
      req.log.warn({ what: err.what }, 'kho bận: lời ghi chưa được nhận sau các lần thử lại');
      return reply.code(503).send({ error: 'busy', retry: true, message: 'Máy chủ đang bận, hãy gửi lại: dữ liệu sẽ không bị trùng.' });
    }
    // Chỉ ghi tên và thông điệp lỗi, không ghi cả đối tượng lỗi (có thể mang theo dữ liệu bệnh nhân / thông tin đăng nhập).
    req.log.error({ errName: err.name, errMessage: err.message }, 'lỗi không xử lý được');
    return reply.code(500).send({ error: 'internal' });
  });

  // Ghi nhật ký đường DỮ LIỆU: bắt buộc có session (tenant/userId). Khẳng định lúc chạy (NIT-1): không có
  // session ⇒ ném ⇒ fail-closed, không có route dữ liệu nào được chạy mà thiếu danh tính trong nhật ký.
  const record = (req: FastifyRequest, action: AuditAction, extra: Partial<AuditEntry> = {}) => {
    const s = req.session;
    if (!s) throw new Error(`record() trên đường dữ liệu cần phiên (action=${action})`);
    return deps.audit.record({
      ts: now().toISOString(),
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

  // Ghi nhật ký đường ĐĂNG NHẬP tiền-phiên (§4.5): KHÔNG dùng req.session. Entry denied không mang
  // loginId/mật khẩu/OTP/SĐT/tên — chỉ outcome + requestId + ts (+ userId/tenant/role khi đã xác thực).
  const recordLogin = (req: FastifyRequest, outcome: 'ok' | 'denied', fields: { userId?: string; tenant?: string; role?: Role } = {}) =>
    deps.audit.record({
      ts: now().toISOString(),
      requestId: req.id,
      role: fields.role ?? 'system',
      action: 'login',
      outcome,
      ...(fields.userId ? { userId: fields.userId } : {}),
      ...(fields.tenant ? { tenant: fields.tenant } : {}),
    });

  async function requireSession(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const session = token ? await deps.sessions.verify(token) : undefined;
    // verify() đã kiểm chữ ký + hết hạn + typ + thu hồi sid (mọi route, gồm route đọc). Thiếu/sai ⇒ 401.
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });
    req.session = session;
  }

  app.get('/api/health', async () => ({ ok: true }));

  if (deps.mode === 'demo') registerDemoAuth(app);
  else registerRealAuth(app);

  // ---------- Chế độ DEMO: đăng nhập không mật khẩu, chọn người dùng demo (chỉ localhost, có nhãn) ----------
  function registerDemoAuth(api: FastifyInstance) {
    // Đăng xuất ở demo: không có phiên server để thu hồi (token demo không có sid), chỉ trả ok để
    // giao diện gọi `api.logout` thống nhất ở cả hai chế độ mà không gây 404.
    api.post('/api/session/logout', async () => ({ ok: true }));

    api.get('/api/session/demo-users', async () => ({
      demo: true,
      tenants: deps.tenants.tenants.map((t) => ({
        slug: t.slug,
        name: t.name,
        users: deps.tenants.users.filter((u) => u.tenant === t.slug).map((u) => ({ id: u.id, name: u.name, role: u.role })),
      })),
    }));

    api.post('/api/session', async (req, reply) => {
      const body = demoLoginBody.parse(req.body);
      const user = deps.tenants.users.find((u) => u.id === body.userId && u.tenant === body.tenant);
      if (!user) {
        await recordLogin(req, 'denied');
        return reply.code(401).send({ error: 'invalid-login' });
      }
      const session: Session = { userId: user.id, userName: user.name, role: user.role, tenant: user.tenant };
      req.session = session;
      await record(req, 'login');
      const tenant = deps.tenants.tenants.find((t) => t.slug === user.tenant)!;
      return { token: await deps.sessions.sign(session), user: { id: user.id, name: user.name, role: user.role }, tenant: { slug: tenant.slug, name: tenant.name } };
    });
  }

  // ---------- Chế độ THẬT: mật khẩu + MFA + vòng đời phiên (cấp/refresh/thu hồi) ----------
  function registerRealAuth(api: FastifyInstance) {
    const identity = deps.identity;
    const store = deps.sessionStore;
    const refreshTtlMs = deps.refreshTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    if (!identity || !store) throw new Error('mode real cần identity + sessionStore');

    const tenantInfo = (slug: string) => {
      const t = deps.tenants.tenants.find((x) => x.slug === slug);
      return t ? { slug: t.slug, name: t.name } : { slug, name: slug };
    };

    // Cấp phiên (access + refresh) cho một claim đã chọn đúng một tenant. Đặt cookie refresh HttpOnly.
    const grant = async (reply: FastifyReply, claim: StaffClaim, tenant: string) => {
      const { sid, refresh } = store.create({ userId: claim.sub, tenant, refreshTtlMs, now: now().getTime() });
      const session: Session = { userId: claim.sub, userName: claim.name, role: claim.role, tenant, sid };
      const token = await deps.sessions.sign(session);
      reply.setCookie(REFRESH_COOKIE, refresh, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/session', maxAge: Math.floor(refreshTtlMs / 1000) });
      return { token, user: { id: claim.sub, name: claim.name, role: claim.role }, tenant: tenantInfo(tenant) };
    };

    // Sau khi đã qua mật khẩu (+MFA): một tenant ⇒ cấp phiên; nhiều tenant ⇒ pre-tenant token (§4.1).
    const afterAuth = async (req: FastifyRequest, reply: FastifyReply, claim: StaffClaim) => {
      await recordLogin(req, 'ok', { userId: claim.sub, role: claim.role, ...(claim.tenants.length === 1 ? { tenant: claim.tenants[0]! } : {}) });
      if (claim.tenants.length === 1) return grant(reply, claim, claim.tenants[0]!);
      const pretenantToken = await deps.sessions.signPretenant({ userId: claim.sub, userName: claim.name, role: claim.role, allow: claim.tenants });
      return { chooseTenant: claim.tenants.map(tenantInfo), pretenantToken };
    };

    api.post('/api/session', async (req, reply) => {
      const body = loginBody.parse(req.body);
      const rateKey = `${body.loginId}|${req.ip}`;
      const res = await identity.authenticate(body.loginId, body.password, now(), rateKey);
      if (res.kind !== 'ok') {
        // Fail-closed: ghi audit TRƯỚC khi trả, kể cả nhánh từ chối. Sink ném ⇒ 500, không trả 401.
        await recordLogin(req, 'denied');
        if (res.kind === 'locked') return reply.code(429).send({ error: 'too-many-attempts' });
        return reply.code(401).send({ error: 'invalid-login' });
      }
      if (res.mfa === 'none') return afterAuth(req, reply, res.claim);
      if (res.mfa === 'verify') return { mfaRequired: true, mfaToken: await deps.sessions.signMfa({ userId: res.claim.sub, stage: 'verify' }) };
      // enroll: forced-enrollment gate (owner/doctor chưa đăng ký TOTP) — trả bí mật + QR, chưa cấp phiên.
      const enroll = identity.beginEnroll(res.claim.sub)!;
      return { enrollMfa: true, mfaToken: await deps.sessions.signMfa({ userId: res.claim.sub, stage: 'enroll' }), secret: enroll.secret, otpauth: enroll.otpauth };
    });

    api.post('/api/session/mfa', async (req, reply) => {
      const body = mfaBody.parse(req.body);
      const ticket = await deps.sessions.verifyMfa(body.mfaToken);
      if (!ticket) {
        await recordLogin(req, 'denied');
        return reply.code(401).send({ error: 'invalid-mfa' });
      }
      const claim =
        ticket.stage === 'verify'
          ? await identity.verifyMfaCode(ticket.userId, body.code, now())
          : body.secret
            ? await identity.completeEnroll(ticket.userId, body.secret, body.code, now())
            : undefined;
      if (!claim) {
        await recordLogin(req, 'denied');
        return reply.code(401).send({ error: 'invalid-mfa' });
      }
      return afterAuth(req, reply, claim);
    });

    api.post('/api/session/select-tenant', async (req, reply) => {
      const body = selectTenantBody.parse(req.body);
      const ticket = await deps.sessions.verifyPretenant(body.pretenantToken);
      if (!ticket) {
        await recordLogin(req, 'denied');
        return reply.code(401).send({ error: 'invalid-token' });
      }
      // Tenant PHẢI thuộc danh sách allow ĐÃ KÝ trong token, không phải do client tự khai (bất biến #1).
      if (!ticket.allow.includes(body.tenant)) {
        await recordLogin(req, 'denied', { userId: ticket.userId, role: ticket.role });
        return reply.code(403).send({ error: 'forbidden-tenant' });
      }
      await recordLogin(req, 'ok', { userId: ticket.userId, role: ticket.role, tenant: body.tenant });
      return grant(reply, { sub: ticket.userId, name: ticket.userName, role: ticket.role, tenants: ticket.allow }, body.tenant);
    });

    api.post('/api/session/refresh', async (req, reply) => {
      const refresh = req.cookies?.[REFRESH_COOKIE];
      if (!refresh) return reply.code(401).send({ error: 'no-refresh' });
      const r = store.consume(refresh, { refreshTtlMs, now: now().getTime() });
      if (r.kind !== 'ok') {
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/session' });
        // replay ⇒ sid đã bị thu hồi trong store.consume (phát hiện trộm token).
        return reply.code(401).send({ error: r.kind === 'replay' ? 'refresh-replayed' : 'invalid-refresh' });
      }
      // Danh tính + tenant lấy từ phiên đã lưu (sid), KHÔNG từ request. Dựng access mới mang cùng sid.
      const sidInfo = store.sessionInfo(r.sid);
      const rec = sidInfo ? identity.get(sidInfo.userId) : undefined;
      if (!sidInfo || !rec) {
        store.revoke(r.sid);
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/session' });
        return reply.code(401).send({ error: 'invalid-refresh' });
      }
      const session: Session = { userId: rec.userId, userName: rec.name, role: rec.role, tenant: sidInfo.tenant, sid: r.sid };
      const token = await deps.sessions.sign(session);
      reply.setCookie(REFRESH_COOKIE, r.refresh, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/session', maxAge: Math.floor(refreshTtlMs / 1000) });
      return { token, user: { id: rec.userId, name: rec.name, role: rec.role }, tenant: tenantInfo(sidInfo.tenant) };
    });

    api.post('/api/session/logout', { onRequest: requireSession }, async (req, reply) => {
      if (req.session?.sid) store.revoke(req.session.sid);
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/session' });
      return { ok: true };
    });

    api.delete<{ Params: { sid: string } }>('/api/sessions/:sid', { onRequest: requireSession }, async (req, reply) => {
      if (req.session!.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
      store.revoke(req.params.sid);
      return { ok: true };
    });

    // Quản trị owner: tạo nhân viên, gán vai trò/tenant, liệt kê.
    api.register(async (admin) => {
      admin.addHook('onRequest', requireSession);
      admin.addHook('onRequest', async (req, reply) => {
        if (req.session!.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
      });
      admin.get('/api/staff', async () => ({ staff: identity.list() }));
      admin.post('/api/staff', async (req, reply) => {
        const body = createStaffBody.parse(req.body);
        const rec = await identity.createStaff(body);
        return reply.code(201).send({ staff: { userId: rec.userId, loginId: rec.loginId, name: rec.name, role: rec.role, tenants: rec.tenants } });
      });
    });
  }

  const ctx: RouteContext = {
    tenants: deps.tenants,
    audit: deps.audit,
    simulator: deps.simulator,
    rules: deps.rules,
    now,
    stores: deps.stores,
    store: (req) => deps.stores(req.session!.tenant),
    record,
    guard: (action: AuditAction, ...roles: Role[]) => async (req, reply) => {
      if (roles.includes(req.session!.role)) return;
      await record(req, action, { outcome: 'denied' });
      return reply.code(403).send({ error: 'forbidden' });
    },
  };

  app.register(async (api) => {
    api.addHook('onRequest', requireSession);
    registerClinicalRoutes(api, ctx);

    api.get('/api/patients/search', async (req) => {
      const { q, limit } = searchQuery.parse(req.query);
      const intent = classifyQuery(q);
      const store = await deps.stores(req.session!.tenant);
      const { results, hasMore } = await store.searchPatients(intent, limit);
      await record(req, 'search', { queryKind: intent.kind, resultCount: results.length, resourceIds: results.map((r) => r.id) });
      return { intent: intent.kind, results, hasMore };
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
