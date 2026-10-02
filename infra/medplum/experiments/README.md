# Thử nghiệm trên backend Medplum

Các script này tạo ra những con số và kết luận trong `docs/ke-hoach-trien-khai.md` (mục 2 và 3). Chỉ dùng cho dev/thử nghiệm:
chúng tạo project mới và có script xóa project. Cần stack đang chạy (`infra/medplum/README.md`) và Node >= 18.

| Script | Làm gì |
|---|---|
| `load-patients.mjs [N]` | Nạp N bệnh nhân giả (mặc định 20.000) vào một project mới, kiểm tra từng phần tử của `batch`, đếm lại. |
| `bench.mjs [giây]` | Độ trễ tìm kiếm tuần tự (số điện thoại, 4 số cuối, tên có/không dấu, CCCD) và tải hỗn hợp ở 16/64/128/200 đồng thời. |
| `tenant-lifecycle.mjs` | Thời gian cấp phòng khám, danh mục dùng chung (`Project.link`), ghi lặp lại được, export và xóa project. |

Để nạp dữ liệu và đo tải, tạo cấu hình không giới hạn **trên một stack dùng để đo, không phải stack dev thường**
(hạn mức mặc định chỉ cho khoảng 500 lần ghi/phút):

```bash
docker compose -f infra/medplum/docker-compose.yml down -v
node infra/medplum/setup.mjs --force --no-rate-limits
docker compose -f infra/medplum/docker-compose.yml up -d
node infra/medplum/experiments/load-patients.mjs 20000
node infra/medplum/experiments/bench.mjs 20
node infra/medplum/experiments/tenant-lifecycle.mjs
```

`bench.mjs` chạy chung máy với server và DB, nên là một điểm dữ liệu chứ không phải kích thước hệ thống. Kết quả trên máy 4 vCPU / 15 GB
được ghi trong kế hoạch, mục 2.

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
