import { createHash } from 'node:crypto';
import { getDrug, getIcd10, resolveLine, type Icd10Entry, type LineInput } from '@phongmach/catalogs';
import {
  PRIORITIES,
  SPECIALTIES,
  addDays,
  makePrescriptionCode,
  sortQueue,
  toDisplayBoard,
  toRuleAllergy,
  vnDay,
  type PrescriptionToSign,
  type SignedLine,
} from '@phongmach/clinical';
import { DomainError } from '@phongmach/fhir-vn-model';
import { ageInYears, checkPrescription, judge } from '@phongmach/rules';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeMetrics } from '../metrics.js';
import { renderPrescriptionHtml } from '@phongmach/print';
import type { Doctor } from '../store.js';
import { ALL_ROLES, CLINICAL_ROLES, type RouteContext } from './context.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = z.number().finite();

const idParams = z.object({ id: z.string().regex(UUID_RE) });
const patientParams = z.object({ id: z.string().regex(UUID_RE) });
const noteParams = z.object({ id: z.string().regex(UUID_RE), itemId: z.string().regex(UUID_RE) });

const checkInBody = z.object({
  clientUuid: z.uuid(),
  patientId: z.string().regex(UUID_RE),
  specialty: z.enum(SPECIALTIES as [string, ...string[]]),
  priority: z.enum(PRIORITIES as [string, ...string[]]).default('normal'),
  reason: z.string().max(200).optional(),
});

const completeBody = z.object({
  clientUuid: z.uuid(),
  exam: z.object({
    reason: z.string().max(300).optional(),
    symptoms: z.string().max(2000).optional(),
    findings: z.string().max(2000).optional(),
    vitals: z
      .object({ temperatureC: num.optional(), pulse: num.optional(), systolic: num.optional(), diastolic: num.optional(), respiratoryRate: num.optional(), spo2: num.optional(), weightKg: num.optional(), heightCm: num.optional() })
      .default({}),
  }),
  diagnoses: z.array(z.string().max(10)).max(10),
  prescription: z
    .object({
      lines: z
        .array(
          z.object({
            drug: z.string().max(100),
            perDose: num.positive().max(1000).optional(),
            timesPerDay: z.number().int().min(1).max(12).optional(),
            days: z.number().int().min(1).max(365).optional(),
            quantity: num.positive().max(10_000).optional(),
            instruction: z.string().max(300).optional(),
          })
        )
        .max(20),
      advice: z.string().max(1000).optional(),
      followUpDays: z.number().int().min(1).max(365).optional(),
      acknowledgements: z.array(z.object({ key: z.string().max(200), reason: z.string().max(300) })).max(30).default([]),
    })
    .optional(),
});

const allergyBody = z.object({ clientUuid: z.uuid(), kind: z.enum(['class', 'ingredient']), value: z.string().min(1).max(100), label: z.string().max(100).optional() });
const historyBody = z.object({ clientUuid: z.uuid(), text: z.string().min(1).max(300) });
const patchBody = z.object({ cccd: z.string().max(20).optional(), birthDate: z.string().max(10).optional() });
const simBody = z.object({ mode: z.enum(['up', 'down']).optional(), failNext: z.number().int().min(0).max(20).optional() });
const metricsQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });
const visitsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const pendingQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

const doctorOf = (ctx: RouteContext, req: { session?: { userId: string; userName: string } }): Doctor => {
  const s = req.session!;
  return { userId: s.userId, name: s.userName, practitionerId: ctx.tenants.users.find((u) => u.id === s.userId)?.practitionerId };
};

const sha256Base64 = (text: string) => createHash('sha256').update(text).digest('base64');

