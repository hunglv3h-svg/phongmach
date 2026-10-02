#!/usr/bin/env node
// Vòng đời một phòng khám (tenant) trên Medplum: cấp phát, danh mục dùng chung, ghi lặp lại được (idempotent),
// xuất dữ liệu và xóa. Kiểm chứng các giả định trong kế hoạch triển khai (mục 3.2).
//
//   node infra/medplum/experiments/tenant-lifecycle.mjs
//
// Cần quyền siêu quản trị (xem lib.mjs). Chỉ dùng cho dev/thử nghiệm; tạo và XÓA project của chính nó.
import { randomUUID } from 'node:crypto';
import { adminToken, createClinic, http, mintClientToken } from './lib.mjs';

const say = (label, value) => console.log(`${label.padEnd(58)} ${value}`);
const admin = await adminToken();
const ct = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' };

console.log('== 1. Thời gian cấp một phòng khám (Project + ClientApplication + token)');
const times = [];
for (let i = 0; i < 5; i++) times.push((await createClinic(admin, `prov-${i}`)).provisionMs);
say('ms mỗi lần', times.map((t) => t.toFixed(0)).join(', '));

console.log('\n== 2. Danh mục dùng chung qua Project.link');
const shared = await createClinic(admin, 'shared-catalog');
await http('POST', '/fhir/R4/ValueSet', {
  token: admin,
  body: { resourceType: 'ValueSet', status: 'active', url: 'urn:phongmach:vs:demo', name: 'demo', meta: { project: shared.projectId } },
});
const linked = await createClinic(admin, 'linked-clinic');
const unlinked = await createClinic(admin, 'unlinked-clinic');
const setLink = await http('PUT', `/fhir/R4/Project/${linked.projectId}`, {
  token: admin,
  body: { resourceType: 'Project', id: linked.projectId, name: 'linked-clinic', link: [{ project: { reference: `Project/${shared.projectId}` } }] },
});
linked.token = await mintClientToken(linked);
const q = '/fhir/R4/ValueSet?url=urn:phongmach:vs:demo';
const seenLinked = await http('GET', q, { token: linked.token });
const seenUnlinked = await http('GET', q, { token: unlinked.token });
say('đặt Project.link (HTTP)', setLink.status);
say('phòng khám ĐÃ link thấy danh mục', seenLinked.json?.entry?.length ?? 0);
say('phòng khám KHÔNG link thấy danh mục', seenUnlinked.json?.entry?.length ?? 0);
if (seenLinked.json?.entry?.length) {
  const res = seenLinked.json.entry[0].resource;
  const write = await http('PUT', `/fhir/R4/ValueSet/${res.id}`, { token: linked.token, body: { ...res, name: 'sua' } });
  say('phòng khám đã link thử SỬA danh mục (HTTP)', write.status);
}

console.log('\n== 3. Ghi lặp lại được: PUT theo id do client chọn, If-None-Exist, transaction');
const t = await createClinic(admin, 'idempotency');
const clientId = randomUUID();
const put = await http('PUT', `/fhir/R4/Patient/${clientId}`, { token: t.token, body: { resourceType: 'Patient', id: clientId, name: [{ family: 'Idem' }] } });
say('PUT /Patient/{uuid do client sinh} khi chưa tồn tại (HTTP)', put.status);
const patient = (await http('POST', '/fhir/R4/Patient', { token: t.token, body: { resourceType: 'Patient', name: [{ family: 'Idem' }] } })).json;
const code = `RX-${randomUUID().slice(0, 8)}`;
const createRx = () =>
  http('POST', '/fhir/R4/MedicationRequest', {
    token: t.token,
    headers: { 'if-none-exist': `identifier=urn:phongmach:ma-don|${code}` },
    body: {
      resourceType: 'MedicationRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: `Patient/${patient.id}` },
      medicationCodeableConcept: { text: 'X' },
      identifier: [{ system: 'urn:phongmach:ma-don', value: code }],
    },
  });
