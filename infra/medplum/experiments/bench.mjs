#!/usr/bin/env node
// Đo độ trễ tìm kiếm và thông lượng dưới tải đồng thời trên project do load-patients.mjs tạo.
//
//   node infra/medplum/experiments/bench.mjs [giây_mỗi_mức=20]
//
// 1) Độ trễ tuần tự (median / max của 5 lần) cho các kiểu tìm bệnh nhân của phòng mạch.
// 2) Tải hỗn hợp: mỗi "lượt khám" ảo gồm 8 lời gọi — tìm 4 số cuối điện thoại, mở hồ sơ, 4 truy vấn tóm tắt
//    (Encounter, MedicationRequest, Condition, AllergyIntolerance) và ghi Encounter + MedicationRequest.
//    Chạy ở các mức đồng thời 16 / 64 / 128 / 200.
//
// Chỉ là một điểm dữ liệu: bộ tạo tải thường chạy chung máy với server và DB, nên KHÔNG phải kích thước hệ thống
// thật. Cần tắt hạn mức FHIR (setup.mjs --no-rate-limits), nếu không sẽ thấy HTTP 429.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BASE, http, mintClientToken } from './lib.mjs';

const SECONDS = Number(process.argv[2] ?? 20);
const state = JSON.parse(readFileSync(new URL('./.bench-state.json', import.meta.url), 'utf8'));
const token = await mintClientToken(state);

// Lấy mẫu 5.000 bệnh nhân để chọn ngẫu nhiên.
const sample = [];
let next = '/fhir/R4/Patient?_count=1000&_elements=id,telecom,identifier,name';
for (let page = 0; page < 5 && next; page++) {
  const res = await http('GET', next, { token });
  for (const e of res.json?.entry ?? []) {
    const r = e.resource;
    if (r.telecom?.[0]?.value && r.identifier?.[0]?.value) sample.push(r);
  }
  const link = res.json?.link?.find((l) => l.relation === 'next')?.url;
  next = link ? link.replace(/^https?:\/\/[^/]+/, '') : null;
}
if (!sample.length) throw new Error('Không có bệnh nhân mẫu — chạy load-patients.mjs trước');
const pick = () => sample[randomInt(sample.length)];
console.log(`Mẫu ${sample.length} bệnh nhân (project ${state.projectId.slice(0, 8)}…)\n`);

// Dấu tiếng Việt → không dấu, để thử tìm "Nguyen" cho "Nguyễn".
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

console.log('Độ trễ tuần tự (5 lần):');
const p = pick();
const family = p.name[0].family;
const queries = [
  ['số điện thoại đầy đủ', `/fhir/R4/Patient?phone=${p.telecom[0].value}`],
  ['4 số cuối (phone:contains)', `/fhir/R4/Patient?phone:contains=${p.telecom[0].value.slice(-4)}&_count=20`],
  ['họ có dấu', `/fhir/R4/Patient?family=${encodeURIComponent(family)}&_count=20`],
  ['họ KHÔNG dấu', `/fhir/R4/Patient?family=${encodeURIComponent(strip(family))}&_count=20`],
  ['CCCD', `/fhir/R4/Patient?identifier=urn:phongmach:cccd|${p.identifier[0].value}`],
  ['đọc theo id', `/fhir/R4/Patient/${p.id}`],
];
for (const [label, path] of queries) {
  const times = [];
  let res;
  for (let i = 0; i < 5; i++) {
    res = await http('GET', path, { token });
    times.push(res.ms);
  }
  times.sort((a, b) => a - b);
  const hits = res.json?.entry?.length ?? (res.json?.resourceType === 'Patient' ? 1 : 0);
  console.log(`  ${label.padEnd(28)} HTTP ${res.status}  kết quả=${String(hits).padStart(2)}  median=${times[2].toFixed(0)} ms  max=${times[4].toFixed(0)} ms`);
}

async function timed(lat, method, path, body) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/fhir+json', authorization: `Bearer ${token}` },
      body: body && JSON.stringify(body),
    });
    await res.arrayBuffer();
    status = res.status;
  } catch {
    status = 0;
  }
  lat.push([performance.now() - t0, status]);
}

async function visit(lat) {
  const pt = pick();
  await timed(lat, 'GET', `/fhir/R4/Patient?phone:contains=${pt.telecom[0].value.slice(-4)}&_count=10`);
  await timed(lat, 'GET', `/fhir/R4/Patient/${pt.id}`);
  for (const type of ['Encounter', 'MedicationRequest', 'Condition', 'AllergyIntolerance']) {
    await timed(lat, 'GET', `/fhir/R4/${type}?patient=Patient/${pt.id}&_count=20`);
  }
  const subject = { reference: `Patient/${pt.id}` };
  await timed(lat, 'POST', '/fhir/R4/Encounter', {
    resourceType: 'Encounter',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    subject,
  });
  await timed(lat, 'POST', '/fhir/R4/MedicationRequest', {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    subject,
    medicationCodeableConcept: { text: 'Paracetamol 500mg' },
  });
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
console.log(`\nTải hỗn hợp, ${SECONDS} s mỗi mức:`);
for (const concurrency of [16, 64, 128, 200]) {
  const lat = [];
  const t0 = performance.now();
  const end = t0 + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < end) await visit(lat);
    })
  );
  const secs = (performance.now() - t0) / 1000;
  const ms = lat.map((x) => x[0]).sort((a, b) => a - b);
  const errors = lat.filter((x) => x[1] < 200 || x[1] >= 300).length;
  console.log(
    `  đồng thời=${String(concurrency).padStart(3)}  ${(lat.length / secs).toFixed(0).padStart(5)} req/s  ` +
      `p50=${pct(ms, 0.5).toFixed(0)} ms  p95=${pct(ms, 0.95).toFixed(0)} ms  p99=${pct(ms, 0.99).toFixed(0)} ms  lỗi=${errors}/${lat.length}`
  );
}
