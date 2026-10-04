# Thử nghiệm trên backend Medplum

Các script này tạo ra những con số và kết luận trong `docs/ke-hoach-trien-khai.md` (mục 2 và 3). Chỉ dùng cho dev/thử nghiệm:
chúng tạo project mới và có script xóa project. Cần stack đang chạy (`infra/medplum/README.md`) và Node >= 18.

| Script | Làm gì |
|---|---|
| `stack-do.mjs up\|down\|destroy` | Stack Medplum **riêng để đo**, không giới hạn hạn mức, chạy song song với stack dev (dự án Compose `phongmach-medplum-do`, cổng 8203). |
| `bff-search.mjs [--reload]` | Tiêu chí M0-3: tìm bệnh nhân **qua BFF** trên 20.000 bệnh nhân của một phòng khám (dựng bằng `buildPatient` của ứng dụng), đo p50/p95/p99 từng loại truy vấn tuần tự và ở 16 đồng thời, tách thời gian BFF / Medplum / nhật ký, kiểm tính đúng. |
| `load-patients.mjs [N]` | Nạp N bệnh nhân giả (mặc định 20.000) vào một project mới, kiểm tra từng phần tử của `batch`, đếm lại. |
| `bench.mjs [giây]` | Độ trễ tìm kiếm tuần tự gọi thẳng Medplum (số điện thoại, 4 số cuối, tên có/không dấu, CCCD) và tải hỗn hợp ở 16/64/128/200 đồng thời. |
| `tenant-lifecycle.mjs` | Thời gian cấp phòng khám, danh mục dùng chung (`Project.link`), ghi lặp lại được, export và xóa project. |

### Stack đo riêng

Nạp dữ liệu và đo tải cần Medplum không giới hạn hạn mức (hạn mức mặc định chỉ cho khoảng 500 lần ghi/phút, F5). **Không** làm việc đó
trên stack dev: tắt hạn mức ở đó nghĩa là xóa volume và sinh lại mật khẩu, mất hết dữ liệu demo. Dùng stack đo riêng:

```bash
node infra/medplum/experiments/stack-do.mjs up        # lần đầu sinh cấu hình ở experiments/.stack-do/ (gitignore), chờ healthy
export MEDPLUM_URL=http://localhost:8203              # các script dưới mặc định 8103; bff-search.mjs mặc định 8203
node infra/medplum/experiments/bff-search.mjs         # M0-3; lần đầu nạp 20.000 bệnh nhân (4–6 phút), các lần sau chỉ đo (khoảng 1 phút)
node infra/medplum/experiments/load-patients.mjs 20000
node infra/medplum/experiments/bench.mjs 20
node infra/medplum/experiments/tenant-lifecycle.mjs
node infra/medplum/experiments/stack-do.mjs down      # dừng, giữ dữ liệu; `destroy` để xóa hẳn (chỉ volume của stack đo)
```

- Stack đo dùng cùng `docker-compose.yml` và cùng image với stack dev, nhưng mọi lệnh compose của `stack-do.mjs` đều mang
  `-p phongmach-medplum-do`: volume, mạng và container khác, không lệnh nào chạm vào `phongmach-medplum`. Postgres và Redis không mở
  cổng ra máy chủ, nên chỉ cần thêm một cổng (8203; đổi bằng `DO_MEDPLUM_PORT`).
- `setup.mjs --dir <thư mục>` ghi `.env` và `config/` vào thư mục khác; `stack-do.mjs` dùng nó rồi gọi compose với `--project-directory`.
- `bff-search.mjs` từ chối nạp nếu Medplum trả tiêu đề `RateLimit` (còn bật hạn mức, tức là đang trỏ nhầm vào stack dev).

`bench.mjs` và `bff-search.mjs` chạy chung máy với server và DB, nên là một điểm dữ liệu chứ không phải kích thước hệ thống. Kết quả
(máy 4 vCPU / 15 GB cho `bench.mjs`; máy dev Windows cho `bff-search.mjs`) được ghi trong kế hoạch, mục 2.

### `bff-search.mjs` (M0-3)

1. **Nạp** (lần đầu, hoặc `--reload`): một phòng khám đo mới (Project + tài khoản máy); 20.000 bệnh nhân giả dựng bằng `buildPatient`
   của `@phongmach/fhir-vn-model`, tức là có thêm tên không dấu như ứng dụng ghi (T-NAME). Gửi theo `batch` 500, **một batch một
   lúc**, mỗi phần tử có `ifNoneExist` theo `clientUuid` (chạy lại không trùng); kiểm từng phần tử, đếm lại trong Medplum, rồi
   `ANALYZE` trên Postgres của stack đo. Hai bẫy đã gặp: 4 batch có `ifNoneExist` song song thì Postgres trả lỗi tuần tự hóa
   (40001, HTTP 409 ở từng phần tử); đo ngay sau khi nạp, trước khi autovacuum kịp cập nhật thống kê, thì truy vấn tên nhiều từ chậm gấp 10–20 lần.
   Dữ liệu gần với một phòng mạch: họ theo tỉ lệ người Việt (Nguyễn khoảng 31%), nhiều người trùng họ tên (tên gọi phổ biến nhất
   khoảng 5% mỗi giới), đầu số theo nhà mạng, 12% dùng chung số điện thoại với người nhà, 3% không có số, CCCD giả có tiền tố `000`
   ở 75% người từ 14 tuổi. Hạt giống in ra; `BENCH_SEED` để nạp lại đúng bộ cũ.