const a = await createRx();
const b = await createRx();
const n = await http('GET', `/fhir/R4/MedicationRequest?identifier=urn:phongmach:ma-don|${code}`, { token: t.token });
say('POST + If-None-Exist gửi 2 lần (HTTP, số bản ghi)', `${a.status}, ${b.status}, ${n.json?.entry?.length}`);
const code2 = `LK-${randomUUID().slice(0, 8)}`;
const bundle = () => ({
  resourceType: 'Bundle',
  type: 'transaction',
  entry: [
    {
      request: { method: 'POST', url: 'Encounter', ifNoneExist: `identifier=urn:phongmach:luot-kham|${code2}` },
      resource: { resourceType: 'Encounter', status: 'finished', class: ct, subject: { reference: `Patient/${patient.id}` }, identifier: [{ system: 'urn:phongmach:luot-kham', value: code2 }] },
    },
  ],
});
const tx1 = await http('POST', '/fhir/R4', { token: t.token, body: bundle() });
const tx2 = await http('POST', '/fhir/R4', { token: t.token, body: bundle() });
const enc = await http('GET', `/fhir/R4/Encounter?identifier=urn:phongmach:luot-kham|${code2}`, { token: t.token });
say('transaction gửi 2 lần (trạng thái từng phần tử, số bản ghi)', `${tx1.json?.entry?.[0]?.response?.status}, ${tx2.json?.entry?.[0]?.response?.status}, ${enc.json?.entry?.length}`);

console.log('\n== 4. Xuất rồi xóa trọn project');
const x = await createClinic(admin, 'to-be-deleted');
const pt = (await http('POST', '/fhir/R4/Patient', { token: x.token, body: { resourceType: 'Patient', name: [{ family: 'Xoa' }] } })).json;
await http('POST', '/fhir/R4/Encounter', { token: x.token, body: { resourceType: 'Encounter', status: 'finished', class: ct, subject: { reference: `Patient/${pt.id}` } } });
const bin = await http('POST', '/fhir/R4/Binary?_filename=anh.pdf', { token: x.token, raw: Buffer.from('%PDF-1.4 thu nghiem'), contentType: 'application/pdf' });
for (let i = 0; i < 20; i++) await http('GET', `/fhir/R4/Patient/${pt.id}`, { token: x.token }); // tạo AuditEvent
const exp = await http('GET', '/fhir/R4/$export', { token: x.token, headers: { prefer: 'respond-async', accept: 'application/fhir+json' } });
const jobPath = exp.headers['content-location']?.replace(/^https?:\/\/[^/]+/, '');
let manifest;
for (let i = 0; i < 30 && jobPath; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await http('GET', jobPath, { token: x.token });
  if (s.status === 200) {
    manifest = s.json;
    break;
  }
}
const files = {};
for (const o of manifest?.output ?? []) {
  if (o.type === 'OperationDefinition') continue; // tài nguyên hệ thống của Medplum, không phải dữ liệu phòng khám
  const text = await (await fetch(o.url)).text();
  const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  files[o.type] = { rows: rows.length, hasSecret: rows.some((r) => 'secret' in r) };
}
say('export cấp project: các loại tài nguyên', Object.keys(files).join(', ') || '(không có)');
say('  có Binary / AuditEvent trong export', `${'Binary' in files} / ${'AuditEvent' in files}`);
say('  file ClientApplication chứa trường secret', files.ClientApplication?.hasSecret ?? 'không có file');
const exp2 = await http('POST', `/fhir/R4/Project/${x.projectId}/$expunge`, { token: admin });
const expJob = exp2.headers['content-location']?.replace(/^https?:\/\/[^/]+/, '');
let jobState = 'không rõ';
for (let i = 0; i < 60 && expJob; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await http('GET', expJob, { token: admin });
  if (s.status !== 202) {
    jobState = `HTTP ${s.status} ${s.json?.status ?? ''}`;
    break;
  }
}
say('$expunge Project (HTTP, trạng thái job)', `${exp2.status}, ${jobState}`);
const after = await http('GET', `/fhir/R4/Patient/${pt.id}`, { token: admin });
const afterBin = await http('GET', `/fhir/R4/Binary/${bin.json?.id}`, { token: admin });
say('đọc lại Patient sau khi xóa (HTTP)', after.status);
say('đọc lại Binary sau khi xóa (HTTP)', `${afterBin.status}  ${afterBin.status === 200 ? '<- Binary KHÔNG bị xóa theo project' : ''}`);
console.log(`
Kiểm bằng SQL (psql vào DB Medplum), thay <projectId> = ${x.projectId}:
  select count(*) from "AuditEvent" where "projectId" = '<projectId>';   -- bị xóa theo project
  select count(*) from "Binary"     where "projectId" = '<projectId>';   -- vẫn còn
  và file Binary vẫn nằm trong volume /data/binary của server.`);
