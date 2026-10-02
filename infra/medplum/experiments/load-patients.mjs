#!/usr/bin/env node
// Nạp N bệnh nhân giả vào một project mới (một phòng khám), có kiểm tra TỪNG PHẦN TỬ của batch.
//
//   node infra/medplum/experiments/load-patients.mjs [N=20000]
//
// Ghi project/client vừa tạo vào .bench-state.json (đã gitignore) cho bench.mjs dùng.
//
// Lưu ý: hạn mức FHIR mặc định (~500 lần ghi/phút/người dùng) sẽ chặn việc nạp này, và `batch` vẫn trả
// HTTP 200 trong khi từng phần tử bên trong trả 429. Script dừng và báo lỗi nếu gặp phần tử không phải 201.
// Để đo, tạo cấu hình không giới hạn:  node infra/medplum/setup.mjs --force --no-rate-limits
import { randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { adminToken, createClinic, http } from './lib.mjs';

const N = Number(process.argv[2] ?? 20000);
const BATCH = 500;
const ho = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ'];
const dem = ['Văn', 'Thị', 'Minh', 'Quốc', 'Ngọc', 'Hữu', 'Thanh', 'Đức'];
const ten = ['An', 'Bình', 'Châu', 'Dũng', 'Hà', 'Hạnh', 'Khánh', 'Lan', 'Long', 'Mai', 'Nam', 'Phúc', 'Quỳnh', 'Sơn', 'Trang', 'Tuấn', 'Yến'];
const pick = (a) => a[randomInt(a.length)];

const admin = await adminToken();
const clinic = await createClinic(admin, `bench-${Date.now()}`);
const t0 = performance.now();
for (let i = 0; i < N; i += BATCH) {
  const entry = Array.from({ length: Math.min(BATCH, N - i) }, () => ({
    request: { method: 'POST', url: 'Patient' },
    resource: {
      resourceType: 'Patient',
      identifier: [{ system: 'urn:phongmach:cccd', value: String(randomInt(1e11, 1e12)) }],
      name: [{ family: pick(ho), given: [pick(dem), pick(ten)] }],
      telecom: [{ system: 'phone', value: '09' + String(randomInt(0, 1e8)).padStart(8, '0') }],
      birthDate: `${randomInt(1940, 2020)}-0${randomInt(1, 10)}-1${randomInt(0, 10)}`,
      gender: pick(['male', 'female']),
    },
  }));
  const res = await http('POST', '/fhir/R4', { token: clinic.token, body: { resourceType: 'Bundle', type: 'batch', entry } });
  const bad = (res.json?.entry ?? []).filter((e) => !String(e.response?.status).startsWith('201'));
  if (res.status !== 200 || bad.length) {
    console.error(`Dừng ở ${i}: HTTP ${res.status}, ${bad.length} phần tử không phải 201 (ví dụ ${bad[0]?.response?.status}). Có thể do hạn mức FHIR — xem ghi chú đầu file.`);
    process.exit(1);
  }
}
const secs = (performance.now() - t0) / 1000;
const count = await http('GET', '/fhir/R4/Patient?_summary=count&_total=accurate', { token: clinic.token });
console.log(`Đã nạp ${N} bệnh nhân trong ${secs.toFixed(1)} s (${(N / secs).toFixed(0)}/s). Đếm lại trong project: ${count.json?.total}`);
writeFileSync(new URL('./.bench-state.json', import.meta.url), JSON.stringify({ projectId: clinic.projectId, clientId: clinic.clientId, secret: clinic.secret }));