export function registerClinicalRoutes(api: FastifyInstance, ctx: RouteContext): void {
  // ------------------------------------------------------------------------------------------------ hàng chờ

  api.get('/api/queue', { preHandler: ctx.guard('queue-read', ...ALL_ROLES) }, async (req) => {
    const day = vnDay(ctx.now());
    const items = await (await ctx.store(req)).listQueue(day);
    await ctx.record(req, 'queue-read', { resultCount: items.length });
    return { day, items: sortQueue(items) };
  });

  api.post('/api/queue', { preHandler: ctx.guard('check-in', ...ALL_ROLES) }, async (req, reply) => {
    const body = checkInBody.parse(req.body);
    const result = await (await ctx.store(req)).checkIn({ ...body, specialty: body.specialty as 'noi' | 'nhi', priority: body.priority as 'normal' | 'appointment' | 'urgent' }, ctx.now());
    if (!result) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'check-in', { resourceIds: [result.item.patientId, result.item.id], resultCount: result.created ? 1 : 0 });
    return reply.code(result.created ? 201 : 200).send(result);
  });

  api.post('/api/queue/:id/cancel', { preHandler: ctx.guard('queue-cancel', ...ALL_ROLES) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const outcome = await (await ctx.store(req)).cancelVisit(id);
    if (outcome === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (outcome === 'not-waiting') return reply.code(409).send({ error: 'not-waiting', message: 'Chỉ hủy được lượt đang chờ' });
    await ctx.record(req, 'queue-cancel', { resourceIds: [id] });
    return { ok: true };
  });

  // Màn hình chờ: chỉ số thứ tự và chữ cái đầu. Không ghi nhật ký từng lần (tải lại mỗi vài giây) vì không có dữ liệu cá nhân đầy đủ.
  api.get('/api/display', async (req) => {
    const tenant = ctx.tenants.tenants.find((t) => t.slug === req.session!.tenant)!;
    const items = await (await ctx.store(req)).listQueue(vnDay(ctx.now()));
    return toDisplayBoard(tenant.name, items, ctx.now());
  });

  // ------------------------------------------------------------------------------------------------- khám

  api.post('/api/visits/:id/open', { preHandler: ctx.guard('visit-open', ...CLINICAL_ROLES) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const result = await (await ctx.store(req)).openVisit(id, doctorOf(ctx, req), ctx.now());
    if (result.kind === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (result.kind === 'closed') return reply.code(409).send({ error: 'closed', message: 'Lượt khám đã kết thúc hoặc đã hủy' });
    if (result.kind === 'taken') return reply.code(409).send({ error: 'taken', message: `Hồ sơ đang do ${result.doctorName ?? 'người khác'} khám` });
    await ctx.record(req, 'visit-open', { resourceIds: [result.context.patient.id, id] });
    return result.context;
  });

  api.get('/api/visits/:id', { preHandler: ctx.guard('visit-read', ...CLINICAL_ROLES) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const context = await (await ctx.store(req)).readVisit(id);
    if (!context) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'visit-read', { resourceIds: [context.patient.id, id] });
    return context;
  });

  api.post('/api/visits/:id/complete', { preHandler: ctx.guard('visit-complete', ...CLINICAL_ROLES) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = completeBody.parse(req.body);
    const store = await ctx.store(req);
    const now = ctx.now();
    const context = await store.readVisit(id);
    if (!context) return reply.code(404).send({ error: 'not-found' });

    const diagnoses: Icd10Entry[] = [];
    for (const code of new Set(body.diagnoses)) {
      const entry = getIcd10(code);
      if (!entry) throw new DomainError('invalid-diagnosis', `Mã ICD-10 không có trong danh mục: ${code}`);
      diagnoses.push(entry);
    }
    if (diagnoses.length === 0) throw new DomainError('invalid-diagnosis', 'Cần ít nhất một chẩn đoán');

    let prescription: PrescriptionToSign | undefined;
    // Gửi lại sau khi đã hoàn tất (visit.status = done) bỏ qua kiểm tra quy tắc: store trả về kết quả cũ hoặc báo đã đóng.
    if (body.prescription && context.visit.status === 'in-exam') {
      const lines: LineInput[] = body.prescription.lines;
      // Kiểm tra lại ở server bằng cùng bộ quy tắc với giao diện: không tin client.
      const findings = checkPrescription(
        lines,
        {
          specialty: context.visit.specialty,
          patient: { ageYears: ageInYears(context.patient.birthDate, now), hasCccd: !!context.patient.cccdMasked, weightKg: body.exam.vitals.weightKg },
          allergies: context.allergies.map(toRuleAllergy),
          diagnoses: diagnoses.map((d) => d.code),
        },
        ctx.rules
      );
      const verdict = judge(findings, body.prescription.acknowledgements);
      if (!verdict.canSign) {
        await ctx.record(req, 'visit-complete', { outcome: 'denied', resourceIds: [context.patient.id, id] });
        return reply.code(422).send({ error: 'rules-not-satisfied', blocking: verdict.blocking, unacknowledged: verdict.unacknowledged });
      }
      const signed: SignedLine[] = lines.map((input) => {
        const drug = getDrug(input.drug)!; // đã được quy tắc 'unknown-drug' chặn nếu không có
        return { drug, input, resolved: resolveLine(drug, input) };
      });
      // Mã đơn sinh xác định từ clientUuid: gửi lại sau lỗi giữa chừng cho đúng cùng một mã.
      const bytes = createHash('sha256').update(body.clientUuid.toLowerCase()).digest();
      prescription = {
        code: makePrescriptionCode(vnDay(now), bytes),
        lines: signed,
        advice: body.prescription.advice,
        followUpDays: body.prescription.followUpDays,
        acks: verdict.acknowledged.map((a) => ({ key: a.key, message: a.message, reason: a.reason })),
        digestBase64: sha256Base64,
      };
    }

    const result = await store.completeVisit({ clientUuid: body.clientUuid, encounterId: id, doctor: doctorOf(ctx, req), now, exam: body.exam, diagnoses, prescription });
    if (result.kind === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (result.kind === 'not-open') return reply.code(409).send({ error: 'not-open', message: 'Chưa mở hồ sơ hoặc hồ sơ do người khác khám' });
    if (result.kind === 'already-closed') return reply.code(409).send({ error: 'already-closed', message: 'Lượt khám đã được kết thúc' });
    if (result.kind === 'incomplete') {
      // Ghi dở: một số mục lỗi. Báo lỗi tạm thời; gửi lại cùng clientUuid sẽ hoàn tất mà không tạo bản ghi trùng.
      req.log.warn({ failed: result.failed.map((f) => ({ i: f.index, s: f.status })) }, 'hoàn tất lượt khám ghi dở');
      await ctx.record(req, 'visit-complete', { outcome: 'error', resourceIds: [context.patient.id, id] });
      return reply.code(503).send({ error: 'incomplete', retry: true, message: 'Lưu chưa trọn vẹn, hãy bấm lại: dữ liệu sẽ không bị trùng.' });
    }
    await ctx.record(req, 'visit-complete', { resourceIds: [context.patient.id, id], resultCount: result.visit.prescription?.lines.length ?? 0 });
    return reply.code(result.replayed ? 200 : 201).send({ visit: result.visit, prescription: result.visit.prescription, replayed: result.replayed });
  });

  // ---------------------------------------------------------------------------------- hồ sơ bệnh nhân: nền

  api.patch('/api/patients/:id', { preHandler: ctx.guard('update', ...ALL_ROLES) }, async (req, reply) => {
    const { id } = patientParams.parse(req.params);
    const patient = await (await ctx.store(req)).updatePatient(id, patchBody.parse(req.body));
    if (!patient) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'update', { resourceIds: [id] });
    return { patient };
  });

  api.get('/api/patients/:id/allergies', { preHandler: ctx.guard('note-read', ...ALL_ROLES) }, async (req) => {
    const { id } = patientParams.parse(req.params);
    const allergies = await (await ctx.store(req)).listAllergies(id);
    await ctx.record(req, 'note-read', { resourceIds: [id], resultCount: allergies.length });
    return { allergies };
  });

  api.post('/api/patients/:id/allergies', { preHandler: ctx.guard('note-write', ...ALL_ROLES) }, async (req, reply) => {
    const { id } = patientParams.parse(req.params);
    const allergy = await (await ctx.store(req)).addAllergy(id, allergyBody.parse(req.body), ctx.now());
    if (!allergy) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'note-write', { resourceIds: [id, allergy.id] });
    return reply.code(201).send({ allergy });
  });

  api.delete('/api/patients/:id/allergies/:itemId', { preHandler: ctx.guard('note-write', ...ALL_ROLES) }, async (req, reply) => {
    const { id, itemId } = noteParams.parse(req.params);
    if (!(await (await ctx.store(req)).removeAllergy(id, itemId))) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'note-write', { resourceIds: [id, itemId] });
    return { ok: true };
  });

  // Tiền sử là thông tin lâm sàng: chỉ bác sĩ và chủ phòng khám.
  api.get('/api/patients/:id/medical-history', { preHandler: ctx.guard('note-read', ...CLINICAL_ROLES) }, async (req) => {
    const { id } = patientParams.parse(req.params);
    const history = await (await ctx.store(req)).listHistory(id);
    await ctx.record(req, 'note-read', { resourceIds: [id], resultCount: history.length });
    return { history };
  });

  api.post('/api/patients/:id/medical-history', { preHandler: ctx.guard('note-write', ...CLINICAL_ROLES) }, async (req, reply) => {
    const { id } = patientParams.parse(req.params);
    const item = await (await ctx.store(req)).addHistory(id, historyBody.parse(req.body), ctx.now());
    if (!item) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'note-write', { resourceIds: [id, item.id] });
    return reply.code(201).send({ item });
  });

  api.delete('/api/patients/:id/medical-history/:itemId', { preHandler: ctx.guard('note-write', ...CLINICAL_ROLES) }, async (req, reply) => {
    const { id, itemId } = noteParams.parse(req.params);
    if (!(await (await ctx.store(req)).removeHistory(id, itemId))) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'note-write', { resourceIds: [id, itemId] });
    return { ok: true };
  });

  api.get('/api/patients/:id/visits', { preHandler: ctx.guard('history-read', ...CLINICAL_ROLES) }, async (req) => {
    const { id } = patientParams.parse(req.params);
    const { limit } = visitsQuery.parse(req.query);
    const visits = await (await ctx.store(req)).patientVisits(id, limit);
    await ctx.record(req, 'history-read', { resourceIds: [id], resultCount: visits.length });
    return { visits };
  });

  // ------------------------------------------------------------------------------------------- đơn thuốc

  // Khai báo trước ':id' để "pending" không bị hiểu là một id.
  api.get('/api/prescriptions/pending', { preHandler: ctx.guard('prescription-read', ...ALL_ROLES) }, async (req) => {
    const { limit } = pendingQuery.parse(req.query);
    const pending = await (await ctx.store(req)).pendingPrescriptions(limit);
    await ctx.record(req, 'prescription-read', { resultCount: pending.length });
    return { pending };
  });

  api.get('/api/prescriptions/:id', { preHandler: ctx.guard('prescription-read', ...ALL_ROLES) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const detail = await (await ctx.store(req)).readPrescription(id);
    if (!detail) return reply.code(404).send({ error: 'not-found' });
    await ctx.record(req, 'prescription-read', { resourceIds: [detail.prescription.patientId, id] });
    return detail;
  });

  api.get('/api/prescriptions/:id/print', { preHandler: ctx.guard('prescription-print', ...ALL_ROLES) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const detail = await (await ctx.store(req)).readPrescription(id);
    if (!detail) return reply.code(404).send({ error: 'not-found' });
    const clinic = ctx.tenants.tenants.find((t) => t.slug === req.session!.tenant)!;
    const html = await renderPrescriptionHtml(detail, clinic.name);
    await ctx.record(req, 'prescription-print', { resourceIds: [detail.prescription.patientId, id] });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  api.post('/api/prescriptions/:id/retry', { preHandler: ctx.guard('prescription-retry', ...CLINICAL_ROLES) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const outcome = await (await ctx.store(req)).retryPrescription(id, ctx.now());
    if (outcome === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (outcome === 'not-retryable') return reply.code(409).send({ error: 'not-retryable', message: 'Đơn đã gửi xong' });
    await ctx.record(req, 'prescription-retry', { resourceIds: [id] });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------- cổng mô phỏng (chỉ demo)

  api.get('/api/sim/gateway', { preHandler: ctx.guard('gateway-sim', ...CLINICAL_ROLES) }, async (req, reply) => {
    if (!ctx.simulator) return reply.code(404).send({ error: 'not-found' });
    return { simulated: true, state: ctx.simulator.get(req.session!.tenant) };
  });

  api.post('/api/sim/gateway', { preHandler: ctx.guard('gateway-sim', ...CLINICAL_ROLES) }, async (req, reply) => {
    if (!ctx.simulator) return reply.code(404).send({ error: 'not-found' });
    const state = ctx.simulator.set(req.session!.tenant, simBody.parse(req.body));
    await ctx.record(req, 'gateway-sim', { queryKind: `${state.mode}:${state.failNext}` });
    return { simulated: true, state };
  });

  // --------------------------------------------------------------------------------------------- số đo

  api.get('/api/metrics/visits', { preHandler: ctx.guard('metrics-read', ...CLINICAL_ROLES) }, async (req) => {
    const { days } = metricsQuery.parse(req.query);
    const to = vnDay(ctx.now());
    const from = addDays(to, -(days - 1));
    const { visits, truncated } = await (await ctx.store(req)).finishedVisits(from, 1000);
    const s = req.session!;
    // Bác sĩ chỉ thấy số của chính mình; chủ phòng khám thấy tất cả.
    const visible = s.role === 'owner' ? visits : visits.filter((v) => v.doctorUserId === s.userId);
    await ctx.record(req, 'metrics-read', { resultCount: visible.length });
    return computeMetrics(visible, { from, to, truncated });
  });
}