2. **BFF thật** (`services/bff/src/server.ts`, cổng 8112, `SEARCH_BFF_PORT`) trỏ vào phòng khám đo, đăng nhập phiên của một phụ tá,
   gọi `GET /api/patients/search?q=…` như giao diện (không gửi `limit`, BFF trả tối đa 20).
3. **Sáu loại truy vấn**, mỗi loại 200 truy vấn khác nhau (`BENCH_QUERIES`): 4 số cuối; tên không dấu một từ (tên), hai từ (họ + tên),
   đủ họ tên; số điện thoại đầy đủ; CCCD. Chạy tuần tự, trộn thứ tự các loại (M0-3 tính theo lần này), rồi ở 16 đồng thời
   (`BENCH_CONCURRENCY`). Thêm 50 "ca khó" cho 4 số cuối: 4 số bắt đầu bằng một đầu số di động (ví dụ `0912`), nên rất nhiều số
   **chứa** chúng ở đầu.
4. **Tách thời gian**: phía khách (đầu-cuối); BFF tự đo (`responseTime` trong log Fastify); riêng phần Medplum (gọi đúng
   `searchPatients` của BFF trong tiến trình đo, không qua BFF, không nhật ký); riêng việc ghi nhật ký truy cập (`NdjsonAuditSink`: ghi nối
   một dòng rồi `fsync`, như BFF làm trước khi trả dữ liệu); sàn HTTP (`GET /api/health`).
   **Trên Windows, `fetch` của Node có sàn khoảng 15 ms mỗi yêu cầu** (máy chủ Node trống: `fetch` 15,4 ms, `http.request` giữ kết nối
   0,16 ms; trong container Linux trên cùng máy: `fetch` 1,6 ms). Vì thế phía khách gọi BFF bằng `http.request` (trình duyệt không có
   sàn này), và phần Medplum được đo hai lần: bằng `fetch` như `MedplumClient` của BFF đang gọi, và bằng `http.request` (thời gian của
   riêng Medplum).
5. **Tính đúng**, so với dữ liệu gốc: người cần tìm có trong kết quả; với 4 số cuối, mọi người có số **kết thúc** bằng 4 số đó đứng
   trước người chỉ chứa 4 số đó ở giữa, và không thiếu ai; mọi kết quả đều khớp truy vấn. Truy vấn có hơn 20 người khớp đúng từng từ
   được đếm riêng ("quá 20 người khớp"): giao diện chỉ hiện 20, nên người cần tìm vắng mặt ở đó là chính đáng (phụ tá phải gõ thêm).
   Lần đo đầu (03/10/2026) không đạt phần này; từ khi BFF tìm thêm theo khóa chính xác trong `meta.tag` thì đạt (kế hoạch, mục 2).

Đo lại sau khi đổi cách dựng `Patient` hay cách tìm của BFF: `--reload` để nạp bệnh nhân bằng `buildPatient` mới. Muốn thử đường di trú
(hồ sơ cũ được ghi bổ sung khóa tìm) thì không nạp lại mà chạy trên phòng khám đo đang có:

```bash
MEDPLUM_URL=http://localhost:8203 TENANTS_FILE="$PWD/infra/medplum/experiments/.bff-search/tenants.json" \
  pnpm --filter @phongmach/bff backfill:search-keys     # 20.000 hồ sơ: 143 giây trên máy dev [Đã đo]
docker compose -p phongmach-medplum-do exec -T postgres psql -U medplum -d medplum -c ANALYZE
node infra/medplum/experiments/bff-search.mjs
```

Tệp sinh ra nằm ở `experiments/.bff-search/` (gitignore): `tenants.json` (bí mật tài khoản máy), `patients.json` (dữ liệu gốc),
`bff.log`, `audit.ndjson`, `result-*.json` (mọi số đo và kết quả từng truy vấn). Hạt giống chọn truy vấn in ra; `BENCH_QUERY_SEED` để chạy lại đúng bộ truy vấn.

## Đo dung lượng AuditEvent

Sau khi chạy `bench.mjs` hoặc `tenant-lifecycle.mjs` (đã bật `saveAuditEvents`), vào Postgres:

```bash
docker compose -f infra/medplum/docker-compose.yml exec postgres psql -U medplum -d medplum
```

```sql
-- số sự kiện và dung lượng trung bình mỗi sự kiện (ba bảng, gồm chỉ mục)
select (select count(*) from "AuditEvent") as events,
       pg_size_pretty(sum(pg_total_relation_size(quote_ident(t)))) as total,
       round(sum(pg_total_relation_size(quote_ident(t)))::numeric / (select count(*) from "AuditEvent")) as bytes_per_event
from (values ('AuditEvent'), ('AuditEvent_History'), ('AuditEvent_References')) v(t);
```

Lần đo trong kế hoạch: 2.000 lần đọc `Patient/{id}` sinh 2.004 `AuditEvent` (một sự kiện mỗi lần đọc theo id, không có sự kiện cho truy vấn tìm kiếm);
mỗi sự kiện chiếm khoảng 4,7 KB (6.534 sự kiện) đến 5,3 KB (44.520 sự kiện) ở ba bảng, gồm chỉ mục.
