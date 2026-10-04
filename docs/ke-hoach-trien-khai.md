# Kế hoạch triển khai chi tiết — PHONGMACH

Cập nhật 03/10/2026 (lần 6: đo M0-3 qua BFF, mục 2). Dựa trên ba nguồn:

1. Báo cáo "Quản lý Phòng mạch Việt Nam" v2.0 (29/09/2026), viết cho nhà đầu tư.
2. Tài liệu nội bộ "Phân tích – Kế hoạch triển khai SaaS Quản lý Phòng mạch" v1.0 (29/09/2026, 34 trang), viết tắt **TL34**.
3. Kết quả cài và thử backend Medplum 5.2.0 trong `infra/medplum/`.

**Quyết định của chủ dự án (02/10/2026):** làm sớm và cắt phạm vi; nhiệm vụ là ra MVP nhanh để nhà đầu tư được thuyết phục hơn.
Hệ quả: mục 5 và 6 được viết lại quanh hai cột mốc MVP, **M0 (13/11/2026, trình nhà đầu tư)** và **M1 (31/03/2027, pilot)**.
Đội có sẵn từ 05/10 (xác nhận 02/10). **M0-S1, M0-S2, phần ngoại tuyến của M0-S3 và nút Zalo mô phỏng đã làm xong trước lịch**; trạng thái ở mục 5.6, 5.7 và 5.9.

Quy ước độ tin cậy:

- **[Đã đo]** chạy thật, có script trong `infra/medplum/` để chạy lại.
- **[Đã đọc mã]** thấy trong mã nguồn server Medplum 5.2.0, chưa tái hiện bằng thao tác thật.
- **[Phân tích]** suy luận từ thiết kế hoặc từ các số liệu trong tài liệu, chưa thử.
- **[Đề xuất]** ý kiến thiết kế của tôi, cần người có thẩm quyền chốt.
- **[Chưa kiểm chứng]** chưa thử, không được coi là đã biết.

---

## 1. Tóm tắt

Kế hoạch này hợp nhất TL34 (giai đoạn, kiến trúc, 6 trụ cột) với bằng chứng từ việc cài Medplum. TL34 đúng ở hầu hết hướng đi: Medplum làm lõi,
một Project cho mỗi phòng khám, lớp tích hợp Việt Nam tách riêng, ngoại tuyến ở phía client, cổng quyết định ở Giai đoạn 0.
Thử nghiệm xác nhận phần cốt lõi (cách ly tenant, danh mục dùng chung, tìm kiếm nhanh) và làm lộ ra những chỗ TL34 chưa tính tới.

Năm điều quan trọng nhất:

1. **Lịch Giai đoạn 1 không khớp** (TL34 có 12 sprint cho khoảng 8 sprint khả dụng): đã xử lý bằng quyết định 02/10 là bắt đầu xây từ 05/10 và cắt phạm vi. Còn thiếu khoảng 1,5 sprint, bù bằng danh sách cắt (mục 6).
2. **"Xóa trọn project" không xóa hết**: `$expunge` xóa dữ liệu và cả nhật ký truy cập nhưng **để lại ảnh/PDF (`Binary`)**; export cấp project **không có Binary** và **lộ `secret` của tài khoản máy** (mục 3.2).
3. **Nhật ký truy cập tốn kém hơn dự tính**: một lần đọc = một dòng ≈ 5 KB, tìm kiếm không được lưu, và việc ghi không đợi kết quả. Ở 300 phòng khám có thể là 1–13 TB/năm, lớn hơn cả dữ liệu lâm sàng (mục 3.2).
4. **Idempotency theo "UUID client" phải đổi cách làm**: Medplum không cho `PUT` tạo mới với id do client chọn. Dùng `If-None-Exist` theo identifier (đã thử, hoạt động) (mục 4).
5. **Ba con số chi phí hạ tầng mâu thuẫn nhau** trong TL34 (15, 25 và 60 triệu đ/tháng cho 300 phòng khám), cần một mô hình duy nhất trước khi dùng làm tiêu chí "đi" (mục 3.3).

**Hệ quả của quyết định MVP-first (mục 5):** đội xây ứng dụng ngay từ tuần 1, song song với kiểm chứng. Cuộc họp đi/không đi 13/11 có một MVP chạy thật (M0) cùng gói bằng chứng,
trong đó cổng đơn thuốc, ký số và Zalo **mô phỏng và ghi rõ**; kết nối thật dời sang M1. Phạm vi M0 và tiêu chí chấp nhận ở mục 5.2–5.3, cần bạn xác nhận (Q14–Q16).

Câu hỏi của bản kế hoạch trước đã được trả lời: phương án dự phòng là .NET + PostgreSQL (TL34 E.2), và "khóa riêng cho từng phòng khám" là mã hóa cấp trường ở lớp BFF (TL34 C.1, D.1).
Kéo theo một vấn đề mới: trường đã mã hóa thì Medplum không tìm được (T-ENC).

---

## 2. Đã cài gì, đo được gì

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Medplum server | 5.2.0 (image `medplum/medplum-server`, digest `sha256:8b94…9d42`) | Không có `@medplum/server` trên npm; phát hành dạng image Docker. Chạy Node 24.18.1 trong image. |
| PostgreSQL | 16 | Bắt buộc. |
| Redis | 7 | Bắt buộc (hàng đợi, hạn mức, cache). |

Chạy lại: `node infra/medplum/setup.mjs && docker compose -f infra/medplum/docker-compose.yml up -d && node infra/medplum/smoke-test.mjs`
(chi tiết trong `infra/medplum/README.md`; các thử nghiệm trong `infra/medplum/experiments/`). Đã dựng từ trạng thái sạch hai lần, healthy sau khoảng 1 phút.
Smoke test: 14/16 đạt, 1 cảnh báo, 1 lỗi có chủ đích (tài khoản siêu quản trị mặc định, xem F1).

### Số đo [Đã đo]

Máy 4 vCPU, 15 GB RAM. **Số sơ bộ, không thay cho kiểm tra tải ở Giai đoạn 0.** Dữ liệu 20.000 bệnh nhân trong một project, hạn mức FHIR tắt,
`saveAuditEvents` bật. Lần đo đầu chạy với Postgres/Redis trực tiếp trên máy, lần sau trên stack Docker Compose; kết quả gần nhau.

| Hạng mục | Kết quả |
|---|---|
| API FHIR | R4 (4.0.1), 146 loại tài nguyên |
| Ghi Patient / Encounter / Condition / MedicationRequest | 12–62 ms mỗi lần |
| Cấp một phòng khám (Project + ClientApplication + token) | 32–52 ms (10 lần) |
| Tìm theo số điện thoại đầy đủ | median 5–6 ms |
| Tìm theo **4 số cuối** (`phone:contains`) | 6–7 ms; có cả số chứa 4 số đó ở giữa, lớp ứng dụng phải lọc/xếp hạng |
| Tìm theo họ **có dấu** / theo CCCD / đọc theo id | 8 ms / 4–5 ms / 3–4 ms |
| Tìm theo họ **không dấu** ("Nguyen") | **0 kết quả** nếu hồ sơ chỉ lưu tên có dấu (F4) |
| Mở toàn bộ hồ sơ (`$everything`, 5 tài nguyên) | 133–196 ms (hồ sơ nhiều năm sẽ lâu hơn, chưa đo) |
| Dung lượng bệnh nhân | ≈ 10 KB mỗi bệnh nhân (chỉ Patient + chỉ mục + lịch sử), suy ra từ 157 MB → 362 MB khi thêm 20.000 |
| Ghi hàng loạt (batch 500) | 165–175 bệnh nhân/giây, đếm lại trong DB khớp |
| `AuditEvent` | 1 sự kiện cho mỗi lần đọc theo id và mỗi lần ghi, **0 cho tìm kiếm**; 4,7–5,3 KB mỗi sự kiện (ba bảng, gồm chỉ mục) |
| Sao lưu logic `pg_dump` → khôi phục (362 MB, 24 MB nén) | 3,3 s → 5,2 s, số bản ghi khớp. **Chưa phải sao lưu liên tục (PITR).** |

Tải hỗn hợp trên **một** node Medplum (Postgres, Redis và bộ tạo tải cùng máy). Mỗi "lượt khám" ảo gồm 8 lời gọi: tìm 4 số cuối, mở hồ sơ,
4 truy vấn tóm tắt, ghi Encounter và MedicationRequest.

| Đồng thời | req/s | p50 | p95 | p99 | Lỗi |
|---|---|---|---|---|---|
| 16 | 496 | 27 ms | 61 ms | 79 ms | 0 |
| 64 | 654 | 85 ms | 184 ms | 217 ms | 0 |
| 128 | 714 | 162 ms | 294 ms | 340 ms | 0 |
| 200 | 693 | 281 ms | 477 ms | 529 ms | 0 |

Thông lượng bão hòa quanh 700 req/s; ở lần đo đầu là 758 req/s với p95 = 446 ms tại 200 đồng thời. Từ 128 đồng thời trở lên độ trễ tăng gần tuyến tính theo số người dùng.

### Tìm bệnh nhân qua BFF: tiêu chí M0-3 [Đã đo, 03/10/2026]

Các số trên gọi thẳng Medplum. M0-3 (mục 5.3) hỏi về ứng dụng: tìm theo 4 số cuối và tên không dấu, **đúng** và p95 ≤ 200 ms, trên 20.000 bệnh nhân của một phòng khám.
Đo bằng `infra/medplum/experiments/bff-search.mjs` (cách chạy ở `experiments/README.md`):

- **Dữ liệu.** Một phòng khám đo mới, 20.000 bệnh nhân giả dựng bằng `buildPatient` của `@phongmach/fhir-vn-model` (có `HumanName` không dấu như ứng dụng ghi). Họ theo tỉ lệ người Việt (Nguyễn khoảng 31%), tên gọi phổ biến nhất khoảng 5% mỗi giới, đầu số theo nhà mạng, 12% dùng chung số điện thoại với người nhà, 3% không có số, CCCD giả ở 75% người từ 14 tuổi. Nạp 20.000 trong 233 giây, kiểm từng phần tử của `batch` (20.000 phần tử 201), đếm lại trong Medplum được 20.000, rồi `ANALYZE`. Postgres của stack đo có tổng cộng 53.531 bệnh nhân ở 5 project (các lần chạy thử và hai lần nạp dừng giữa chừng).
- **Đường đo.** Một BFF thật (`services/bff/src/server.ts`) trỏ vào phòng khám đo, phiên của một phụ tá, `GET /api/patients/search?q=…` như giao diện (tối đa 20 kết quả). Sáu loại truy vấn, mỗi loại 200 truy vấn khác nhau, chọn ngẫu nhiên người cần tìm; riêng "một từ" chỉ có 198 (bằng số tên gọi khác nhau có trong dữ liệu). Chạy tuần tự (một người dùng, trộn thứ tự các loại), rồi ở 16 yêu cầu đồng thời.
- **Máy.** Máy dev Windows 11 Pro, Intel i7-11800H (8 nhân, 16 luồng), 32 GB RAM, ổ NTFS. Docker Desktop (WSL2) cấp 8 CPU và 19,5 GB cho Medplum 5.2.0, PostgreSQL 16, Redis 7: **stack đo riêng** (`stack-do.mjs`, hạn mức FHIR tắt, `saveAuditEvents` bật), không phải stack dev. BFF và bộ tạo tải là Node 22.23.2 chạy thẳng trên Windows. **BFF, Medplum, Postgres, Redis và bộ tạo tải chạy chung một máy**; cùng lúc máy còn chạy stack Medplum dev và khoảng 25 container của hai dự án khác (không tải nặng).

Độ trễ đo ở phía khách qua BFF (ms), hai lần đo trên cùng dữ liệu với hai bộ truy vấn khác nhau (hạt giống 1739684244 và 411205329):

| Loại truy vấn | Tuần tự p50 / p95 / p99 | Lần 2: p50 / p95 / p99 | 16 đồng thời p50 / p95 / p99 |
|---|---|---|---|
| 4 số cuối | 15 / 23 / 27 | 16 / 24 / 26 | 31 / 42 / 47 |
| Tên không dấu, một từ (tên gọi) | 16 / 23 / 27 | 17 / 25 / 28 | 33 / 45 / 83 |
| Tên không dấu, hai từ (họ + tên) | 18 / 27 / 29 | 18 / 26 / 32 | 35 / 45 / 53 |
| Tên không dấu, đủ họ tên | 18 / 30 / 34 | 19 / 29 / 35 | 36 / 55 / 79 |
| Số điện thoại đầy đủ | 14 / 24 / 29 | 15 / 22 / 27 | 30 / 38 / 44 |
| CCCD | 15 / 25 / 27 | 15 / 25 / 28 | 30 / 39 / 45 |
| Tất cả (lâu nhất) | 16 / 26 / 30 (39) | 16 / 26 / 30 (36) | 32 / 45 / 65 (104); 479 yêu cầu/giây |

Tính đúng, so với dữ liệu gốc (lần 1; lần 2 trong ngoặc). "Khớp đúng từng từ" là mỗi từ đã gõ trùng một từ của tên không dấu. Truy vấn có hơn 20 người khớp đúng từng từ thì giao diện không thể hiện hết, nên người cần tìm vắng mặt ở đó là chính đáng; chúng được đếm riêng:

| Loại truy vấn | Có người cần tìm | Khi ≤ 20 người khớp | > 20 người khớp | Ghi chú |
|---|---|---|---|---|
| 4 số cuối | 198/200 (199/200) | 198/200 (199/200) | 0 | Mọi người có số **kết thúc** bằng 4 số đều đứng trước người chỉ chứa 4 số ở giữa (0 sai thứ tự); nhưng 5 (4) truy vấn **thiếu** người có số kết thúc bằng 4 số |
| 4 số cuối, 50 ca khó (4 số bắt đầu bằng đầu số di động, ví dụ `0975`) | 41/50 (41/50) | như bên trái | 0 | 11 (18) truy vấn thiếu người có số kết thúc bằng 4 số; 17 (28) truy vấn có hơn 50 số **chứa** 4 số đó, nhiều nhất 113 |
| Tên, một từ | 39/198 (45/198) | không có truy vấn nào | 198 (198) | Ở 20.000 bệnh nhân, tên gọi nào cũng có hơn 20 người |
| Tên, hai từ | 157/200 (142/200) | 120/124 (110/119) | 76 (81) | Ví dụ `vu ha`: 5 người khớp đúng từng từ, 44 người có tên bắt đầu bằng hai từ đó, người cần tìm không có trong 20 kết quả |
| Tên, đủ họ tên | 196/200 (195/200) | 192/193 (192/193) | 7 (7) | |
| Số điện thoại đầy đủ, CCCD | 200/200 (200/200) | 200/200 | 0 | |

Mọi kết quả trả về đều khớp truy vấn. 23 (22) trên 1.198 truy vấn ra tập kết quả khác nhau giữa lần chạy tuần tự và lần chạy đồng thời. Tất cả đều là truy vấn có hơn 20 người khớp: mỗi lần Medplum trả một tập 20 người khác.

**Kết quả M0-3: tốc độ đạt, tính đúng chưa đạt.**

- **Tốc độ đạt xa ngưỡng**: p95 tuần tự 23–30 ms cho 4 số cuối và tên không dấu (ngưỡng 200 ms), 41–55 ms ở 16 đồng thời.
- **4 số cuối sai khi có hơn 50 số chứa 4 số đó.** BFF lấy 50 kết quả `phone:contains` rồi mới xếp người có số kết thúc bằng 4 số lên trước (`FRAGMENT_FETCH`, `rankByPhoneSuffix`). Medplum dịch `phone:contains` thành một biểu thức chính quy (`~*`) trên mọi số của phòng khám, `LIMIT 51`, **không sắp xếp** [Đã đo qua log Postgres]. Khi 4 số trông như một đầu số (`03x`, `08x`, `09x`), hàng trăm số chứa chúng ở đầu, và người cần tìm có thể nằm ngoài 50 kết quả đầu: 1–2 trên 200 truy vấn ngẫu nhiên, 9 trên 50 ca khó (cả hai lần đo). Số số "chứa" tăng tuyến tính theo cỡ phòng khám, nên lỗi tăng theo.
- **Tên khớp theo đầu từ và không được xếp hạng.** Medplum dịch mỗi từ thành `to_tsquery('simple', 'an:*')` (đầu từ) trên `HumanName`, mỗi từ một `EXISTS`, `LIMIT 21`, không `ORDER BY` [Đã đo qua log Postgres]. Gõ `bui an` ra cả những người họ Bùi tên Anh hoặc Ánh. Khi số người khớp đầu từ vượt 20, người khớp đúng từng từ có thể bị đẩy ra ngoài: 4/124 và 9/119 truy vấn hai từ dù chỉ có 3–20 người khớp đúng, 1/193 truy vấn đủ họ tên (ví dụ `le thuy thu`: 3 người khớp đúng, 102 người khớp đầu từ).
- **Truy vấn mơ hồ là chuyện thường ở 20.000 bệnh nhân**: mọi truy vấn một từ, 38–41% truy vấn họ + tên và 3,5% truy vấn đủ họ tên có hơn 20 người khớp đúng từng từ. Khi đó giao diện hiện 20 người bất kỳ, đổi giữa hai lần gọi, và không báo là còn người khác.

Tách thời gian (ms, mọi loại gộp lại, lần 1):

| Thành phần | Tuần tự p50 / p95 | 16 đồng thời p50 / p95 |
|---|---|---|
| Phía khách, đầu-cuối qua BFF | 16 / 26 | 32 / 45 |
| BFF tự đo (`responseTime` của Fastify) | 15 / 25 | 32 / 45 |
| Phần Medplum: `searchPatients` của BFF gọi bằng `fetch`, như BFF | 15 / 24 | 29 / 49 |
| Phần Medplum: cùng hàm, gọi bằng `http.request` (thời gian của riêng Medplum) | 5,9 / 11 | 22 / 31 |
| Ghi nhật ký truy cập (`NdjsonAuditSink`: ghi nối rồi `fsync`), đo riêng | 1,0 / 1,1 (p99 3,6) | 14 / 18 (16 lần ghi xếp hàng) |
| Sàn HTTP tới BFF (`/api/health`): bằng `http.request` / bằng `fetch` | 0,5 / 0,7 và 16 / 17 | |

- **Gần như toàn bộ thời gian của BFF là một lượt gọi Medplum.** Ở p50 tuần tự, BFF mất 15 ms, bằng một lượt gọi Medplum qua `fetch` (15 ms). Phần còn lại (nhật ký truy cập khoảng 1 ms đo riêng; xác thực phiên, kiểm tra tham số, log, trả JSON) nằm trong sai số của phép đo này, cỡ 1–2 ms.
- **Trên Windows, `fetch` của Node có sàn khoảng 15 ms mỗi yêu cầu**, dù bên kia trả lời ngay: máy chủ Node trống trả lời `fetch` sau 15,4 ms, `http.request` giữ kết nối sau 0,16 ms; cùng bài thử trong container Linux trên máy này cho `fetch` 1,6 ms. `MedplumClient` của BFF gọi bằng `fetch`, nên trên máy này mỗi lời gọi Medplum tốn ít nhất 15 ms, trong khi Medplum tự làm 5–10 ms. Trên Linux, phần tìm của BFF ước còn khoảng 10 ms ở p50 [Phân tích: trừ sàn của `fetch`, chưa đo BFF trên Linux]. Bộ tạo tải gọi BFF bằng `http.request` để không cộng thêm sàn đó ở phía khách (trình duyệt không có).
- **Nhật ký truy cập là một phần nhỏ của ngân sách**, nhưng các lần ghi xếp hàng nối tiếp (mỗi lần một `fsync`, khoảng 1 ms trên ổ này): 16 lần ghi cùng lúc thì mỗi lần mất 14–18 ms (p50–p95). Trần của một tiến trình BFF vào khoảng 1.000 dòng nhật ký mỗi giây trên ổ này [Phân tích]. Không ảnh hưởng M0; tính vào T-AUD khi một BFF phục vụ nhiều phòng khám (ghi gộp nhiều dòng một lần `fsync`).

Hướng sửa tính đúng [Đề xuất; phiên đo không sửa mã sản phẩm]:

1. **4 số cuối: một khóa tìm chính xác thay cho `contains`.** Lúc tạo và sửa bệnh nhân, ghi thêm 4 số cuối thành một định danh riêng (cùng cách làm với `HumanName` không dấu ở T-NAME), ví dụ hệ `urn:phongmach:sdt-4-so-cuoi`. Tìm chính xác theo token (có chỉ mục) ra đủ người có số kết thúc bằng 4 số; sau đó mới gọi `phone:contains` để thêm người có 4 số ở giữa, bỏ trùng. Phải ghi bổ sung cho bệnh nhân đã có (seed, dữ liệu nhập). Cách khác là một `SearchParameter` tùy biến (cần reindex, T4). Chỉ tăng `FRAGMENT_FETCH` thì chỉ đẩy ngưỡng lên: ở 20.000 bệnh nhân đã có 113 số chứa cùng 4 số.
2. **Tên: xếp hạng ở BFF.** Lấy nhiều hơn 20 (ví dụ 100) rồi xếp người khớp đúng từng từ trước người chỉ khớp đầu từ, giống `rankByPhoneSuffix`. Chi phí của `_count=100` chưa đo. Vẫn hụt khi số người khớp đầu từ vượt số lấy về (ví dụ `nguyen phu`: 311 người); muốn chắc chắn thì cần thêm một khóa tên không dấu đầy đủ để tìm chính xác trước.
3. **Truy vấn mơ hồ.** Lấy 21 để biết còn người khác, giao diện báo "còn người trùng tên, gõ thêm năm sinh hoặc 4 số cuối". Cho phép gõ lẫn tên và số (`an 5678`, `nguyen van an 1985`): hiện `classifyQuery` coi chuỗi số là một từ của tên [Đã đọc mã], nên truy vấn đó có lẽ ra 0 kết quả [Chưa kiểm chứng]. Ổn định thứ tự bằng `_sort` (ví dụ người mới cập nhật lên trước), chi phí chưa đo.
4. **Tốc độ không cần sửa cho M0.** Nếu buổi trình diễn chạy BFF trên Windows (Q16), sàn 15 ms của `fetch` cộng dồn ở các đường gọi Medplum nối tiếp nhiều lần (cấp số, hoàn tất lượt khám), không ở đường tìm. Cách gỡ: chạy BFF trên Linux, hoặc truyền cho `MedplumClient` một `fetch` không có sàn đó [Đề xuất, ngoài phạm vi M0-3].

Bài học khi đo:

- **Đo ngay sau khi nạp hàng loạt thì sai.** Lần chạy thử 500 bệnh nhân đo xong trước khi autovacuum kịp `ANALYZE`: truy vấn tên hai, ba từ bắt đầu bằng "nguyen" mất 300–400 ms; sau `ANALYZE` cùng truy vấn còn 11–18 ms. Script nay tự `ANALYZE`. Việc này cũng áp dụng cho nhập dữ liệu thật (T-MIG): phòng khám vừa nhập Excel có thể tìm chậm trong vài chục giây đầu [Phân tích].
- **Nạp song song có `ifNoneExist` gặp lỗi tuần tự hóa của Postgres** (F13).
- **Bộ sinh dữ liệu phải gần thực tế mới đo đúng được tính đúng.** Bản đầu cho "Linh" ở 16% phụ nữ ("Nguyễn Thị Linh" 156 người): quá nhiều truy vấn mơ hồ. Đã làm phẳng; kết luận về hai lỗi trên không đổi.

### Chưa thử

Giao diện web Medplum, Bot, Subscription (webhook), xác thực hai lớp, chạy nhiều bản server, nâng cấp phiên bản, PITR, ảnh Docker 3.x, mã hóa cấp trường,
lưu trữ S3/MinIO, mọi bộ nối (Cổng Đơn thuốc, ký số, Zalo, thanh toán, hóa đơn điện tử), phương án B.
Ngoại tuyến đã làm và đo ở M0-S3 trong phạm vi M0 (mục 5.9); T6 đầy đủ thì chưa.

### Phát hiện từ việc cài đặt và xây dựng (F1–F13)

| # | Phát hiện | Mức | Tác động | Công việc |
|---|---|---|---|---|
| F1 | Tài khoản siêu quản trị mặc định `admin@example.com` / `medplum_admin` đăng nhập được trên bản cài mới | [Đã đo] | Lỗ hổng nếu server mở ra mạng | T-SEC0 |
| F2 | Medplum luôn gọi `api.pwnedpasswords.com` khi tạo user / đặt / đổi mật khẩu, không thấy công tắc cấu hình; mạng chặn thì lỗi `fetch failed` | [Đã đo] `newuser`; [Đã đọc mã] `setpassword`, `changepassword` | Phụ thuộc dịch vụ nước ngoài trên đường xác thực (chỉ gửi tiền tố băm, không phải dữ liệu bệnh nhân). Ảnh hưởng cả việc đổi mật khẩu admin | T-IDP, T-EGR |
| F3 | Medplum sinh `AuditEvent` cho đọc/ghi nhưng mặc định chỉ ghi log; phải bật `saveAuditEvents`. Tìm kiếm không được lưu. Việc lưu **không đợi kết quả**, lỗi chỉ ghi log | [Đã đo] bật/tắt, 1:1, không có cho tìm kiếm; [Đã đọc mã] không đợi | Nhật ký không đầy đủ nếu DB quá tải; khối lượng lớn (mục 3.2) | T-AUD |
| F4 | Tên chỉ lưu có dấu thì không tìm được bằng không dấu; thêm một `HumanName` thứ hai không dấu thì tìm được | [Đã đo] | Phụ tá gõ "nguyen van an" là cách tự nhiên nhất | T-NAME |
| F5 | Hạn mức FHIR theo điểm (đọc 1, tìm 20, ghi 100; mặc định 50.000 điểm/phút/người dùng ≈ 500 lần ghi/phút; project gấp 10). Đăng nhập 5 lần/phút theo IP. `batch` trả HTTP 200 nhưng từng phần tử có thể là 429 | [Đã đọc mã] cấu hình và khóa theo IP; [Đã đo] 429 | Nhập dữ liệu hàng loạt thất bại âm thầm (tôi đã mắc lỗi này khi đo). Nhiều phòng khám sau cùng NAT, hoặc proxy không chuyển IP thật, dùng chung bộ đếm đăng nhập | T-QUOTA, T-MIG |
| F6 | Một `Project` + một `ClientApplication` cho mỗi phòng khám: cô lập đọc/tìm/sửa chéo đều bị chặn (404) | [Đã đo] | Xác nhận quyết định đa tenant của TL34 | T-TEN |
| F7 | Server tự gọi ra ngoài: kiểm tra mật khẩu (F2), kiểm tra phiên bản mới lúc khởi động (log `Failed to check for newer version`), và tính năng tùy chọn (reCAPTCHA, đăng nhập Google, OpenAI) chỉ khi bật | [Đã đo] kiểm tra phiên bản; [Đã đọc mã] còn lại. Chưa xác định host đích của kiểm tra phiên bản | Cần danh sách egress được duyệt để tuân thủ NĐ 53/2022 | T-EGR |
| F8 | Image không có shell; có sẵn móc OpenTelemetry trong lệnh khởi động | [Đã đo] | Quan sát bằng OTel; gỡ lỗi trong container cần công cụ ngoài | T-OBS |
| F9 | Migration chạy khi server khởi động (hơn 100 bước tiền triển khai, cộng hàng đợi hậu triển khai) | [Đã đo] qua log | Nâng cấp cuốn chiếu nhiều bản phải được kiểm chứng | T-UPG |
| F10 | Dev dùng lưu trữ tệp cục bộ (`binaryStorage: file:`) | [Đã đo] | Không dùng được khi chạy nhiều bản server; production cần S3/MinIO [Chưa kiểm chứng] | T-HA |
| F11 | `Bundle` loại `transaction` của Medplum 5.2.0 **không nguyên tử**: một mục lỗi (412 do `If-Match` cũ, 400, 404) được báo riêng trong phản hồi **HTTP 200**, còn các mục khác vẫn được ghi. Tạo có điều kiện (`ifNoneExist`) trong gói hoạt động: mục đã có trả 200 và tham chiếu `urn:uuid:` nối vào bản ghi đã có | [Đã đo] 5 ca trên server thật: `PUT` id lạ (201,400), `GET` id lạ (201,404), `If-Match` cũ (201,201,412 và 2 bản ghi vẫn được tạo), tạo có điều kiện trùng (201,200); chạy lại cùng gói sau lỗi 412 cho toàn 200, không bản ghi trùng, mọi tham chiếu đúng. Đo thêm 04/10/2026: mục lỗi không dừng gói, **các mục sau vẫn chạy, kể cả mục đứng cuối**; mục tham chiếu `urn:uuid:` tới một mục lỗi được lưu với một id Medplum đã cấp sẵn nhưng **không tồn tại** (đo tất định: mục thuốc 412, mục đơn vẫn 201 và trỏ tới `MedicationRequest/<id không có>`; gửi lại gói thì đơn trả 200, giữ nguyên tham chiếu đó) | Không được dựa vào hoàn tác hay vào `If-Match` trong gói để chặn ghi đồng thời. Mọi lời ghi nhiều bản ghi phải **chạy lại được** (định danh xác định + `ifNoneExist`) và người gọi phải kiểm tra từng mục của phản hồi. **Sửa 04/10/2026:** mục "điểm chốt" đứng cuối trong cùng gói **không** bảo vệ được gì khi một mục trước nó lỗi. Điểm chốt phải là một lời ghi riêng, gửi sau khi mọi mục đã được xác nhận; các bản ghi tham chiếu nhau phải ghi ở các bước nối tiếp và trỏ tới id thật (mục 5.9, "Ghi cùng lúc") | T-IDEM, T-OUTBOX |
| F12 | Chromium (bản không giao diện, Playwright) **bỏ mất sự kiện trả về của yêu cầu IndexedDB đang dở** khi trang gọi `print()` trên iframe: lời hứa của yêu cầu đó không bao giờ xong, kể cả sau 10 giây. fetch, hẹn giờ và WebCrypto không bị. Với kho chạy lần lượt, một yêu cầu bị mất làm treo mọi thao tác sau nó, và hàng đợi đồng bộ không gửi được nữa cho tới khi tải lại trang | [Đã đo] IndexedDB thuần mất 8–14 trên 200 yêu cầu đang dở; với kho của ứng dụng: 3 trong 6 lần thử một lần đọc rồi in bị treo; trình duyệt có giao diện [Chưa thử] | Ký khi mất mạng rồi in ngay, đúng lúc hàng đợi đang đọc kho: lần chạy đầu của bài e2e và hai lần chạy gỡ lỗi đều treo đồng bộ | M0-S3 lát 3b: hàng rào in (`whileLocalStoreQuiet`) và hạn 20 giây cho mỗi thao tác kho; e2e đo bất biến "không in khi còn yêu cầu đang dở" |
| F13 | Tạo có điều kiện (`ifNoneExist`) trong nhiều `batch` chạy song song: Postgres trả lỗi tuần tự hóa 40001 ("could not serialize access due to read/write dependencies among transactions"), Medplum báo **HTTP 409 ở từng phần tử** trong khi `batch` vẫn trả 200; gửi lại ngay các phần tử đó, tới lần thứ 5 vẫn 409 | [Đã đo] 4 batch × 500 bệnh nhân song song, hai lần nạp đều dừng (ở phần tử 1.500 và 9.500); một batch một lúc: 0 lần 409 qua hai lần nạp 20.000 | Nhập dữ liệu hàng loạt phải chạy lần lượt hoặc gửi lại có chờ, và đếm 409 như một lỗi tạm thời (giống 429 ở F5). Ứng dụng cũng gặp, **đã sửa ở PR #14** (mục 5.9, "Ghi cùng lúc"). Lời tạo có điều kiện đơn lẻ chạy trong một giao dịch `serializable`; Medplum tự thử 3 lần (gốc 50 ms) rồi trả HTTP 409 `conflict` mang mã `40001`, giao dịch bị hủy không ghi gì (0/5 lời để lại bản ghi), và client `@medplum/core` chỉ tự thử lại 429 và 5xx [Đã đo, 04/10/2026]. Qua BFF trên máy dev, trước khi sửa: 20 lời tạo bệnh nhân cùng lúc thì 8–27% lời nhận 500 (10 lời: 0–7,5%; 3–5 lời: 0/115; 1 lần ở CI với 3 lời); 3, 5, 12 lượt ký cùng lúc thì 5/24, 12/25, 20/24 lượt khám **thiếu bản ghi** sau khi gửi lại. Nay BFF thử lại lời ghi có `clientUuid` + `ifNoneExist`, hết lượt trả 503 `busy`; gửi lại cùng `clientUuid` không tạo trùng | T-MIG, T-IDEM |

---

## 3. Review tài liệu nội bộ 34 trang

### 3.1 Đánh giá chung

TL34 là tài liệu chắc tay: phản biện đúng các lỗi của báo cáo gốc (Nghị định 90/2026 thay 117/2020, mốc 01/01/2026 đã qua, thiếu luật dữ liệu cá nhân và bệnh án điện tử,
Medplum không có ngoại tuyến), đặt đúng cổng quyết định, có phương án dự phòng, có đủ 6 trụ cột với số đo. Báo cáo v2.0 đã hấp thụ các sửa đổi đó.
Phần dưới chỉ nêu những chỗ **đã kiểm chứng bằng thực nghiệm**, **mâu thuẫn nội bộ** hoặc **chưa đủ**. Tôi không thể kiểm các điều khoản pháp lý và giá cả; phần đó dựa vào TL34.

### 3.2 Giả định của TL34 đã kiểm chứng

| # | TL34 nói | Kết quả | Mức | Hành động |
|---|---|---|---|---|
| 1 | Cấp phòng khám tự động dưới 2 phút (D.4) | Project + tài khoản máy + token mất 32–52 ms. Chưa tính tạo người dùng, AccessPolicy, nạp danh mục | [Đã đo] | Đạt; đo lại cả quy trình ở T-TEN |
| 2 | Q7: Medplum có chia sẻ danh mục chuẩn giữa các project không? (F.2) | **Có**, qua `Project.link`. Phòng khám đã link thấy ValueSet dùng chung (1), phòng khám không link thấy 0, link thử sửa → 403. Mới thử với ValueSet, chưa thử Medication hay danh mục lớn | [Đã đo] | Đóng Q7 ở mức sơ bộ; thử với danh mục thuốc ở Giai đoạn 0 |
| 3 | "Xuất/xóa trọn project" đáp ứng nghĩa vụ Luật BVDLCN (C.3) | **Một phần**. `Project/{id}/$expunge` (bất đồng bộ, xong sau khoảng 1 s) xóa Patient, tài khoản máy, project và **cả AuditEvent (2.004 → 0)**, nhưng **`Binary` còn nguyên: 4 dòng trong DB và file trên đĩa**, vẫn đọc được bằng quyền siêu quản trị. Bộ xóa trong mã nguồn bỏ qua `Binary`. Export cấp project (`$export`) có Patient/Encounter/MedicationRequest nhưng **không có Binary lẫn AuditEvent**, và **file `ClientApplication` chứa trường `secret`** | [Đã đo]; [Đã đọc mã] bỏ qua Binary | Ảnh khám và PDF đơn thuốc của tenant đã rời đi không bị xóa. Cần quy trình rời tenant riêng (T-OFFB) |
| 4 | Nhật ký "bất biến (WORM), lưu ≥ 2 năm" (D.1) | Xóa tenant xóa luôn nhật ký của tenant (dòng 3). Ngoài ra project admin được phép `$expunge` chính project của mình | [Đã đo]; [Đã đọc mã] quyền | Lưu bản sao nhật ký ngoài Medplum trước khi xóa; AccessPolicy không cho tenant admin gọi `$expunge` (T-AUD, T-OFFB) |
| 5 | "AuditEvent cho mọi đọc/ghi PHI" và "cảnh báo truy cập bất thường (đọc > N hồ sơ/phút)" (D.1) | Có điều kiện (F3). Truy cập bất thường thường là quét danh sách/tìm kiếm, mà tìm kiếm **không** sinh sự kiện. Phải ghi nhật ký ở BFF | [Đã đo] | T-AUD |
| 6 | Idempotency theo UUID client cho mọi lệnh ghi (A.4, C.1, C.5) | `PUT /Patient/{uuid do client chọn}` khi chưa tồn tại → **404**: không dùng được id làm khóa. **`If-None-Exist` theo identifier hoạt động**: POST 2 lần → 201 rồi 200, 1 bản ghi; transaction bundle gửi lại → 201 rồi 200, 1 bản ghi | [Đã đo] | Lưu UUID client thành `identifier`, dùng create có điều kiện (T-IDEM) |
| 7 | "Transactional outbox": ghi MedicationRequest vào Medplum và outbox "GửiĐơnQuốcGia" **cùng giao dịch** (C.5 bước 4) | Không khả thi như mô tả: ghi vào Medplum đi qua API của nó, ghi outbox nằm ở DB của BFF, **không có giao dịch chung** (ghi kép). Mất điện giữa hai bước làm đơn đã ký mà không được gửi, hoặc ngược lại | [Phân tích] | Ghi ý định gửi trước, ghi FHIR idempotent theo mã đơn, và có bộ quét đối soát định kỳ tìm đơn đã ký chưa có trạng thái liên thông (T-OUTBOX). **Đã làm ở M0-S2** (xem A2, F11 và mục 5.7) |
| 8 | Tìm 4 số cuối điện thoại dưới 200 ms (D.5) | 6–7 ms ở 20.000 bệnh nhân/project. Tìm không dấu thì hỏng (F4). TL34 tìm trong cache client trước nên không dấu phải được chuẩn hóa ở client, còn phía server vẫn cần T-NAME. Qua BFF của M0 (mục 2, M0-3): p95 23–24 ms, nhưng 1–2 trên 200 truy vấn không ra người cần tìm khi hơn 50 số chứa 4 số đó | [Đã đo] | Giữ ngân sách; tìm 4 số cuối bằng khóa chính xác thay cho `contains` (T-NAME); thêm kiểm tra ở quy mô 500 tenant (T2) |
| 9 | Patient-summary p95 < 300 ms ở 500 tenant, 200 người dùng đồng thời (E.2) | Một node chia sẻ 4 vCPU đạt p95 = 294 ms ở 128 đồng thời và 477 ms ở 200 (mục 2). Khả thi nhưng **cần nhiều bản server và DB riêng**; một node dùng chung không đủ | [Đã đo] | T-CAP; chạy T2 trên triển khai nhiều node |
| 10 | Mã hóa cấp trường theo khóa từng tenant (C.1, D.1): đây là nghĩa của "khóa riêng" | Hợp lý, nhưng trường đã mã hóa **không tìm kiếm được ở server**. CCCD là khóa tìm bệnh nhân và là khóa của `If-None-Exist` | [Phân tích] | Chỉ số mù (HMAC có khóa theo tenant) cho CCCD, quyết định trường nào mã hóa (T-ENC) |
| 11 | "Pin nhánh LTS" (A.4, D.6) | Không có tag `lts` trên npm lẫn Docker. npm: `latest` = 5.2.0 (30/09/2026), `backport` = 3.3.1 (11/09/2026; 3.3.0 ra từ 02/2025). Docker có `3.3.1`, `5.1`, `5.1.44`. Đã cài 5.2.0 | [Đã đo] | Chốt "LTS" nghĩa là gì (Q12) |
| 12 | Đăng nhập bằng số điện thoại + OTP + thiết bị tin cậy (D.1); MFA cho vai trò ký/quản trị | MFA qua người dùng Medplum dính F2. Đăng nhập số điện thoại + OTP không thấy trong Medplum mặc định | [Chưa kiểm chứng] | T-IDP |

Ước tính khối lượng nhật ký truy cập [Phân tích]. Đầu vào: giả định của TL34 (40 phiên khám/tenant/ngày, 60 yêu cầu BFF/phiên, 60% trong khung 17–21h),
số đo 1 sự kiện/lần đọc hoặc ghi theo id và ≈ 5 KB/sự kiện. Hệ số khuếch đại (bao nhiêu thao tác FHIR theo id cho mỗi yêu cầu BFF, từ 1 đến 10) là **giả định của tôi**
vì patient-summary gom 8–12 tài nguyên.

| Quy mô | Sự kiện/ngày | Dung lượng/năm | Ghi trung bình trong khung 17–21h |
|---|---|---|---|
| 300 phòng khám, khuếch đại 1× | 0,72 triệu | ≈ 1,3 TB | ≈ 30 sự kiện/s |
| 300 phòng khám, khuếch đại 10× | 7,2 triệu | ≈ 13 TB | ≈ 300 sự kiện/s |
| 1.000 phòng khám (nhân 3,3) | 2,4–24 triệu | ≈ 4–44 TB | ≈ 100–1.000 sự kiện/s |

Để so sánh, TL34 ước tính dữ liệu tích lũy ≈ 2 TB ở 300 tenant, chủ yếu là ảnh. Nếu lưu mọi lần đọc trong Medplum thì nhật ký có thể là bảng lớn nhất hệ thống.
Cần quyết định mức chi tiết của nhật ký (Q13).

### 3.3 Mâu thuẫn và chỗ cần làm rõ

| # | Vấn đề | Chi tiết | Đề xuất |
|---|---|---|---|
| 1 | **12 sprint trong một giai đoạn 4 tháng** (E.3) | S1–S2, S3–S4, S5–S6, S7–S8, S9, S10, S11–S12 = 12 sprint = 24 tuần. Giai đoạn 12/2026–03/2027 dài khoảng 17 tuần, trừ Tết (khoảng 06/02/2027) còn khoảng 8 sprint. Thiếu 3–4 sprint, khoảng một phần tư phạm vi | Đã xử lý theo quyết định 02/10/2026: bắt đầu xây từ 05/10 và cắt phạm vi (mục 6) |
| 2 | **Ba con số chi phí hạ tầng cho 300 tenant** | E.5: ≤ 50.000 đ/tenant/tháng (= 15 triệu); E.2 tiêu chí "đi": ≤ 25 triệu/tháng (= 83.000 đ/tenant); E.6 ngân sách: tăng đến ≈ 60 triệu/tháng (= 200.000 đ/tenant). D.6 và B.5 lại nhắm ≤ 40.000 đ/tenant ở **1.000** tenant (= 40 triệu). Tiêu chí "đi" thấp hơn ngân sách chính nó | Một mô hình chi phí duy nhất (T-COST), dựa trên số đo (Q1) |
| 3 | **Hệ số đỉnh chưa giải thích** (D.4) | 300 tenant × 40 phiên × 60 yêu cầu = 720.000 yêu cầu/ngày; 60% trong 4 giờ ≈ 30 yêu cầu/giây. TL34 ghi đỉnh ≈ 400/giây, gấp khoảng 13 lần | Làm rõ (đỉnh theo giây? khuếch đại FHIR?); kích thước hệ thống chênh một bậc tùy cách hiểu |
| 4 | **Phương án B tái sử dụng lớp tích hợp** (A.4, E.2) | Lớp BFF/tích hợp đề xuất viết bằng NestJS/TypeScript (C.2), còn phương án B là .NET. Chỉ tái sử dụng được nếu lớp đó là các dịch vụ REST độc lập. "+6 tuần" có thể lạc quan | Thiết kế bộ nối thành dịch vụ riêng, độc lập ngôn ngữ; ước lượng lại phương án B ở Giai đoạn 0 |
| 5 | **Chọn nhà cung cấp cloud đến tuần 5–6, nhưng PoC chạy từ tuần 2** (E.2) | PoC trên K8s của nhà cung cấp trong nước cần tài khoản thử từ tuần 1–2; hợp đồng có thể đợi | Xin tài khoản thử của 2–3 nhà cung cấp ở tuần 1 |
| 6 | **Hạn 31/12/2026 và pilot** (E.1) | TL34 cho EMR tinh gọn vào MVP và "hỗ trợ pilot hoàn tất hồ sơ theo TT 13/2025", nhưng pilot chỉ bắt đầu từ 03/2027, sau hạn. Gói Khởi đầu (349.000 đ) không có bệnh án điện tử đầy đủ trong khi quy định áp dụng cho mọi phòng khám | Q4 |
| 7 | **Mốc "300 tenant"** | Quyết định #10 và B.5: "12 tháng sau MVP"; E.5 và D.4: Q4/2027 | Định nghĩa rõ "MVP" (bắt đầu hay kết thúc Giai đoạn 1) |
| 8 | **Khối lượng ảnh** (D.4) | Theo chính các giả định (40 phiên × 50% có ảnh × 2 ảnh × 500 KB) ra khoảng 600 MB/tenant/tháng, tức 180 GB/tháng ở 300 tenant; bảng ghi ≈ 300 GB, cao khoảng 1,7 lần ở mọi mốc | Thống nhất giả định hoặc bảng (thiên về dư, không nguy hiểm) |
| 9 | **Mã đơn cấp sẵn** (C.5, C.7) | Thiết kế dựa vào "khối mã đã cấp trước cho tenant, 50 mã/bác sĩ" để kê khi mất mạng. Chưa có xác nhận Cổng cho phép cấp mã trước | Đưa vào Q1/Q4 của TL34 (tuần 3–4) |
| 10 | Trang "Mục lục" (trang 2) trống | Trường mục lục chưa cập nhật | Sửa khi phát hành bản sau |

### 3.4 Trạng thái các câu hỏi mở F.2

| Q (TL34) | Nội dung | Hạn | Trạng thái |
|---|---|---|---|
| Q1 | Tài liệu API chính thức QĐ 808 và quan hệ với csdlduoc.com.vn | Tuần 3 | Mở. **Chặn T1.** |
| Q2 | NĐ 90/2026 có điều khoản riêng về kê đơn điện tử, bệnh án điện tử? | Tuần 2 | Mở (pháp lý) |
| Q3 | Nhà cung cấp ký số hỗ trợ ký theo phiên/lô, ≤ 50.000 đ/tháng/bác sĩ | Tuần 4 | Mở. Quyết định T1 |
| Q4 | Mức chấp nhận độ trễ gửi đơn khi mất mạng | Tuần 4 | Mở. Xem thêm Q3 mục 9 (nhà thuốc) |
| Q5 | Chuẩn kết nối Sổ sức khỏe điện tử cho cơ sở tư nhân | Tuần 5 | Mở |
| Q6 | Cloud trong nước: PostgreSQL HA, S3 đa vùng, K8s SLA ≥ 99,95% | Tuần 4 | Mở |
| Q7 | Chia sẻ danh mục giữa project | Tuần 3 | **Đã trả lời sơ bộ**: có, qua `Project.link` (mục 3.2 dòng 2) |
| Q8 | Đăng ký/thông báo với Bộ Công an cho dữ liệu nhạy cảm | Tuần 3 | Mở (pháp lý) |
| Q9 | Trường bắt buộc của hồ sơ bệnh án ngoại trú | Tuần 4 | Mở |
| Q10 | Kênh phân phối hiệu quả nhất | Tuần 6 | Mở |

---

## 4. Kiến trúc: điều chỉnh sau thử nghiệm

Giữ nguyên kiến trúc mục tiêu của TL34 (phần C): kênh người dùng PWA/tablet, biên, BFF + dịch vụ tích hợp, Medplum LTS tự lưu trữ, PostgreSQL/Redis/object storage,
Kubernetes hai vùng. Những điều chỉnh bên dưới đều có bằng chứng ở mục 3.2.

| # | Điều chỉnh | Lý do |
|---|---|---|
| A1 | **Idempotency**: UUID do client sinh lưu thành `identifier` (ví dụ `urn:phongmach:client-uuid`), ghi bằng create có điều kiện (`If-None-Exist`), dùng transaction bundle có `urn:uuid:` để nối tham chiếu giữa các bản ghi tạo khi ngoại tuyến. Không dùng `PUT` theo id | Medplum từ chối `PUT` tạo mới theo id client (404); `If-None-Exist` đã thử, không tạo trùng, kể cả khi 6 yêu cầu cùng `clientUuid` đến đồng thời qua BFF (9 lần chạy) |
| A2 | **Gửi cổng không dựa vào "cùng giao dịch"**: ghi ý định gửi (outbox) trước → transaction bundle idempotent → worker gửi cổng idempotent theo mã đơn → **bộ quét đối soát** tìm MedicationRequest đã ký chưa có trạng thái liên thông. Subscription của Medplum chỉ là tín hiệu phụ, chưa kiểm chứng | Ghi kép giữa Medplum và DB của BFF. **Đã làm ở M0-S2**: outbox là `Task` `send-prescription` nằm trong Medplum, ghi cùng gói với đơn (nên không còn ghi kép giữa hai kho). Vì gói không nguyên tử (F11): mọi mục có định danh xác định theo `clientUuid` (chạy lại hội tụ), mục đóng lượt khám đứng cuối làm điểm chốt, worker chỉ gửi đơn của lượt khám đã đóng, gửi idempotent theo mã đơn. **Sửa 04/10/2026 (PR #14):** điểm chốt đứng cuối trong cùng gói không đủ (F11, F13). Việc hoàn tất nay ghi theo bước: `Task` được ghi sau đơn và trước khi đóng lượt khám, đóng lượt khám là lời ghi riêng sau cùng. Bộ quét đối soát vẫn là việc của M1 |
| A3 | **Nhật ký hai tầng**: (a) nhật ký truy cập ở BFF, ghi đồng bộ, chi tiết theo "mở hồ sơ / tìm kiếm / xuất", lưu ra kho bất biến ngoài Medplum; (b) `saveAuditEvents` của Medplum chỉ cho ghi/sửa/xóa lâm sàng. Quyết định cuối sau khi đo ở T2 | Khối lượng đọc, tìm kiếm không có sự kiện, ghi không đợi, xóa tenant xóa nhật ký |
| A4 | **Quy trình rời tenant** riêng: export tự viết (gồm Binary, loại bỏ `secret`), lưu nhật ký ra ngoài, xóa Binary và file riêng, rồi mới `$expunge`; tenant admin không có quyền `$expunge` | Mục 3.2 dòng 3–4 |
| A5 | **Danh mục dùng chung** (ICD-10, thuốc, dịch vụ mẫu) trong một project riêng, các phòng khám `Project.link` tới | Q7 |
| A6 | **Mã hóa cấp trường + chỉ số mù** cho CCCD và trường nhạy cảm; quyết định trường nào, vì sao các tìm kiếm còn lại không bị ảnh hưởng | Mục 3.2 dòng 10 |
| A7 | **Chuẩn hóa tên không dấu** ở lớp dịch vụ khi ghi (thêm `HumanName` thứ hai) hoặc `SearchParameter` tùy biến; ở client thì chuẩn hóa khi tìm trong cache | F4 |
| A8 | **Xác thực nhân viên**: chốt người dùng Medplum (kèm TOTP, chấp nhận egress HIBP qua proxy) hay IdP riêng của UNIGIS ánh xạ vào Medplum | F2 |
| A9 | **Công suất**: nhiều bản Medplum sau cân bằng tải, object storage S3-compatible, DB riêng khỏi bộ tạo tải; đặt `userFhirQuota`/`totalFhirQuota` theo từng project | Mục 2 (một node bão hòa ≈ 700 req/s), F5, F10 |

---

## 5. MVP trình nhà đầu tư (M0) và Giai đoạn 0 — Kiểm chứng (6 tuần)

Giả định bắt đầu thứ Hai **05/10/2026**, kết thúc **13/11/2026** (TL34 và báo cáo: "10–11/2026, 6 tuần"). Ngân sách ≈ 12% tổng (xem Q8).
Phần đã làm sẵn: môi trường Medplum chạy được, smoke test, bộ số đo cơ sở (mục 2) và các script thử nghiệm.

### 5.1 Quyết định 02/10/2026 và mục tiêu

**Quyết định của chủ dự án:** làm sớm (bắt đầu xây từ 05/10, song song với kiểm chứng, không đợi hết Giai đoạn 0) và cắt phạm vi (cách A + B của bản trước).
Nhiệm vụ: ra được MVP nhanh để nhà đầu tư thấy sản phẩm chạy thật và được thuyết phục hơn. Tôi hiểu "thuyết phục" là cuộc họp đi/không đi 13/11, nơi nhà đầu tư quyết định giải ngân phần còn lại (Q14 để xác nhận).

Vì vậy có hai cột mốc MVP thay cho một:

| Cột mốc | Ngày | Là gì | Dành cho |
|---|---|---|---|
| **M0 — MVP trình nhà đầu tư** | 13/11/2026 | Lát cắt dọc chạy thật trên Medplum: tiếp đón → khám → kê đơn → in, có ngoại tuyến, nhật ký truy cập, cách ly phòng khám, bác sĩ thật dùng thử và có số đo. Kết nối bên ngoài (cổng đơn thuốc, ký số, Zalo) **mô phỏng và ghi rõ** | Nhà đầu tư, bác sĩ cố vấn |
| **M1 — MVP pilot** | 31/03/2027 | Cùng ứng dụng, đã nối thật cổng đơn thuốc, ký số, thanh toán QR, Zalo gửi đơn; 15–20 phòng mạch dùng thay phần mềm cũ (mục 6) | Phòng mạch pilot |

Điều nhà đầu tư cần thấy, theo báo cáo v2.0 và TL34, và M0 trả lời được đến đâu:

| Nhà đầu tư cần thấy | M0 trả lời |
|---|---|
| Lời hứa "khám xong trong một phút" đo được | Có: bác sĩ thật, đồng hồ phiên khám, số đo p50/p90 |
| Phần khó có đường đi (cổng, ký số, ngoại tuyến) | Ngoại tuyến: chạy thật. Cổng, ký số: bằng chứng từ PoC cùng giai đoạn (T1), M0 chỉ mô phỏng giao diện |
| Tuân thủ: nhật ký truy cập, cách ly phòng khám, dữ liệu trong nước | Có (nếu M0 chạy trên hạ tầng trong nước, xem Q16) |
| Nhu cầu thật | Không phải việc của M0: đến từ nghiên cứu (T9, 5 thư cam kết) |
| Kinh tế đơn vị | Không phải việc của M0: đến từ số đo và mô hình chi phí (T5) |
| Rủi ro đã được giảm | Không phải việc của M0: đến từ T1–T10 và phương án B |

Do đó cuộc họp 13/11 cần **gói bằng chứng** (M0 + T1–T10 + 5 thư cam kết + mô hình chi phí + rủi ro/phương án B), không chỉ riêng demo.

**Nguyên tắc trình diễn trung thực:** mọi phần mô phỏng có nhãn trên màn hình và có một trang "đã thật / mô phỏng / chưa làm" trong bài thuyết trình.
Báo cáo đặt "đúng luật trọn gói" làm lời hứa; một demo bị hiểu là đã tích hợp thật sẽ mất niềm tin ngay khi nhà đầu tư thẩm định.

### 5.2 Phạm vi M0 [Đề xuất]

Cắt mạnh để làm kịp 6 tuần, giữ những gì chứng minh lời hứa cốt lõi.

| Nhóm | Làm thật | Mô phỏng (ghi rõ trên màn hình) | Không làm ở M0 |
|---|---|---|---|
| Tiếp đón, hàng chờ | Tìm bệnh nhân theo số điện thoại, 4 số cuối, CCCD, tên không dấu; tạo nhanh; cấp số; màn hình chờ; ưu tiên người đã hẹn (quy tắc cơ bản) | | Đặt lịch Zalo, check-in QR, nhập Excel, đồng ý điện tử đầy đủ |
| Khám | Màn hình khám một trang: sinh hiệu, lý do khám, triệu chứng, chẩn đoán ICD-10 gõ tắt, dị ứng, tiền sử, lịch sử khám; **2 chuyên khoa** (đề xuất nội tổng quát và nhi, Q15) | | Mẫu khám tự thiết kế, ảnh đính kèm, ký phiếu khám, các chuyên khoa khác |
| Kê đơn | Đơn mẫu, kê lại một nút, kiểm tra trùng hoạt chất / dị ứng / số ngày tối đa (30 ngày, bệnh mạn tính 90 ngày), in A5 có mã QR | **Ký số** ("ký mô phỏng", chưa gọi nhà cung cấp) | Tương tác thuốc đầy đủ, đơn thuốc cổ truyền |
| Liên thông cổng đơn thuốc | Bộ nối với giao diện chuẩn, hàng đợi gửi, trạng thái từng đơn (đã ký / chờ gửi / đã gửi / lỗi), thử lại, màn hình "đơn chưa gửi được" | **Cổng quốc gia mô phỏng**, có nút chèn lỗi để trình diễn thử lại, cho đến khi có tài liệu API và sandbox (TL34 Q1) | Gửi lên cổng thật |
| Ngoại tuyến | Tiếp đón, khám, kê đơn, in khi mất mạng; đồng bộ khi có mạng; 0 mất, 0 trùng; kịch bản ngắt mạng ngay trên sân khấu. **Đã làm (mục 5.9)**, trên từng máy: tìm trong hồ sơ trên máy, tạo bệnh nhân, cấp số tạm, gọi vào khám, khám, ký, in và in lại; kho trên máy có mã hóa; M0-2 đạt; đoạn ngắt mạng trên sân khấu làm trên một máy (N5) | | Chờ ký và gửi khi mất mạng ở mức đầy đủ; giải quyết xung đột sửa đồng thời (M0 chỉ phát hiện và báo); cache toàn bộ 20.000 bệnh nhân; hai máy thấy nhau khi phòng khám mất Internet (N5, T-OFF-3); mã PIN cho kho trên máy (quyết định 02/10) |
| Zalo | | Nút "gửi đơn qua Zalo" hiện bản xem trước tin nhắn, không gửi. **Đã làm (mục 5.9)**: tin chỉ có tên phòng khám, tên bệnh nhân, mã đơn, ngày kê và số nhận đã che; không thuốc, không chẩn đoán; không gọi mạng, mở được cả khi mất mạng | ZNS thật, nhắc lịch; tin có nội dung đơn (cần bệnh nhân đồng ý, mẫu ZNS được duyệt và ý kiến pháp chế: T-ZALO, T-CONSENT) |
| Thu tiền | | | Cả nhóm: phiếu thu, QR, sổ thu, hóa đơn điện tử (sang M1 và Giai đoạn 2) |
| Tuân thủ | Cách ly hai phòng khám demo; nhật ký truy cập xem được trên màn hình quản trị; thời gian từng phiên khám hiển thị | | Đồng ý điện tử đầy đủ, xuất/xóa theo yêu cầu, bộ hồ sơ DPIA, phân quyền chi tiết |
| Hạ tầng | Medplum 5.2.0 + PostgreSQL 16 + Redis, trên hạ tầng nhà cung cấp trong nước nếu có tài khoản thử từ tuần 2 (Q16) | | HA, vùng thứ hai, PITR (đo riêng ở T3) |

Dữ liệu M0 là dữ liệu giả hoàn toàn, không dùng dữ liệu bệnh nhân thật. Danh mục: khoảng 200–300 mã ICD-10 phổ biến cho hai chuyên khoa (nguồn là bộ ICD-10 tiếng Việt do Bộ Y tế ban hành; cần xác nhận nguồn và giấy phép), khoảng 150 hoạt chất phổ biến
(**dữ liệu minh họa, không phải danh mục thuốc chính thức**), khoảng 10 đơn mẫu cho các bệnh thường gặp do cố vấn y khoa duyệt.

Công nghệ [Đề xuất điều chỉnh nhỏ so với TL34 C.2]: PWA React + TypeScript + Vite (Dexie, Workbox cho ngoại tuyến), BFF TypeScript là lớp duy nhất gọi Medplum.
TL34 chọn NestJS; cho M0 có thể dùng khung nhẹ hơn (ví dụ Fastify) để nhanh hơn nếu kiến trúc sư đồng ý, miễn ranh giới module giữ nguyên để chuyển sau.

### 5.3 Kịch bản trình diễn, tiêu chí chấp nhận và phân công

Kịch bản 10 phút:

1. Phụ tá gõ "nguyen van an" hoặc 4 số cuối điện thoại, tìm ra bệnh nhân, cấp số; màn hình chờ cập nhật (1 phút).
2. Bác sĩ mở hồ sơ, khám một trang, gõ tắt chẩn đoán, chọn đơn mẫu; hệ thống cảnh báo trùng thuốc/dị ứng (cố ý); sửa; bấm "Ký & In"; in A5 có QR; đồng hồ phiên khám hiển thị (2 phút).
3. Trạng thái liên thông: đơn "đã gửi"; chèn lỗi cổng, đơn "chờ gửi", tự thử lại và thành công, không mất đơn (cổng mô phỏng, có nhãn) (1 phút).
4. Ngắt mạng giữa buổi khám: tiếp đón, khám, kê đơn, in vẫn chạy; bật lại, đồng bộ, không trùng (2 phút). Làm trên một máy: bác sĩ tự tiếp đón người mới đến (N5, quyết định 02/10; các bước ở `README.md`).
5. Cách ly: phòng khám B không thấy bệnh nhân của A; màn hình nhật ký truy cập của A cho biết ai đã mở hồ sơ nào (1 phút).
6. Số đo thật: thời gian phiên khám của các bác sĩ đã dùng thử; chi phí hạ tầng trên mỗi phòng khám theo số đo (1 phút).
7. Gói bằng chứng: T1–T10 hiện trạng, thư cam kết, rủi ro và phương án B (2 phút).

Tiêu chí chấp nhận M0 [Đề xuất]:

| # | Tiêu chí | Ngưỡng | Cách đo |
|---|---|---|---|
| M0-1 | Thời gian từ mở hồ sơ đến in đơn | 3 bác sĩ thật, ≥ 10 lượt khám mô phỏng mỗi người: p50 ≤ 60 s, p90 ≤ 120 s (mục tiêu của TL34 B.5) | Đồng hồ trong ứng dụng (T-TELE) |
| M0-2 | Ngoại tuyến | 20 lần ngắt/khôi phục mạng liên tiếp: 0 bản ghi mất, 0 trùng (T6 đầy đủ là 100 chu kỳ) | Kiểm thử tự động |
| M0-3 | Tìm bệnh nhân | 4 số cuối và tên không dấu đúng, p95 ≤ 200 ms trên 20.000 bệnh nhân | Script `experiments/` |
| M0-4 | Cách ly phòng khám | 0 lỗi mỗi lần chạy bộ kiểm thử đọc/tìm/sửa chéo | `smoke-test.mjs` và kiểm thử của ứng dụng |
| M0-5 | Trung thực | Mọi phần mô phỏng có nhãn trên màn hình; có trang "đã thật / mô phỏng / chưa làm" | Rà soát trước buổi trình diễn |
| M0-6 | Ổn định khi trình diễn | Có bản dự phòng: video quay sẵn và máy dự phòng | Diễn tập hai lần |

Phân công [Đề xuất], dựa trên đội Giai đoạn 0 của TL34 E.6 (PO/BA 1, kiến trúc sư 1, kỹ sư backend TypeScript 2, frontend 2, DevOps/SRE 1, UX 1, an toàn thông tin 0,5, cố vấn y khoa 2). Hai luồng chạy song song và không rút người của nhau:

- **Luồng M0 (xây dựng):** frontend 2, backend 1, UX, PO; kiến trúc sư dành khoảng một phần ba thời gian.
- **Luồng kiểm chứng (PoC, T1–T10):** backend 1, DevOps/SRE, kiến trúc sư, an toàn thông tin, PO (phỏng vấn, pháp lý).

Như vậy năng lực xây dựng của M0 chỉ bằng khoảng một nửa đội đầy đủ; đây là giả định dùng ở mục 6.

M0 chia thành ba sprint hai tuần (M0-S1: 05–16/10, M0-S2: 19–30/10, M0-S3: 02–13/11), xem bảng từng tuần ở 5.5.

### 5.4 Tiêu chí "đi / không đi"

TL34 E.2 đã có 5 tiêu chí; tôi giữ nguyên chúng (T1–T5), làm cho T4 đo được, và bổ sung T6–T10 từ các phát hiện. **Ngưỡng bổ sung là đề xuất, cần nhà đầu tư chốt trước ngày bắt đầu (Q1).**

| # | Tiêu chí | Nguồn | Ngưỡng để "đi" | Cách đo |
|---|---|---|---|---|
| T1 | Gửi đơn lên sandbox cổng quốc gia, ký số từ xa | TL34 | PoC gửi được đơn hợp lệ, ký số thành công với ≥ 1 nhà cung cấp. **Bổ sung [Đề xuất]**: 100 đơn thử, ≥ 98% thành công, đơn lỗi luôn giữ lại và gửi lại được; ký 1 đơn p95 ≤ 5 s, ký lô 20 đơn ≤ 20 s | Kịch bản tự động trên sandbox; ≥ 2 nhà cung cấp ký số |
| T2 | Hiệu năng ở quy mô | TL34 | p95 patient-summary < 300 ms ở 500 tenant giả lập, 200 người dùng đồng thời. **Bổ sung [Đề xuất]**: dữ liệu 500 project × 5.000 bệnh nhân (≈ 25 GB); p95 tìm bệnh nhân ≤ 200 ms, mở hồ sơ ≤ 400 ms, lưu và in đơn ≤ 2 s; lỗi < 0,1%; chạy trên triển khai nhiều node của nhà cung cấp trong nước | k6; script ở `infra/medplum/experiments/` làm mẫu |
| T3 | Nâng cấp và khôi phục | TL34 | Nâng cấp một phiên bản minor ≤ 2 ngày công, không mất dữ liệu. **Bổ sung [Đề xuất]**: ngừng ≤ 15 phút; khôi phục về một thời điểm bất kỳ trong 24 giờ ≤ 60 phút, mất ≤ 15 phút dữ liệu (đúng cam kết của báo cáo) | Diễn tập, có biên bản |
| T4 | Năng lực làm chủ Medplum | TL34 | TL34: tự đánh giá ≥ 4/5. **Đề xuất làm cho đo được**: mỗi kỹ sư tự hoàn thành 3 việc có kiểm thử: AccessPolicy + test cách ly, Bot hoặc Subscription, `SearchParameter` + reindex | Báo cáo từng kỹ sư |
| T5 | Chi phí hạ tầng | TL34 | ≤ 25 triệu đ/tháng cho 300 tenant, **sau khi giải quyết mâu thuẫn 15/25/60 triệu (mục 3.3 dòng 2)** | Mô hình chi phí từ số đo T2 |
| T6 | Ngoại tuyến | Mới | 100 chu kỳ ngắt/khôi phục mạng ngẫu nhiên giữa buổi khám giả lập: 0 bản ghi mất, 0 trùng; đồng bộ 40 ca ≤ 60 s | Bộ kiểm thử tự động (Playwright, mạng tắt) |
| T7 | Rời tenant | Mới | Quy trình A4 chạy được: export có Binary, không lộ `secret`, nhật ký lưu ngoài, ảnh/PDF bị xóa thật | Kịch bản + kiểm bằng SQL và đĩa |
| T8 | Tìm kiếm tiếng Việt | Mới | Tìm theo 4 số cuối và theo tên không dấu đạt p95 ≤ 200 ms trên dữ liệu T2, kết quả đúng | Kiểm thử tự động |
| T9 | Thị trường | TL34 + báo cáo | 8–10 phỏng vấn (3 chuyên khoa, 2 thành phố), 4 buổi quan sát khám thực tế, **≥ 5 phòng mạch cam kết dùng thử bằng văn bản**, đo thời gian thao tác hiện tại làm mốc | Phiếu quan sát, thư cam kết |
| T10 | Pháp lý | TL34 | Có văn bản hoặc căn cứ rõ cho Q1–Q5 và Q8 của mục 3.4 | Thư của cơ quan hoặc ý kiến luật sư |

Quyết định: **Đi** khi T1–T8 đạt và T9–T10 đạt hoặc có kế hoạch khắc phục được nhà đầu tư chấp thuận.
Theo TL34, tiêu chí kỹ thuật nào không đạt mà không khắc phục được trong 2 tuần thì **chuyển sang phương án B (.NET + PostgreSQL)**, kèm ước lượng lại (Q2 mục 9).
T1, T9, T10 trượt là rủi ro thị trường/pháp lý chứ không phải của Medplum, và đổi phương án B không giải quyết được; khi đó là quyết định đầu tư.

Tiêu chí M0-1 đến M0-6 (mục 5.3) là điều kiện để cuộc họp 13/11 có một demo đáng tin; chúng không thay thế T1–T10.

### 5.5 Kế hoạch từng tuần (hợp nhất TL34 E.2, các phép thử mới và luồng M0)

"TL34 Qn" là câu hỏi mở của TL34 (mục 3.4); "Qn" là câu hỏi của mục 9.

| Tuần | Luồng kiểm chứng và nghiên cứu | Luồng M0 (xây dựng) | Bàn giao |
|---|---|---|---|
| 1 (05–09/10) | Khởi động; chốt T1–T10 và con số chi phí (Q1); xác nhận phạm vi M0 (Q14–Q16); gửi thư xin tài liệu API cổng đơn thuốc và sandbox (TL34 Q1); hỏi Cục QLKCB về độ trễ khi mất mạng và mã đơn cấp trước (TL34 Q4); xin tài khoản thử của 2–3 nhà cung cấp cloud và 2–3 nhà cung cấp ký số; lên lịch phỏng vấn, quan sát; T-SEC0 cho staging | **M0-S1 bắt đầu**: repo, CI, khung BFF và PWA, dữ liệu demo cho hai phòng khám (T-DEMO) | Thư đã gửi; tài khoản thử; staging 1; repo và CI chạy |
| 2 (12–16/10) | Phỏng vấn, quan sát; đọc toàn văn NĐ 90/2026 (TL34 Q2); PoC Medplum trên K8s nhà cung cấp A; bộ sinh dữ liệu 500 × 5.000 (kiểm tra từng phần tử, F5); thiết kế T-IDP; ADR | Tìm bệnh nhân theo số điện thoại, 4 số cuối, CCCD, tên không dấu (T-NAME); ghi idempotent (T-IDEM); nhật ký truy cập ở BFF (T-AUD); prototype giao diện thử với bác sĩ | Ghi chép quan sát; PoC v0; dữ liệu giả lập; tìm bệnh nhân chạy |
| 3 (19–23/10) | Hạn TL34 Q1, Q7, Q8; spike ngoại tuyến (T-OFF-0); quyết định T-NAME; tải vòng 1 (T2) trên nhà cung cấp A | **M0-S2 bắt đầu**: tiếp đón, hàng chờ, màn hình chờ; khám một trang; danh mục ICD-10 (T-CAT) | Số đo T2 vòng 1; luồng tiếp đón chạy |
| 4 (26–30/10) | Hạn TL34 Q3, Q4, Q6, Q9; spike bộ nối cổng (T1) và ký số nhà cung cấp 1; tải trên nhà cung cấp B; spike mã hóa cấp trường + chỉ số mù (A6); kiểm tra khối lượng nhật ký (A3) | Kê đơn: đơn mẫu, kê lại một nút, quy tắc trùng/dị ứng/số ngày (T-RULE); in A5 + QR (T-PRINT); cổng mô phỏng + hàng đợi gửi (T-SIM); đồng hồ phiên khám (T-TELE) | Số đo T1 sơ bộ; so sánh A/B; luồng khám → kê đơn → in chạy online |
| 5 (02–06/11) | Hạn TL34 Q5; ký số nhà cung cấp 2; diễn tập nâng cấp + PITR (T3); quy trình rời tenant (T7) | **M0-S3 bắt đầu**: ngoại tuyến (outbox, đồng bộ); màn hình nhật ký truy cập cho quản trị; **phiên thử với 3 bác sĩ** (đo M0-1) | Biên bản T3, T7; số đo M0-1; phản hồi giao diện |
| 6 (09–13/11) | Tổng hợp; mô hình chi phí (T5); báo cáo T4; hạn TL34 Q10; backlog M1, tuyển bổ sung; gói bằng chứng | Ngoại tuyến hoàn chỉnh theo phạm vi M0 (M0-2); kịch bản 10 phút; nhãn "mô phỏng"; bản dự phòng; diễn tập hai lần; **họp quyết định đi/không đi 13/11** | Gói bằng chứng; biên bản quyết định; ngân sách chốt lại (±30% → ±15%) |

Suốt giai đoạn: theo dõi văn bản pháp luật hàng tuần (rủi ro số một của cả hai tài liệu).

### 5.6 Trạng thái M0-S1 (cập nhật 02/10/2026)

M0-S1 (05–16/10) bắt đầu sớm hơn lịch vì đội đã sẵn sàng. Mã nằm ở `apps/`, `services/`, `packages/` (xem `README.md` gốc). Q14–Q16 chưa được trả lời riêng, nên đang áp dụng các mặc định đề xuất ở mục 5.2.

| Hạng mục kế hoạch (tuần 1–2) | Trạng thái | Bằng chứng |
|---|---|---|
| Repo, CI, khung BFF và PWA | Xong, trừ việc CI chưa chạy trên GitHub | Monorepo pnpm; `.github/workflows/ci.yml` có hai job (kiểu + đơn vị + build; tích hợp với Medplum thật). Đã mô phỏng lại các lệnh của CI cục bộ |
| Dữ liệu demo cho hai phòng khám (T-DEMO, một phần) | Xong | 2 phòng khám, mỗi phòng 900 bệnh nhân giả, bác sĩ là `Practitioner`; chạy lại không tạo trùng; có cả ca dùng cho kịch bản trình diễn ("Nguyễn Văn An" và "Nguyễn Văn Ân") |
| Tìm bệnh nhân theo số điện thoại, 4 số cuối, CCCD, tên không dấu (T-NAME) | Xong | 14 kiểm thử tích hợp trên Medplum thật; xem kết quả e2e bên dưới |
| Ghi lặp lại được (T-IDEM) | Xong | 6 yêu cầu đồng thời cùng `clientUuid` ra đúng 1 bệnh nhân, ổn định qua 9 lần chạy liên tiếp |
| Nhật ký truy cập ở BFF (T-AUD, mức M0) | Xong | Ghi trước khi trả dữ liệu (ghi lỗi thì không trả dữ liệu); không chứa nội dung tìm kiếm; chủ phòng khám xem được, vai trò khác bị từ chối và việc từ chối cũng được ghi |
| Prototype giao diện thử với bác sĩ | **Chưa**: cần người dùng thật | Giao diện tiếp đón đã chạy; phiên thử với bác sĩ là việc của tuần 5 (đo M0-1) |
| Danh mục ICD-10 và thuốc (T-CAT) | Chưa (M0-S2) | |

Kiểm thử đã chạy: 31 (mô hình) + 24 (BFF đơn vị) + 17 (web) kiểm thử đơn vị; 14 kiểm thử tích hợp với Medplum thật; 13 bước đầu-cuối trên Chromium thật, đạt 3 lần liên tiếp với mã cuối cùng.
Mọi con số trong bảng này chỉ nói về một máy dev, một người dùng.

Bài học từ M0-S1, đã đưa vào mã và kiểm thử:

1. **Kết quả tìm cũ phải bị vô hiệu hóa khi gõ truy vấn mới.** Bài e2e đầu tiên bắt được lỗi thật: gõ tên rồi bấm Enter ngay có thể mở nhầm hồ sơ của bệnh nhân ở lần tìm trước. Nay kết quả cũ mờ đi và không chọn được cho đến khi kết quả mới về. Bài kiểm tra đã được xác nhận thất bại khi gỡ bản sửa. Đây là loại lỗi an toàn bệnh nhân, nên mọi màn hình chọn bệnh nhân sau này (hàng chờ, khám) phải theo cùng quy tắc.
2. **Con trỏ chuột nằm yên không được giành mục đang chọn bằng bàn phím.** Trình duyệt vẫn phát sự kiện "enter" khi danh sách đổi dưới con trỏ; dùng `mousemove` thay cho `mouseenter`. Cũng có kiểm thử riêng và đã xác nhận thất bại khi gỡ bản sửa.
3. **Log không chứa dữ liệu cá nhân** (quy tắc "no PII in logs" của TL34 D.1): Fastify mặc định ghi cả chuỗi truy vấn (có số điện thoại, CCCD, tên), nên phải tự tắt; có kiểm thử khẳng định log và nhật ký không chứa nội dung truy vấn, token hay tên.
4. **Nhật ký truy cập fail-closed**: nếu không ghi được nhật ký thì yêu cầu lỗi và dữ liệu bệnh nhân không rời BFF (có kiểm thử). Hệ quả: đĩa nhật ký đầy sẽ làm cả phòng khám ngừng tra cứu; cần cảnh báo ở T-OBS và quyết định chấp nhận đánh đổi này.
5. **Nạp dữ liệu qua hạn mức mặc định** (≈ 500 lần ghi/phút): script seed tự chờ và gửi lại các phần tử bị từ chối (429); 1.000 lần ghi mất 2 phút 14 giây. Dùng lại được cho công cụ chuyển dữ liệu (T-MIG).
6. **Công cụ**: pnpm 12 coi script build của `esbuild` là lỗi cứng, phải khai báo `allowBuilds` trong `pnpm-workspace.yaml`; shim `corepack` của pnpm hỏng trong môi trường này nên cài pnpm trực tiếp.

Chế độ demo: BFF chưa có xác thực thật (T-IDP) nên chỉ khởi động khi đặt `DEMO_AUTH=1` và chỉ lắng nghe trên localhost; điều này giữ nguyên cho đến khi chốt Q7.

### 5.7 Trạng thái M0-S2 (cập nhật 02/10/2026)

M0-S2 (19–30/10) được làm trước lịch vì M0-S1 xong sớm. Bảng dưới là hạng mục của kế hoạch tuần 3–4 (mục 5.5) và bằng chứng. Mọi con số chỉ nói về một máy dev, dữ liệu giả, **chưa có bác sĩ thật dùng thử**.

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Hàng chờ, cấp số, ưu tiên người đã hẹn/cấp cứu, hủy lượt chờ | Xong | Số thứ tự không dùng bộ đếm chung: lấy số kế tiếp rồi tạo có điều kiện theo mã lượt khám, ba lễ tân cùng lúc không trùng số (kiểm thử tích hợp) |
| Màn hình chờ | Xong | Chỉ có số thứ tự và chữ cái đầu ("N.V.A"), không có họ tên; có kiểm thử ở BFF, tích hợp và e2e |
| Khám một trang: sinh hiệu, triệu chứng, chẩn đoán ICD-10 gõ tắt, dị ứng, tiền sử, lịch sử khám | Xong | Gõ `viem hong` ra J02.9 bằng bàn phím; dấu phẩy thập phân ("38,5"); nháp giữ qua tải lại trang |
| Danh mục ICD-10, thuốc, đơn mẫu (T-CAT) | Xong ở mức **minh họa** | 103 mã ICD-10, 101 thuốc, 13 đơn mẫu (10 nội, 3 nhi) tự soạn; **chưa duyệt y khoa, chưa phải danh mục chính thức**, nguồn và giấy phép vẫn là việc cần xác nhận (Q9). Nhãn rõ trong mã và trên giao diện |
| Quy tắc kê đơn (T-RULE) | Xong | Trùng hoạt chất (kể cả thuốc phối hợp), dị ứng theo nhóm hoặc hoạt chất, số ngày tối đa 30/90, thiếu liều, số lượng, chẩn đoán, CCCD, ngày sinh, cân nặng và dạng bào chế cho trẻ em. Ngưỡng nằm trong cấu hình, không lập trình cứng. Chạy ở trình duyệt để cảnh báo ngay và **chạy lại ở BFF khi ký** (không tin client) |
| "Kê lại" một nút | Xong | Sao chép thuốc, chẩn đoán, lời dặn từ lượt cũ; xác nhận cũ không mang sang; quy tắc chạy lại với dị ứng hiện tại |
| In A5 có mã QR (T-PRINT) | Xong | Xuất PDF từ Chromium: đúng 1 trang, khổ A5 (419,5 × 595,3 pt); mọi chuỗi từ dữ liệu được thoát ký tự và trang in mang CSP `default-src 'none'` |
| Ký số | **Mô phỏng** | Băm SHA-256 nội dung đơn lưu trong `Provenance.signature`, gắn nhãn "mô phỏng" ở mọi nơi hiển thị |
| Liên thông: hộp thư đi, trạng thái từng đơn, thử lại, màn hình "đơn chưa gửi" (T-SIM) | Xong, cổng **mô phỏng** | Đã ký → đang gửi → chờ gửi lại → đã gửi / lỗi; thử lại theo lũy thừa 2 có trần; quá số lần thì "lỗi" và gửi lại thủ công; cổng gửi idempotent theo mã đơn; trạng thái cổng tách riêng từng phòng khám |
| Đồng hồ phiên khám (T-TELE) | Xong phần đo | Máy chủ đo từ lúc mở hồ sơ đến lúc ký; p50/p90 theo bác sĩ so với 60/120 giây; phiên dài hơn 30 phút được đếm riêng, không giấu. **M0-1 chưa đo được** vì cần 3 bác sĩ thật |
| Trang "Phạm vi" (M0-5) | Xong | Liệt kê đã thật / mô phỏng / chưa làm, có kiểm tra trong e2e |
| Dữ liệu demo cho kịch bản | Xong | Seed thêm dị ứng, tiền sử và 4 lượt khám cũ có đơn; chạy lại không tạo trùng |
| Ngoại tuyến | Không thuộc M0-S2; xong ở M0-S3 | Mục 5.9 |

Kiểm thử đã chạy: 16 (danh mục) + 25 (quy tắc) + 34 (mô hình) + 30 (clinical) + 76 (BFF đơn vị) + 36 (web) kiểm thử đơn vị; 35 kiểm thử tích hợp với Medplum thật (gồm 21 mới về luồng khám); 13 + 21 bước đầu-cuối trên Chromium thật, cũng chạy được trên bản build production. Các kiểm thử an toàn quan trọng (phân quyền, quy tắc kê đơn ở server, thoát ký tự HTML) đã được xác nhận thất bại khi gỡ biện pháp tương ứng. CI có thêm job e2e (Chromium trên Medplum thật); cả ba job (kiểu + đơn vị + build, tích hợp, e2e) đã đạt trên GitHub ở commit `7a8c626`. Lần đầu job tích hợp đỏ vì một bài thử lại dựa vào thời gian thật (hạn 40 ms) trên runner chậm và để cổng mô phỏng ở trạng thái lỗi cho các bài sau; đã đổi sang thời gian ảo và đặt lại cổng trước mỗi bài.

Bài học từ M0-S2:

1. **Medplum không hoàn tác `transaction` (F11).** Phát hiện khi kiểm tra `If-Match`: lần ghi bị 412 vẫn để lại các bản ghi khác. Thiết kế "đóng lượt khám + đơn + outbox trong một giao dịch" phải đổi thành gói chạy lại được với điểm chốt đứng cuối (xem A2). Có kiểm thử tích hợp tạo đúng tình huống này (chèn một lần sửa vào giữa), xác nhận đơn **không** được gửi khi lượt khám chưa đóng, rồi chạy lại cùng `clientUuid` hội tụ không trùng. **Bổ sung 04/10/2026:** "điểm chốt đứng cuối" trong cùng một gói hóa ra không đủ. Khi một mục trước nó bị 409 vì xung đột giao dịch, Medplum vẫn chạy mục đóng lượt khám, và lượt khám đã đóng mà thiếu bản ghi (mục 5.9, "Ghi cùng lúc"). Bài kiểm thử ở đây chỉ chèn lỗi vào chính mục đóng nên không thấy.
2. **Thiếu ngày sinh làm quy tắc theo tuổi im lặng bỏ qua** (trẻ em, CCCD). Đã thêm quy tắc "chưa có ngày sinh" buộc bác sĩ xác nhận, và cho phụ tá bổ sung CCCD và ngày sinh ngay ở màn hình tiếp đón.
3. **Chạy lại sau khi đã ký không được bị quy tắc từ chối.** Nếu phụ tá thêm dị ứng sau khi đơn đã ký, bấm lại "Ký" (mất mạng, bấm đúp) phải trả lại đơn cũ chứ không báo lỗi quy tắc. Có kiểm thử.
4. **Dữ liệu thăm dò làm bẩn dữ liệu demo**: các lần thử ban đầu tạo lượt khám số 7xx–9xx trong phòng khám demo làm sai số thứ tự và lịch sử. Đã dọn; bài e2e nay tự dọn hàng chờ ở đầu và cuối để chạy lại được kể cả sau lần hỏng.
5. **Giới hạn đã biết, cần quyết định cho M1**: (a) hộp thư đi hỏi Medplum theo chu kỳ, mỗi phòng khám mỗi lần 20 điểm hạn mức; đủ cho M0, nhưng 300 phòng khám mỗi 2 giây là 3.000 lần tìm mỗi phút nên M1 phải chuyển sang Subscription hoặc hàng đợi; (b) bản nháp lượt khám tạm lưu ở `sessionStorage` (có dữ liệu lâm sàng, xóa khi đăng xuất, chưa mã hóa), M0-S3 chuyển sang kho cục bộ có mã hóa cùng với ngoại tuyến (đã làm ở lát 2, mục 5.9); (c) màn hình chờ dùng chung phiên của máy lễ tân, M1 cần thiết bị màn hình có mã ghép riêng; (d) mã đơn nội bộ (`PM-YYMMDD-XXXXXX`, sinh xác định từ `clientUuid`) là giả định tạm cho đến khi có tài liệu cổng (TL34 Q1); (e) giới hạn 30/90 ngày và danh sách bệnh mạn tính là dữ liệu minh họa, cần cố vấn y khoa và pháp chế xác nhận trước M1.

### 5.8 Bàn giao sang M0-S3: ngoại tuyến (02/10/2026)

Mục này viết cho người (hoặc phiên làm việc) tiếp nhận M0-S3 mà không có ngữ cảnh của M0-S1/S2. Đọc cùng mục 5.2 (dòng "Ngoại tuyến"), tiêu chí M0-2 ở mục 5.3, và công việc T-OFF ở mục 8.

**Dựng môi trường** (trên máy dev hoặc sandbox mới): `infra/dev-up.sh` cài pnpm nếu thiếu, bật dockerd nếu cần, dựng Medplum, nạp dữ liệu demo lần đầu rồi chạy BFF và giao diện (`--stop` để dừng, log ở `/tmp/phongmach-dev/`). Sau đó `pnpm e2e` chạy hai bài Chromium (13 + 21 bước); `pnpm test` và `pnpm --filter @phongmach/bff test:integration` chạy kiểm thử đơn vị và tích hợp. Nhánh: PR #1 vẫn là bản nháp và chưa merge, nên tạo nhánh M0-S3 từ `claude/beautiful-bardeen-ac5u1c` (hoặc từ `main` sau khi merge PR #1). Người dùng demo và kịch bản đi qua màn hình nằm ở `README.md`.

**Phạm vi M0-S3 theo kế hoạch.** Tiếp đón, khám, kê đơn, in khi mất mạng; đồng bộ khi có mạng; 0 mất, 0 trùng; ngắt mạng ngay trên sân khấu (M0-2: 20 chu kỳ ngắt/khôi phục, kiểm thử tự động). Ngoài phạm vi M0: chờ ký và gửi ở mức đầy đủ, xung đột sửa đồng thời, cache toàn bộ 20.000 bệnh nhân.

**Đã có, dùng lại được:**

- Mọi lần ghi của ứng dụng đã idempotent theo `clientUuid` do client sinh: tạo bệnh nhân, cấp số, dị ứng, tiền sử, hoàn tất lượt khám. Gửi lại cùng UUID là an toàn và trả kết quả cũ (HTTP 200, `replayed`). Hàng đợi đồng bộ chỉ cần giữ UUID và gửi lại cho tới khi nhận 2xx.
- Gói hoàn tất lượt khám chạy lại được (F11). Khi ghi dở BFF trả 503 `incomplete` kèm "bấm lại"; gửi lại cùng UUID thì hội tụ. Mã đơn nội bộ sinh xác định từ `clientUuid`.
- Quy tắc kê đơn, danh mục, đơn mẫu và tìm tên không dấu (`foldName`) đã chạy ở trình duyệt. Bản nháp lượt khám đã có `clientUuid` ngay lúc mở (`apps/clinic-web/src/visit/draft.ts`).
- Service worker chỉ lưu vỏ ứng dụng, **không** lưu `/api` (có dữ liệu bệnh nhân); giữ nguyên nguyên tắc này.

**Khoảng trống phải thiết kế (chưa có, không tự có):**

1. **In khi mất mạng.** Trang in A5 do BFF dựng phía máy chủ (`services/bff/src/print.ts`), nên ngoại tuyến không in được. Cần chuyển mẫu in sang gói dùng chung, sinh QR ở trình duyệt, và in từ dữ liệu cục bộ. Mã đơn lấy ngày theo giờ máy chủ; ngoại tuyến phải dùng giờ máy khách và quyết định cách chịu đồng hồ lệch.
2. **Số thứ tự hàng chờ do máy chủ cấp** (lấy số lớn nhất rồi tạo có điều kiện). Ngoại tuyến không có số: chọn giữa số tạm cục bộ được gán số thật khi đồng bộ, hay chỉ cho khám người đã có số. Màn hình chờ cũng phụ thuộc quyết định này.
3. **Đồng hồ phiên khám (T-TELE) dùng giờ máy chủ** cho cả lúc mở hồ sơ và lúc ký. Đồng bộ trễ làm số đo sai (kéo p50/p90 lên). Cần gửi thời điểm ký của client (kèm giới hạn hợp lý) hoặc đo ở client và để máy chủ kiểm tra.
4. **Tìm bệnh nhân ngoại tuyến.** Phạm vi M0: chỉ người đang trong hàng chờ hôm nay và người vừa mở. Cần kho cục bộ có chỉ mục không dấu.
5. **Kho cục bộ có mã hóa.** Hiện bản nháp ở `sessionStorage`, không mã hóa. Cần IndexedDB (Dexie theo mục 5.2) với WebCrypto (AES-GCM). Phải quyết định khóa lấy từ đâu khi chưa có xác thực thật (T-IDP), xóa khi đăng xuất, và dùng chung máy giữa nhiều người.
6. **Phiên đăng nhập.** Token hết hạn sau 480 phút và không gia hạn được khi mất mạng. Hàng đợi chờ đồng bộ phải sống sót qua mất mạng dài, kể cả khi token đã hết hạn lúc có mạng lại.
7. **Quyền khi đồng bộ.** BFF chỉ cho người đã mở lượt khám hoàn tất nó (so `participant.individual.identifier`); yêu cầu đồng bộ phải mang đúng danh tính lúc ký. Trường hợp lượt khám bị người khác đụng vào trong lúc ngoại tuyến thuộc "xung đột sửa đồng thời", ngoài phạm vi M0 nhưng phải được phát hiện và báo, không âm thầm ghi đè.

**Cách đo M0-2 (đề xuất).** Playwright `context.setOffline(true/false)`, 20 chu kỳ ngắt/khôi phục ngẫu nhiên giữa lúc cấp số, khám và ký. Đếm bản ghi trong Medplum bằng tài khoản máy của phòng khám thử, theo mẫu hàm `count` ở `services/bff/test/integration/clinical.test.ts`: mỗi hành động có đúng một bản ghi (0 mất, 0 trùng). Bài này nên nằm trong job e2e của CI.

**Bẫy đã gặp, đừng lặp lại:**

- **F11:** `transaction` của Medplum không nguyên tử; luôn kiểm tra từng mục bằng `failedEntries`; không dựa vào `If-Match` trong gói; `PUT` với id tự chọn trả 404 (dùng `ifNoneExist`).
- **F12: không gọi `print()` khi còn yêu cầu IndexedDB đang dở.** Mọi lần in đi qua `printHtml`, hàm này chờ kho yên (`whileLocalStoreQuiet`). Đừng gọi `window.print()` thẳng. Bài `e2e:offline` đếm yêu cầu IndexedDB đang dở lúc gọi `print()`; bỏ hàng rào thì bài này đỏ (2/2 lần), còn các bước khác vẫn có thể xanh vì việc mất sự kiện tùy thời điểm.
- **Không dùng `page.waitForFunction` với hàm `async` trong bài e2e**: Playwright coi lời hứa trả về là "đúng" và xong ngay, nên bước chờ đó không chờ gì cả [Đã đo, playwright-core 1.63]. Thăm dò bằng `eventually(() => page.evaluate(async () => …))`. Bài e2e chỉ xanh trên bản dev mà đỏ trên bản build thường là dấu hiệu của một bước chờ như vậy (bản build nhanh hơn).
- **Hạn mức đăng nhập 5 lần/phút theo IP (F5).** Mỗi file kiểm thử tích hợp đăng nhập quản trị một lần, nên chạy bộ tích hợp ba lần liền sẽ gặp 429 ở khâu dựng dữ liệu; đó không phải lỗi mã. Thêm file kiểm thử mới thì tính lại. Nếu gặp, chờ một phút.
- **Kiểm thử hẹn giờ phải dùng thời gian ảo, không `sleep`**: CI chậm hơn máy dev (một bài thử lại hạn 40 ms đã làm đỏ CI). Bài hỏng giữa chừng không được để lại trạng thái chung cho các bài sau (đặt lại trong `beforeEach`).
- **Không thăm dò trên phòng khám demo**: các lần thử ban đầu đã làm sai số thứ tự và lịch sử. Tạo phòng khám tạm như các kiểm thử tích hợp (`createTenantProject`). Bài e2e `visit.mjs` tự dọn hàng chờ ở đầu và cuối để chạy lại được kể cả sau lần hỏng.
- **Không dùng `pkill -f` theo mẫu chữ** (đã từng giết chính shell đang chạy lệnh); `infra/dev-up.sh` dùng file PID và nhóm tiến trình. Tiến trình nền phải bỏ stdout của lệnh gọi, nếu không nó giữ đầu ống và lệnh không bao giờ kết thúc.
- **Quy tắc đã thành nếp, giữ cho mọi tính năng mới**: log không chứa chuỗi truy vấn; nhật ký truy cập không chứa dữ liệu bệnh nhân; ghi nhật ký trước khi trả dữ liệu; tenant lấy từ phiên, không từ tham số; mọi phần mô phỏng có nhãn. Kiểm thử an toàn phải được xác nhận **thất bại khi gỡ biện pháp** tương ứng.
- **Khi xong M0-S3, cập nhật chỗ nói "ngoại tuyến chưa có"**: `components/Scope.tsx`, `components/DemoBanner.tsx`, `README.md` (mục "Giới hạn"), mục 5.2 và 5.7 của kế hoạch, và bước kiểm tra trang Phạm vi trong `e2e/visit.mjs`. (Đã làm ở lát 6, 03/10/2026: mục 5.9.)

#### Thiết kế ngoại tuyến M0-S3 [Đã duyệt 02/10/2026] (02/10/2026)

Điểm xuất phát đã chạy lại trên sandbox mới bằng `infra/dev-up.sh`: kiểu đạt, 217 kiểm thử đơn vị, 35 tích hợp, e2e 13 + 21 bước, tất cả xanh. Đã thử nhanh (không phải mã sản phẩm) trên Chromium: `context.setOffline` phát sự kiện `offline`/`online` và làm `fetch` lỗi; `route.fetch()` rồi `route.abort()` tạo được ca "máy chủ đã ghi (HTTP 200) nhưng trình duyệt thấy lỗi mạng"; WebCrypto và Web Locks có trên `127.0.0.1`. Chủ dự án đã duyệt thiết kế ngày 02/10/2026: không dùng mã PIN ở M0, chấp nhận giới hạn N5 (đoạn ngắt mạng khi trình diễn làm trên một máy).

**Nguyên tắc chung (N1–N5)**

- **N1. Lưu bền trước, gửi sau.** Thao tác ghi được phép khi mất mạng đi qua một hàng đợi cục bộ (IndexedDB, mã hóa): ghi mục vào hàng đợi cùng dữ liệu hiển thị trong một giao dịch, rồi mới gửi. Có mạng thì gửi ngay, nên đường ngoại tuyến cũng là đường trực tuyến và được dùng hằng ngày, không chỉ khi mất mạng. **Không in khi chưa lưu bền**: ghi cục bộ lỗi (đầy bộ nhớ) thì báo lỗi và không in.
- **N2. Một thao tác, một `clientUuid`**, sinh một lần và giữ qua mọi lần gửi lại, tải lại trang, hết phiên. Máy chủ đã idempotent theo UUID (mục này, "Đã có"), nên "0 trùng" dựa vào cơ chế đã có kiểm thử; hàng đợi lo phần "0 mất".
- **N3. Không âm thầm.** Mỗi mục có trạng thái: chờ, đang gửi, thử lại (lỗi tạm), cần xử lý (xung đột, quy tắc, lỗi dữ liệu), xong. Mục "cần xử lý" không tự bỏ, không tự ghi đè, luôn hiện cho tới khi người dùng xử lý.
- **N4. Phạm vi ngoại tuyến:** tìm (trong dữ liệu trên máy), tạo bệnh nhân, cấp số, gọi vào khám, khám, ký hoặc kết thúc khám, in, in lại. Các thao tác khác (hủy lượt, dị ứng/tiền sử, bổ sung CCCD, liên thông, số đo, nhật ký) bị khóa khi mất mạng, có ghi "cần mạng".
- **N5. Ngoại tuyến là của từng máy.** Mọi đồng bộ đi qua BFF; khi Internet của phòng khám mất, các máy không thấy nhau. Người được cấp số ngoại tuyến ở máy lễ tân chỉ hiện ở máy bác sĩ khi một trong hai máy có mạng lại (câu hỏi 2 bên dưới).

**OFF-1. In khi mất mạng.** *Quyết định:* tách mẫu đơn A5 ra gói `@phongmach/print` (hàm thuần: dữ liệu → HTML, QR dạng SVG bằng `qrcode`, chạy được cả Node và trình duyệt, giữ nguyên thoát ký tự và CSP `default-src 'none'`). BFF `/print` dùng chính gói này cho in lại khi có mạng (giữ dòng nhật ký `prescription-print`). Ký khi mất mạng thì trình duyệt dựng trang in từ dữ liệu cục bộ: thuốc và chẩn đoán từ danh mục đã đóng gói, bệnh nhân từ bộ đệm, tên phòng khám và bác sĩ từ phiên. Mã đơn sinh ở máy khách bằng cùng `makePrescriptionCode`: ngày theo **giờ ký của máy khách**, 6 ký tự từ SHA-256(`clientUuid`) (WebCrypto). Máy chủ tính lại theo `signedAt` của máy khách nên mã trên giấy trùng mã lưu trên máy chủ. Trang in ngoại tuyến thêm nhãn "Ký khi mất mạng, chưa đồng bộ, chưa liên thông". Mỗi lần in ngoại tuyến thành một mục hàng đợi ghi nhật ký `prescription-print` khi có mạng.

*Lý do:* một mẫu duy nhất nên bản in trực tuyến và ngoại tuyến giống nhau, một bài kiểm tra PDF A5 dùng cho cả hai; mã đơn xác định nên không cần chờ máy chủ.

*Rủi ro:* đồng hồ máy khách sai thì ngày trên mã và trên giấy sai theo (máy chủ lưu đúng cái đã in và gắn cờ, xem OFF-3); giá trị pháp lý của đơn in khi chưa liên thông vẫn là Q3 (trang in ghi rõ mô phỏng); bundle lớn thêm phần `qrcode`: 312 → 343 KB, nén 96,7 → 109,3 KB [Đã đo, bản build lát 1]; dòng nhật ký in có thể bị ghi hai lần nếu mất phản hồi (nhật ký chỉ ghi thêm; chấp nhận và ghi chú).

*Loại:* in thẳng trang ứng dụng (không kiểm soát được khổ A5, lộ giao diện); lưu sẵn HTML do BFF dựng (không có khi ký lúc mất mạng); sinh PDF ở trình duyệt (thư viện lớn, không cần).

**OFF-2. Số thứ tự khi ngoại tuyến.** *Quyết định:* máy khách cấp **số tạm** = số lớn nhất nó biết trong ngày (hàng chờ đã lưu và số tạm đã cấp) + 1, hiện "007 (tạm)" ở hàng chờ và màn hình chờ của máy đó. Khi đồng bộ, yêu cầu cấp số mang `proposedNumber` và `arrivedAt` (giờ máy khách); máy chủ **thử giữ đúng số tạm** bằng tạo có điều kiện theo mã lượt khám (cơ chế chống trùng số đang có), số đã bị lấy thì cấp số kế tiếp như hiện nay và giao diện báo rõ "Số 007 (cấp khi mất mạng) đã đổi thành 009". Ngày của lượt khám lấy theo `arrivedAt` (đồng bộ sang hôm sau không đẩy bệnh nhân sang hàng chờ hôm sau); `arrivedAt` ở tương lai thì dùng giờ máy chủ.

*Phản biện gợi ý:* giữ "số tạm, máy chủ gán số thật", chỉ thêm "máy chủ ưu tiên giữ số tạm". Phòng mạch một quầy tiếp đón (trường hợp phổ biến) thì số không bao giờ đổi, bệnh nhân không bị gọi bằng số khác số đã được báo.

*Rủi ro:* hai máy cùng cấp số khi mất mạng sẽ trùng số tạm; máy đồng bộ sau bị đổi số (có thông báo). Trên máy chủ không bao giờ trùng số.

*Loại:* số dạng "T1" (luôn đổi, thứ tự gọi phải xử lý riêng); chỉ khám người đã có số (không đạt "tiếp đón khi mất mạng"); dải số riêng cho từng máy (số nhảy cóc, thêm cấu hình).

**OFF-3. Đồng hồ phiên khám.** *Quyết định:* máy khách luôn ghi `openedAt` theo đồng hồ của chính nó (mở có mạng thì lấy lúc nhận phản hồi), lưu cùng bản nháp. Mở hồ sơ khi mất mạng thì yêu cầu mở mang `openedAt`; mở hoặc ký khi mất mạng thì yêu cầu hoàn tất mang `clientTimes: { openedAt, signedAt }`. Máy chủ:

- không có `clientTimes` thì đo như hiện nay (nguồn `server`);
- có thì thời lượng = `signedAt − openedAt` (cùng một đồng hồ nên độ lệch giờ triệt tiêu), nguồn `client`, kiểm tra: không âm, không vượt trần, `signedAt` không quá giờ máy chủ + 5 phút, và nếu máy chủ đã thấy lúc mở thật thì không dài hơn (giờ nhận − lúc mở) + 5 phút.

Không hợp lý thì **vẫn lưu lượt khám**, không tính vào p50/p90, đếm riêng như phiên quá 30 phút. Giờ ký trên đơn, `authoredOn`, giờ kết thúc lượt khám lấy theo `signedAt` của máy khách (đúng với cái đã in và đã băm ký); giờ máy chủ nhận vẫn có ở `meta.lastUpdated`. Trang "Thời gian khám" ghi số lượt đo ở máy khách và số lượt bị loại vì giờ không hợp lý.

*Rủi ro:* máy khách có thể khai giờ ký lùi (vấn đề pháp lý khi có ký số và xác thực thật, ghi vào T-SIGN, Q3); không phát hiện được việc khai thời lượng ngắn hơn thực tế.

*Loại:* dùng giờ máy chủ lúc đồng bộ (thời lượng gần 0 hoặc dài bằng cả lúc mất mạng); từ chối yêu cầu có giờ không hợp lý (mất bản ghi đã ký và đã in).

**OFF-4. Tìm bệnh nhân ngoại tuyến.** *Quyết định:* bộ đệm cục bộ chỉ chứa (a) người trong hàng chờ hôm nay, (b) hồ sơ đã mở trong ngày (Tiếp đón, Khám), (c) bệnh nhân tạo trên máy này. Không lưu kết quả tìm kiếm chưa mở. Khi có mạng, ứng dụng nạp trước tóm tắt và **dị ứng** của người mới vào hàng chờ qua điểm cuối gộp mới `GET /api/queue/prefetch` (một dòng nhật ký `queue-prefetch` kèm danh sách id). Điểm cuối này mở cho mọi vai trò, vì phụ tá cần số điện thoại để tìm khi mất mạng và mọi vai trò vốn đã xem được dị ứng. Nó chỉ trả người đang chờ hoặc đang khám hôm nay, kể cả khi hỏi đích danh người khác. Tìm ngoại tuyến giải mã bộ đệm (vài trăm người là cùng) vào bộ nhớ rồi lọc bằng `classifyQuery` + `foldName`: tên không dấu theo tiền tố từng từ, số điện thoại, 4 số cuối. **Không có chỉ mục tên dạng rõ trên đĩa.** CCCD không tìm được ngoại tuyến (máy khách chỉ có CCCD đã che), trừ bệnh nhân tạo trên máy này. Bộ đệm ngày cũ bị dọn khi mở ứng dụng. Ô tìm ghi "Mất mạng: chỉ tìm trong N hồ sơ trên máy này" và giữ quy tắc kết quả cũ bị mờ (bài học 1 của M0-S1).

*An toàn:* mở hồ sơ ngoại tuyến của người **chưa có dữ liệu dị ứng trên máy** sinh phát hiện mới `allergy-unknown`, mức "xác nhận kèm lý do" như `no-birthdate`: bác sĩ phải hỏi bệnh nhân rồi xác nhận mới ký được; yêu cầu hoàn tất báo cờ này để máy chủ lưu xác nhận cùng đơn. Máy chủ chạy lại quy tắc với dị ứng thật khi đồng bộ (OFF-7).

*Rủi ro:* dị ứng nạp trước có thể đã cũ (phụ tá ghi thêm sau đó), máy chủ bắt lại khi đồng bộ; nhật ký nhiều dòng hơn.

*Loại:* lưu toàn bộ bệnh nhân (ngoài phạm vi, lộ nhiều dữ liệu); chỉ mục không dấu dạng rõ trong IndexedDB (lộ tên ra đĩa).

**OFF-5. Kho cục bộ có mã hóa.** *Quyết định:* IndexedDB qua Dexie, một CSDL cho mỗi (phòng khám, người dùng). Mọi bản ghi có dữ liệu bệnh nhân lưu dạng `{iv, ciphertext}` AES-GCM 256 bit, IV 96 bit ngẫu nhiên mỗi lần ghi, dữ liệu kèm (AAD) là tên bảng + id để không tráo được bản ghi giữa các chỗ. Khóa là `CryptoKey` sinh bằng WebCrypto lúc đăng nhập, `extractable: false`, lưu trong chính CSDL đó. Trường dạng rõ chỉ gồm id, trạng thái, thời điểm, loại thao tác (không tên, chẩn đoán, thuốc). Kho này thay `sessionStorage` của bản nháp. Đăng xuất xóa cả CSDL lẫn khóa **nếu không còn mục chờ đồng bộ** (còn thì xem OFF-6). Gọi `navigator.storage.persist()` để giảm khả năng trình duyệt tự dọn; dùng Web Locks để chỉ một tab gửi đồng bộ. Trình duyệt không có IndexedDB hoặc WebCrypto thì ứng dụng chạy như hiện nay (chỉ trực tuyến) và ghi rõ.

*Giới hạn bảo vệ khi chưa có xác thực thật (T-IDP), nói thẳng:* khóa nằm cùng máy với dữ liệu.

- Ai mở được trình duyệt đó (cùng tài khoản hệ điều hành, phiên còn hạn) là xem được, vì ứng dụng tự giải mã.
- Ai lấy được ổ đĩa thì lấy được cả khóa từ tệp của trình duyệt: `extractable: false` chỉ chặn JavaScript xuất khóa, không chặn đọc đĩa [Phân tích].
- Mã độc hoặc XSS trên cùng origin dùng được khóa.

Ở M0, mã hóa chỉ chống việc xem lướt (DevTools, chép tệp IndexedDB rồi tìm chữ) và làm dữ liệu sót trên đĩa sau khi xóa trở nên vô dụng, mà điều này cũng chỉ một phần vì khóa cũng có thể sót. Nó **không** thay cho khóa màn hình, mã hóa ổ đĩa của hệ điều hành và xác thực thật.

*Nếu thêm mã PIN* (câu hỏi 1): khóa dữ liệu được bọc bằng khóa dẫn xuất từ PIN (PBKDF2, ít nhất 600.000 vòng), chỉ nằm trong bộ nhớ khi đã mở khóa, tự khóa sau N phút không thao tác. Thêm được: người khác ngồi vào máy đang mở không xem được; lấy ổ đĩa phải dò PIN (PIN 6 số dò ngoại tuyến được trong vài phút trên GPU [Phân tích], nên chỉ là vật cản). Cái giá: thêm một bước mỗi lần tải lại hoặc bị khóa; **quên PIN khi còn mục chưa đồng bộ là mất các mục đó** (không có cách khôi phục nếu không giữ khóa ở máy chủ). Khuyến nghị: **không thêm PIN ở M0**; định dạng lưu cho phép M1 bọc khóa bằng PIN hoặc bằng khóa do IdP cấp (T-IDP) mà không đổi cách lưu dữ liệu.

*Loại:* `localStorage`/`sessionStorage` (không mã hóa, dung lượng nhỏ); khóa dẫn xuất từ token phiên (token đổi mỗi lần đăng nhập và hết hạn, hàng đợi sẽ không giải mã được nữa, tức là mất dữ liệu).

**OFF-6. Phiên đăng nhập hết hạn.** *Quyết định:* hàng đợi gắn với người tạo (phòng khám + id người dùng), không gắn với token. Mất mạng thì không gửi gì, nên token hết hạn trong lúc đó không ảnh hưởng. Có mạng lại mà token đã hết hạn thì BFF trả 401 và ứng dụng **tạm dừng đồng bộ** (không xóa, không bỏ mục nào), hiện "Phiên đã hết hạn: đăng nhập lại để đồng bộ N mục". Màn hình đăng nhập ghi "máy này còn N mục chưa đồng bộ của BS. A"; số đếm và tên nhân viên lưu dạng rõ (không phải dữ liệu bệnh nhân). Đăng nhập lại đúng người thì đồng bộ tiếp. Đăng xuất khi còn mục chờ thì hỏi "Chờ đồng bộ" hoặc "Đăng xuất, giữ dữ liệu đã mã hóa trên máy để đồng bộ lần đăng nhập sau"; **ở M0 không có nút hủy dữ liệu chưa đồng bộ**. Không tự gia hạn token ở M0 (T-IDP sẽ thay cơ chế phiên).

*Rủi ro:* đóng tab khi đang mất mạng làm mất token (`sessionStorage`), phải chờ có mạng để đăng nhập lại mới làm tiếp; dữ liệu không mất. Mục chờ của người nghỉ việc nằm lại trên máy: M1 cần quy trình quản trị.

*Loại:* token lâu dài trong `localStorage` (lộ token, vẫn hết hạn); cho người đang đăng nhập gửi hộ mục của người khác (sai người ký, BFF từ chối hoặc ghi sai danh tính).

**OFF-7. Quyền và xung đột khi đồng bộ.** *Quyết định:* mỗi mục chỉ được gửi bằng phiên của chính người tạo (máy khách: CSDL theo người dùng; BFF: giữ nguyên kiểm tra người đã mở lượt khám, không nới). Gửi theo thứ tự phụ thuộc: tạo bệnh nhân → cấp số → mở hồ sơ → hoàn tất → ghi nhận in. Id cục bộ được thay bằng id máy chủ ngay trước khi gửi, bảng ánh xạ lưu bền. Phân loại phản hồi:

- lỗi mạng, 5xx, 503 `incomplete`, 429: gửi lại cùng `clientUuid`, chờ theo lũy thừa 2 có trần, gửi ngay khi có sự kiện `online` (F11 hội tụ nhờ gói chạy lại được);
- 401: tạm dừng (OFF-6);
- 409 `taken`, `closed`, `already-closed`, `not-open`: **xung đột**. Không gửi lại, không ghi đè; giữ bản khám cục bộ (in lại được) và báo "Lượt khám 005 đã do BS. B mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống". Giải quyết xung đột (gộp, tách thành lượt khám riêng) ngoài phạm vi M0;
- 422 `rules-not-satisfied` (ví dụ phụ tá vừa ghi dị ứng mới ở máy khác): **cần bác sĩ xử lý**. Danh sách chờ đồng bộ hiện phát hiện của máy chủ; bác sĩ nhập lý do xác nhận rồi gửi lại cùng `clientUuid`. Đơn đã in, nên điều quan trọng là bác sĩ biết để liên hệ bệnh nhân. Đây là lần đầu có tình huống "đã in đơn rồi mới thấy cảnh báo", cần cố vấn y khoa duyệt trước M1;
- 400, 403, 404, 422 khác: cần xử lý, hiện nguyên thông điệp.

Mục phụ thuộc vào một mục "cần xử lý" được giữ lại ("chờ mục trước"); các chuỗi khác vẫn chạy.

*Rủi ro:* bác sĩ bỏ qua mục 422 thì bản ghi không lên máy chủ; giảm bằng huy hiệu luôn hiện và không cho đăng xuất xóa dữ liệu.

*Loại:* "người gửi sau thắng" (âm thầm ghi đè); máy chủ tự nhận đơn vi phạm quy tắc (không ai biết có dị ứng mới).

**Thay đổi ở BFF** (mọi trường mới đều tùy chọn, không trường nào nới quyền; giữ `failedEntries`, tenant từ phiên, nhật ký không có dữ liệu bệnh nhân, ghi nhật ký trước khi trả dữ liệu): `POST /api/queue` thêm `arrivedAt`, `proposedNumber`; `POST /api/visits/:id/open` thêm `openedAt`; `POST /api/visits/:id/complete` thêm `clientTimes` và cờ `allergiesUnknown`, mã đơn theo ngày của `signedAt`; mới `GET /api/queue/prefetch` (mọi vai trò, chỉ người trong hàng chờ hôm nay); mới `POST /api/prescriptions/:id/printed` (ghi nhật ký lần in ngoại tuyến); số đo tách nguồn `server`/`client`/`client-invalid`; dòng nhật ký của thao tác làm lúc mất mạng có `queryKind: 'offline'` và `clientTs` (giờ máy khách khai).

**Cách đo M0-2 (chi tiết hóa đoạn "Cách đo" ở trên).**

- Bài `e2e/offline.mjs` tạo một phòng khám thử mới mỗi lần chạy (`createTenantProject` qua một script của BFF), chạy một BFF riêng (cổng 8111, tệp phòng khám tạm) và bản build giao diện riêng (cổng 4174) nên không đụng phòng khám demo.
- 20 chu kỳ, mỗi chu kỳ một bệnh nhân mới đi hết đường: tạo → cấp số → gọi vào khám → khám → ký & in. Bộ sinh ngẫu nhiên có hạt giống (in ra để chạy lại đúng như cũ) chọn lúc ngắt và lúc bật lại mạng, cộng hai kiểu lỗi khó hơn `setOffline`: **mất phản hồi** (`route.fetch()` rồi `route.abort()`, đã thử được) và **tải lại trang khi đang mất mạng** (vỏ ứng dụng từ service worker, chỉ có ở bản build).
- Chờ theo điều kiện (danh sách chờ đồng bộ về 0), không ngủ cố định. Cuối bài đếm bằng tài khoản máy của phòng khám thử: Patient = Encounter = List = Task = Provenance = 20, Encounter đều `finished`; MedicationRequest, Condition, Observation đúng bằng số đã nhập; mỗi bệnh nhân đúng 1 lượt khám; 20 số thứ tự khác nhau; mỗi mã đơn đã in có đúng một đơn trên máy chủ; không còn mục chờ hay xung đột trên máy.
- Đột biến thử, mỗi cái phải làm một bài đỏ: (a) sinh `clientUuid` mới khi gửi lại (trùng); (b) bỏ mục khi gặp lỗi mạng (thiếu); (c) gửi mục của người khác bằng phiên hiện tại; (d) ghi dạng rõ vào IndexedDB (bài "kho không chứa tên bệnh nhân"); (e) gỡ quy tắc `allergy-unknown`; (f) xung đột 409 bị ghi đè hoặc bị bỏ âm thầm.
- Bài này chạy trong job e2e của CI (thêm vài phút [Chưa đo]; lát 5 đã đo: thêm khoảng 1 phút, xem "Lát 5 xong").

**Lát cắt sau khi duyệt:** (1) gói in dùng chung, in từ dữ liệu cục bộ; (2) kho cục bộ có mã hóa thay `sessionStorage`; (3a) BFF: giờ máy khách, số tạm, nạp trước, ghi nhận in, kèm kiểm thử tích hợp; (3b) hàng đợi đồng bộ và luồng ngoại tuyến ở giao diện; (4) chỉ báo trực tuyến/ngoại tuyến, danh sách chờ đồng bộ, thông báo lỗi và xung đột; (5) bài e2e 20 chu kỳ và CI; (6) tài liệu, mục 5.9. Mỗi lát một commit, xanh trước khi sang lát sau.

**Tiến độ.** Lát 1 xong:
- Gói `@phongmach/print` dùng chung cho BFF và trình duyệt. Tuổi trên đơn nay tính tại lúc ký thay vì lúc in, để cùng dữ liệu luôn cho cùng một trang.
- `localPrescriptionDetail` dựng đơn từ dữ liệu trên máy qua đúng các hàm của gói hoàn tất và của đường đọc ngược; có kiểm thử so với đường máy chủ.
- `localPrescriptionCode` sinh mã đơn ở máy khách, dùng cùng vectơ kiểm tra với BFF.
- "In lại đơn" khi mất mạng in từ dữ liệu trên máy. Bước e2e mới so trang in dựng ở trình duyệt với trang BFF dựng: giống từng ký tự, trừ dòng liên thông. Xuất PDF được đúng một trang A5; chạy được cả trên bản dev lẫn bản build.
- Đột biến thử đã làm: bỏ thoát ký tự, tính tuổi theo giờ hiện tại, không cắt khoảng trắng lời dặn, không hạ chữ thường UUID, lấy ngày theo UTC. Mỗi đột biến làm đúng một bài đỏ. Bài về chữ hoa/thường ban đầu vẫn xanh khi bị đột biến vì UUID mẫu chỉ có chữ số; đã thêm vectơ có chữ cái.

Lát 2 xong:
- Bản nháp lượt khám chuyển từ `sessionStorage` sang kho IndexedDB (Dexie) mã hóa AES-GCM. Mỗi (phòng khám, người dùng) một kho. Khóa không xuất được. Mỗi lần ghi một IV mới. Bản mã gắn với bảng + id. Mọi thao tác với kho chạy lần lượt. Đăng xuất xóa kho và khóa; hết phiên (401) chỉ đóng kho, không xóa. Bản nháp dạng rõ của bản trước còn trong `sessionStorage` bị xóa khi khởi động. Trình duyệt không có kho mã hóa thì giữ nháp trong bộ nhớ của tab và báo rõ trên màn hình khám.
- Màn hình khám có chỉ báo "Đã lưu nháp trên máy (mã hóa)". IndexedDB ghi bất đồng bộ, nên bài e2e chờ chỉ báo này rồi mới tải lại trang.
- Kiểm thử: 11 bài đơn vị trên IndexedDB giả lập. e2e có thêm hai bước: đọc thẳng IndexedDB trong Chromium không thấy chữ nào của bản nháp ở dạng rõ; đăng xuất thì kho biến mất.
- Đột biến thử: ghi dạng rõ, IV cố định, bỏ AAD, bỏ chạy lần lượt, đăng xuất chỉ đóng kho, khóa xuất được, tab sau ghi đè khóa. Mỗi cái làm một bài đỏ; "ghi dạng rõ" làm đỏ cả bài e2e. Bài "hai tab cùng mở" ban đầu không bắt được việc ghi đè khóa; đã viết lại cho tất định (tab kia ghi nháp đúng lúc tab này sinh khóa).
- Cái giá: gói JS 343 → 447 KB, nén 109 → 144 KB [Đã đo]; gần như toàn bộ phần tăng là Dexie. Nếu cần nhẹ hơn, `idb` (khoảng 1 KB) thay được vì kho chỉ dùng đọc/ghi theo khóa.

Lát 3a xong (BFF, chưa nối vào giao diện):
- `POST /api/queue` nhận `arrivedAt` và `proposedNumber`. Ngày của lượt khám tính theo giờ đến. Số tạm được giữ nếu còn trống, đã có người lấy thì cấp số kế tiếp; số tạm vượt quá số kế tiếp bị bỏ qua để không tạo lỗ hổng trong dãy số.
- `POST /api/visits/:id/open` nhận `openedAt`; mốc mở được gắn nguồn `client`.
- `POST /api/visits/:id/complete` nhận `clientTimes` và `allergiesUnknown`. Mã đơn, tuổi và mọi mốc thời gian của bản ghi lấy theo giờ ký của máy khách. Thời gian phiên khám đo bằng hàm thuần `measureVisit` (gói `clinical`); giờ không hợp lý thì vẫn lưu, gắn cờ `client-invalid` và đếm riêng ở số đo.
- Hai điểm cuối mới: `GET /api/queue/prefetch` và `POST /api/prescriptions/:id/printed`.
- Quy tắc mới `allergy-unknown` trong gói `rules`. Máy chủ vẫn chạy kiểm tra dị ứng thật kể cả khi máy khách khai "chưa rõ dị ứng".
- Trang "Thời gian khám" có thêm cột "Đo ở máy khám" và "Giờ không hợp lý". Nhật ký truy cập ghi rõ thao tác làm lúc mất mạng và giờ theo máy khách.
- Kiểm thử: 12 bài đơn vị BFF mới, 5 bài `clinical`, 2 bài quy tắc, 6 bài tích hợp trên Medplum thật (giữ số tạm, ngày theo giờ đến, ký lúc mất mạng rồi gửi lại không trùng, giờ không hợp lý, nạp trước, ghi nhận in). Các bài tích hợp đặt trong tệp có sẵn để không thêm lần đăng nhập quản trị.
- Đột biến thử (9): mã đơn theo giờ máy chủ, bỏ cờ chưa rõ dị ứng, ghi dòng in không kiểm đơn, nhận giờ đến ở tương lai, bỏ so với khoảng máy chủ thấy, đo cả giờ ký ở tương lai, nhận số tạm vượt số kế tiếp, kho bỏ giờ máy khách, nạp trước cả người đã khám xong. Mỗi đột biến làm ít nhất một bài đỏ. Bài "nạp trước không có người đã khám xong" ban đầu dựa vào kết quả của bài trước nên đúng một cách vô nghĩa khi bài trước hỏng; đã sửa cho độc lập.
- `infra/dev-up.sh`: sau khi sandbox khởi động lại, tệp `/var/run/docker.pid` cũ làm `dockerd` từ chối chạy. Script nay xóa tệp đó khi không còn `dockerd` nào.

Còn lại cho lát 3b: giao diện chưa gọi các trường và điểm cuối mới; lần in ngoại tuyến chưa có dòng nhật ký cho tới khi hàng đợi gửi `printed`. Trang in có nhãn "ký khi mất mạng" mới được kiểm qua kiểm thử đơn vị; kiểm PDF một trang A5 cho trang này làm khi ký ngoại tuyến chạy được qua giao diện.

Lát 3b tách làm hai commit. **Lát 3b-1 xong** (kho, bộ máy đồng bộ, hàm API; chưa nối vào giao diện):
- Kho trên máy lên version 2. Bảng mới: `ops` (hàng đợi), `ids` (id tạm → id máy chủ), `patients` (bộ đệm `QueuePatient` và ngữ cảnh hồ sơ đã mở), `snapshots` (hàng chờ theo ngày), `signed` (đơn ký khi mất mạng, để in lại). Phần dữ liệu luôn mã hóa. Dạng rõ chỉ có: id, `seq` (thứ tự), `kind`, `status`, `deps`, các mốc thời gian, `day` và số lần thử. Bản nháp của version 1 đọc lại được sau khi nâng cấp (có kiểm thử).
- `commit(changes)`: mã hóa mọi giá trị trước, rồi ghi tất cả trong **một** giao dịch Dexie. Một thay đổi lỗi thì không thay đổi nào được ghi. Đây là chỗ dựa cho "ghi mục hoàn tất và xóa nháp cùng lúc, trước khi in" ở lát 3b-2.
- Dọn ngày cũ (`purgeBefore`): xóa bộ đệm, ảnh chụp hàng chờ, đơn ký khi mất mạng và các mục **đã xong** của ngày trước. Mục chưa xong không bao giờ bị dọn; ánh xạ id cũ được giữ khi còn mục cũ chưa xong.
- `pendingOnDevice()` cho màn hình đăng nhập: đọc số mục chưa xong và tên nhân viên (lưu dạng rõ trong `meta`), không đọc dữ liệu bệnh nhân.
- Bộ máy đồng bộ `local/sync.ts`:
  - Gửi theo thứ tự hàng đợi và phụ thuộc, quét nhiều lượt trong một lần chạy. Id tạm (`tmp-…`) được thay bằng id máy chủ ngay trước khi gửi và không bao giờ lên máy chủ.
  - Phân loại đúng OFF-7: lỗi mạng, 5xx, 503, 429 thì gửi lại, chờ 2 s · 2^(n−1), trần 60 s. 401 thì tạm dừng tới khi có token mới. 409 thành "xung đột", 422 `rules-not-satisfied` thành "chờ xác nhận" (`acknowledge` gửi lại cùng UUID kèm lý do), lỗi khác thành "cần xử lý". Mục phụ thuộc vào mục cần xử lý bị giữ; chuỗi khác vẫn chạy.
  - Kích hoạt: `wake()` (sự kiện `online`), `syncNow()` (nút "Đồng bộ ngay"), bộ hẹn giờ (lúc mục thử lại sớm nhất hết hạn, tối đa 30 s). Một tab gửi nhờ Web Locks; trình duyệt không có Web Locks thì dùng khóa trong tab.
  - Đồng hồ, bộ hẹn giờ và khóa đều tiêm vào được. Bộ máy dừng nếu phiên hiện tại không phải chủ kho.
  - Trạng thái "đang gửi" chỉ nằm trong bộ nhớ: trình duyệt sập giữa chừng thì mục vẫn là "chờ" và được gửi lại cùng UUID.
- Kiểm thử: 20 bài cho bộ máy, dùng BFF giả trong bộ nhớ và đồng hồ ảo. Các bài phủ:
  - gửi lại cùng UUID; mất phản hồi;
  - lũy thừa 2 có trần;
  - sập giữa "lưu" và "gửi"; sập sau khi máy chủ đã ghi;
  - thứ tự phụ thuộc và thay id tạm;
  - 409, 422, 401, lỗi khác;
  - phiên của người khác;
  - gửi ngay rồi chuyển sang dạng ngoại tuyến;
  - hai tab có Web Locks, kèm một bài đối chứng không khóa để chứng minh bài kia không đúng một cách vô nghĩa.

  Thêm 6 bài kho (nâng cấp version, không có dạng rõ trong mọi bảng mới, giao dịch nguyên tử, dọn ngày cũ, nháp mới nhất, đếm mục chờ trên máy), 9 bài cho tìm trong bộ đệm và gộp hàng chờ, 1 bài cho các hàm API mới.
- Đột biến thử (17, mỗi cái làm ít nhất một bài đỏ):
  - (a) sinh `clientUuid` mới khi gửi lại, ở mục tạo bệnh nhân và ở mục hoàn tất;
  - (b) bỏ mục khi lỗi mạng;
  - (c) gửi bằng phiên của người khác;
  - (f) 409 bị gửi lại, bị xóa, hoặc bị coi là lỗi khác;
  - 422 không chờ xác nhận; 401 không tạm dừng;
  - bỏ thay id tạm; bỏ kiểm tra phụ thuộc; chờ cố định thay vì lũy thừa; bỏ Web Locks;
  - `commit` không trong một giao dịch;
  - dọn cả mục chưa xong;
  - ghi dạng rõ phần dữ liệu.

  Script đột biến kiểm cả số bài đã chạy, để tránh lặp lại lỗi trỏ sai thư mục của lát trước.
- **Bổ sung so với thiết kế:** `submit(id, promote)`. Thao tác lúc có mạng được lưu vào hàng đợi rồi gửi ngay. Nếu chưa tới được máy chủ vì mất mạng, thao tác được chuyển sang dạng ngoại tuyến **cùng id, cùng `clientUuid`**: thêm `arrivedAt`/`proposedNumber` khi cấp số, `openedAt` khi mở hồ sơ, `clientTimes` khi ký. Việc chuyển làm ngay trong lúc giữ khóa, để không tab nào kịp gửi bản cũ. Chỉ chuyển khi lỗi mạng, không chuyển khi máy chủ trả 5xx/503: với 503 máy chủ có thể đã ghi dở, đổi giờ ký lúc đó có thể làm lệch mã đơn giữa các phần đã ghi. Ca mất phản hồi có giới hạn tương tự nhưng nhỏ: lần gửi đầu đã ghi xong với giờ máy chủ, gửi lại thì máy chủ trả kết quả cũ. Mã đơn trên giấy (theo giờ máy khách) chỉ lệch với mã trên máy chủ nếu đồng hồ máy khách lệch qua nửa đêm; lát 3b-2 so mã và báo nếu khác.
- **Bổ sung so với thiết kế:** `discard(id)` chỉ bỏ được mục máy chủ vừa từ chối, và chỉ khi không có mục nào phụ thuộc vào nó. Dùng cho thao tác gửi ngay lúc có mạng mà dữ liệu vẫn còn trên màn hình (biểu mẫu, bản nháp): giữ hành vi hiện tại là hiện lỗi tại chỗ để người dùng sửa rồi gửi lại. Mục làm lúc mất mạng thì không bao giờ bị bỏ.
- Gói JS 447 → 451 KB, nén 144 → 146 KB [Đã đo]. Bộ máy đồng bộ chưa được giao diện nạp nên chưa tính vào số này.

**Lát 3b-2 xong** (luồng ngoại tuyến ở giao diện). Mọi thao tác ghi trong phạm vi N4 đi qua cùng hàng đợi, có mạng hay không: tạo bệnh nhân, cấp số, mở hồ sơ, ký hoặc kết thúc khám, ghi nhận in.
- `local/client.ts` (`OfflineClient`) gom các luồng. Không phụ thuộc React nên có kiểm thử đơn vị trên IndexedDB giả. `OfflineProvider` tạo bộ máy đồng bộ cho người đang đăng nhập và nối sự kiện `online`/`offline`. Nó nạp trước hàng chờ và hồ sơ mỗi 30 giây khi có mạng (OFF-4) và khi có mạng lại.
- Tiếp đón:
  - Mất mạng (hoặc gọi mà gặp lỗi mạng) thì tìm trong bộ đệm bằng `classifyQuery` + `foldName`, ghi "Mất mạng: chỉ tìm trong N hồ sơ trên máy này"; quy tắc kết quả cũ bị mờ giữ nguyên.
  - Hồ sơ mở lúc có mạng được giữ tóm tắt và dị ứng trên máy.
  - Tạo bệnh nhân khi mất mạng thì có id tạm, CCCD đầy đủ nằm trong bộ đệm mã hóa nên tìm được bằng CCCD.
  - Cấp số khi mất mạng: số tạm = số lớn nhất máy biết + 1, hiện "007 (tạm)", gửi kèm `arrivedAt` và `proposedNumber`.
  - Bổ sung CCCD, sửa dị ứng thì ghi "Cần mạng"; với bệnh nhân chưa đồng bộ thì ghi "cần đồng bộ trước".
- Hàng chờ và màn hình chờ:
  - Gộp hàng chờ của máy chủ (hoặc ảnh chụp lần cuối) với các thao tác chưa đồng bộ (`mergeQueue`). Dòng có thao tác chờ hiện "Chờ đồng bộ"; dòng bị từ chối hiện "Cần xử lý". Máy chủ đổi số thì báo "Số 007 (cấp khi mất mạng) … đã đổi thành 009".
  - Nút "Hủy" bị khóa khi mất mạng.
  - Màn hình chờ dựng từ dữ liệu trên máy khi mất mạng hoặc khi có lượt chưa đồng bộ; số tạm có nhãn "tạm".
- Khám:
  - Bản nháp luôn ghi `openedAt` theo đồng hồ máy, kể cả khi mở có mạng.
  - Mở khi mất mạng: không có dị ứng trong bộ đệm thì `allergiesKnown = false`, quy tắc `allergy-unknown` đòi xác nhận. Tiền sử và lịch sử khám không có trên máy thì ghi "Chưa tải". Thêm/xóa tiền sử, dị ứng ghi "Cần mạng".
  - Ký khi mất mạng làm theo thứ tự:
    1. dựng đơn bằng `localPrescriptionDetail`, mã bằng `localPrescriptionCode`;
    2. trong **một** giao dịch: ghi mục hoàn tất (`clientTimes`, `allergiesUnknown`), mục ghi nhận in (phụ thuộc mục hoàn tất), đơn để in lại, và xóa bản nháp;
    3. sau đó mới `printLocal(…, true)`. Ghi lỗi thì báo "CHƯA in" và giữ nháp.
  - Màn hình kết quả theo dõi mục hoàn tất: chờ đồng bộ, đã đồng bộ, xung đột, chờ xác nhận, hoặc bị giữ. Nó báo nếu mã trên máy chủ khác mã đã in. Nút "In lại đơn" in từ máy (kèm mục ghi nhận in) hoặc qua máy chủ khi đã đồng bộ.
  - Có mạng: gửi ngay, giữ hành vi cũ (422 hiện tại chỗ, nháp còn). Gửi mà mất mạng (kể cả mất phản hồi) thì chuyển sang ký khi mất mạng cùng UUID.
- Phiên đăng nhập (OFF-6):
  - Đăng xuất khi còn mục chờ thì hỏi "Chờ đồng bộ" hoặc "Đăng xuất, giữ dữ liệu đã mã hóa trên máy", không có nút hủy.
  - Màn hình đăng nhập ghi "Máy này còn N mục chưa đồng bộ của BS. …".
  - Đăng nhập lại đúng người thì tự gửi tiếp. Hết mục chờ thì đăng xuất xóa kho như trước.
  - Hết phiên (401) giữa lúc đồng bộ thì về màn hình đăng nhập, ở đó có thông báo này.
- Liên thông, Thời gian khám, Nhật ký: ghi "Cần mạng" khi mất mạng; nút chèn lỗi cổng và "Gửi lại ngay" bị khóa.
- **Phát hiện F12, đã sửa.** Chromium bỏ mất sự kiện của yêu cầu IndexedDB đang dở khi gọi `print()`. Lần chạy đầu của bài e2e ngoại tuyến treo hàng đợi đúng lúc ký rồi in. Đã sửa bằng hai việc:
  - hàng rào in: chờ kho yên, chặn thao tác mới trong lúc in;
  - hạn 20 giây cho mỗi thao tác kho; bộ máy đồng bộ luôn hẹn lần chạy sau khi gặp lỗi.

  Thử ứng dụng 20 vòng, mỗi vòng 10 lần đọc kho chen ngang lúc in: 0/200 bị mất khi có hàng rào, 83/200 khi gọi `print()` thẳng.
- Kiểm thử:
  - 10 bài đơn vị mới cho `OfflineClient`: lưu bền rồi mới in; ghi lỗi thì không in; mất phản hồi; có mạng; 422 có mạng; `allergy-unknown`; nạp trước có dị ứng; nạp trước chỉ người mới; tạo bệnh nhân và cấp số tạm rồi đồng bộ; bị từ chối khi có mạng.
  - 3 bài cho hàng rào in và hạn thao tác kho.
  - e2e mới `e2e/offline-sign.mjs`, 13 bước, ngắt mạng thật bằng `context.setOffline`:
    - tìm trong bộ đệm;
    - tạo bệnh nhân và cấp số tạm;
    - hàng chờ, màn hình chờ;
    - khám có `allergy-unknown`;
    - ký: trang in có "KÝ KHI MẤT MẠNG", PDF đúng 1 trang A5;
    - đọc thẳng IndexedDB không thấy dạng rõ;
    - có mạng lại: đúng 1 bệnh nhân, 1 lượt khám, 1 đơn trùng mã đã in, giữ số tạm;
    - mất phản hồi (`route.fetch()` rồi `route.abort()`): vẫn 1 lượt khám mới, mã trùng;
    - bất biến của hàng rào in;
    - đăng xuất khi còn mục chờ;
    - không lỗi console.

    Đạt trên bản dev và bản build. Bài này chạy trong job e2e của CI, ngay sau `e2e:visit`.
- Đột biến thử lát 3b-2 (15, mỗi cái làm ít nhất một bài đỏ):
  - (e) gỡ `allergy-unknown` ở máy khách, theo 4 cách: trong `evaluate`, khi mở ngoại tuyến, cờ gửi máy chủ, màn hình khám không chuyển cờ (cách cuối do e2e bắt);
  - in trước khi lưu bền;
  - không xóa nháp cùng giao dịch;
  - mục ghi nhận in không phụ thuộc mục hoàn tất;
  - không gửi giờ máy khách khi ký ngoại tuyến;
  - số tạm không cộng 1;
  - hàng rào không chờ thao tác đang dở; bỏ hạn thao tác kho;
  - tìm khớp giữa từ;
  - nạp trước hỏi lại người đã có;
  - in không qua hàng rào (e2e, 2/2 lần đỏ);
  - nút "Hủy" không khóa khi mất mạng (e2e).

  Một đột biến lúc đầu không đỏ do chính đột biến viết sai (vẫn để bộ hẹn giờ); đã viết lại và chạy lại.
- **Đi khác thiết kế, hoặc chi tiết thêm:**
  1. Bệnh nhân tạo khi mất mạng cũng bị coi là "chưa rõ dị ứng": máy không có dữ liệu dị ứng của họ, theo đúng câu chữ OFF-4.
  2. Nhật ký truy cập: mỗi lần tải hàng chờ là một dòng `queue-read`. Bài `e2e:visit` bước 20 đỏ lần đầu: 50 dòng cuối của nhật ký bị lấp bởi các lần tải trùng (React ở bản dev chạy hiệu ứng hai lần, nạp trước nền, màn hàng chờ). Đã gộp các lần tải cách nhau dưới 4 giây; lần nạp nền dùng lại kết quả nếu màn hàng chờ vừa tải. Nhật ký vẫn nhiều hơn trước: thêm `queue-prefetch` và một `queue-read` mỗi 30 giây khi màn hàng chờ không mở.
  3. Màn hình chờ khi có lượt chưa đồng bộ dựng từ ảnh chụp trên máy, cũ tối đa 30 giây, thay vì `/api/display`.
  4. Bài e2e chạy trên phòng khám demo với bệnh nhân tên `Zq…` và tự dọn hàng chờ, như `e2e:visit`. Bài 20 chu kỳ trên phòng khám thử riêng vẫn là lát 5.
  5. Chưa có giao diện xác nhận lại mục 422 của hàng đợi (`SyncEngine.acknowledge` đã có và có kiểm thử), chưa có danh sách chờ đồng bộ. Cả hai thuộc lát 4.
- Gói JS 451 → 494 KB, nén 146 → 159 KB [Đã đo, bản build].

Lát 4 tách làm hai commit. **Lát 4-1 xong** (hàm thuần, chỉ báo, danh sách chỉ đọc; chưa có xử lý mục bị từ chối và thông báo):
- `local/deps.ts`: hàm thuần `depState` cho biết một mục gửi được, đang chờ mục trước, hay bị giữ vì mục nào. Bộ máy đồng bộ, danh sách và màn hình kết quả ký dùng chung hàm này. Trước đây màn hình kết quả ký tự tính và chỉ xét mục trước trực tiếp; nay xét qua nhiều bậc như bộ máy.
- `SyncState` thêm hai trường:
  - `counted`: false cho tới khi đếm xong lần đầu sau khi mở kho. Trong lúc đó `pending` là 0 nhưng chưa có nghĩa.
  - `lastSyncAt`: lần gần nhất máy chủ nhận một mục của máy này. Sau khi tải lại trang, giá trị lấy từ mục đã xong còn trong kho.
- `local/syncList.ts`, toàn hàm thuần trên hàng đợi đã giải mã trong bộ nhớ:
  - `buildSyncRows`: một dòng cho mỗi mục chưa xong, gồm loại thao tác, bệnh nhân, số thứ tự (có nhãn "tạm"), mã đơn, trạng thái, lỗi gần nhất của máy chủ. Trạng thái: chờ gửi, đang gửi, chờ mục trước, thử lại lúc mấy giờ (lần gửi thứ mấy), xung đột, chờ bác sĩ xác nhận, cần xử lý, bị giữ vì mục nào. Mất mạng hoặc hết phiên thì mục chờ ghi rõ "chờ có mạng", "chờ đăng nhập lại".
  - `conflictText`: câu của OFF-7, kèm số lượt khám và tên người giữ. Tên lấy từ hàng chờ của máy chủ nếu có, không thì từ thông điệp 409.
  - `buildNotices`, `ackList`: dựng thông báo và kiểm lý do xác nhận. Đã có kiểm thử; giao diện dùng chúng ở lát 4-2.
  - `indicatorView`, `expiredText`: chỉ báo và câu "Phiên đã hết hạn: đăng nhập lại để đồng bộ N mục".
- Giao diện:
  - `SyncBar` ở thanh trên: "Có mạng" hoặc "Mất mạng", số mục chờ hoặc "Đang đếm mục chờ…", "đang gửi", huy hiệu "N cần xử lý", "Gửi lần cuối HH:MM", nút "Đồng bộ ngay".
  - `SyncPanel`: ngăn "Chờ đồng bộ" mở từ chỉ báo. Chỉ có hai nút: "Đồng bộ ngay" và "Đóng".
  - Màn hình đăng nhập sau khi hết phiên: "Phiên đã hết hạn: đăng nhập lại để đồng bộ N mục", cùng dòng "Máy này còn N mục…" đã có.
- Kiểm thử: 29 bài đơn vị mới (304 → 333).
  - 21 bài cho hàm thuần và cho danh sách dựng từ hàng đợi thật (IndexedDB giả, BFF giả, đồng hồ ảo): 409 do người khác mở lượt khám, 422, lỗi tạm, đang gửi, "đang đếm" trước lần đếm đầu.
  - 8 bài dựng thành phần ra HTML tĩnh bằng `react-dom/server` (không cần jsdom): chỉ báo, danh sách, màn hình đăng nhập. Bài "không có nút xóa hay hủy" đếm mọi thẻ nút trong ngăn danh sách ở từng trạng thái của mục.
- Đột biến thử lát 4-1 (23, mỗi cái làm ít nhất một bài đỏ):
  - chỉ báo hiện 0 trước khi đếm xong, theo 3 cách: ở hàm chỉ báo, ở bộ máy, ở thuộc tính `data-pending`;
  - không hiện "bị giữ"; "bị giữ" chỉ xét mục trước trực tiếp;
  - mất dòng "Phiên đã hết hạn" ở hàm, ở thanh chỉ báo, ở màn hình đăng nhập; câu mất số mục;
  - thêm nút xóa, thêm nút hủy không có `data-testid`;
  - 409 tự biến mất khỏi danh sách; 409 bị coi là lỗi tạm; "Đồng bộ ngay" gửi lại mục xung đột;
  - câu xung đột mất tên; mất thông điệp lỗi của máy chủ; dòng thử lại mất số lần gửi;
  - nhãn hiển thị bị gửi lên máy chủ;
  - thông báo cho cả mục bị giữ; không báo đổi số tạm; không báo lệch mã đơn; nhận lý do xác nhận quá ngắn;
  - huy hiệu cần xử lý biến mất.
- **Đi khác thiết kế, hoặc chi tiết thêm:**
  1. Mục mở hồ sơ, hoàn tất và ghi nhận in mang thêm phần `display` (tên bệnh nhân, số, mã đơn) trong phần **mã hóa**. Danh sách nhờ đó không phải tra ngược qua mục khác, và mục của ngày cũ vẫn có tên sau khi bộ đệm ngày đó bị dọn. Phần này không gửi lên máy chủ (có kiểm thử). Mục tạo trước lát 4 không có phần này: danh sách tra qua hàng chờ trên máy và đơn đã ký.
  2. Mọi lần gọi máy chủ gặp 401 đều đưa ứng dụng về màn hình đăng nhập (từ lát 3b). Vì vậy câu "Phiên đã hết hạn…" chủ yếu hiện ở màn hình đăng nhập; dòng tương ứng ở thanh chỉ báo chỉ kịp hiện thoáng qua.
  3. Thuộc tính `data-pending` của chỉ báo là `counting` cho tới khi đếm xong, không còn là `0`. Bài e2e chờ `data-pending="0"` vì thế không còn đúng sớm.
  4. "Gửi lần cuối" tính theo mục đã xong còn trong kho. Mục đã xong của ngày cũ bị dọn khi mở ứng dụng, nên đầu ngày chỉ báo không có dòng này cho tới lần gửi đầu tiên.
- Gói JS 494 → 506 KB, nén 159 → 162 KB [Đã đo, bản build].

**Lát 4-2 xong** (xử lý mục bị từ chối, thông báo, e2e hai máy):
- `local/syncActions.ts`: danh sách chỉ làm được ba việc, "Đồng bộ ngay", "Xác nhận và gửi lại", "In lại đơn". Giao diện danh sách nhận đối tượng này, không nhận bộ máy đồng bộ. Không có việc bỏ hay sửa mục.
- 422 `rules-not-satisfied`:
  - Dòng của mục hiện các phát hiện của máy chủ, mỗi phát hiện một ô lý do (ít nhất `MIN_ACK_REASON_LENGTH` ký tự), ghi rõ "đơn đã in: liên hệ bệnh nhân nếu cần đổi thuốc".
  - "Xác nhận và gửi lại" bị khóa cho tới khi đủ lý do, rồi gọi `acknowledge`: cùng mục, cùng `clientUuid`, kèm lý do.
  - Máy chủ trả cả lỗi chặn (`blocking`) thì không có ô lý do và không có nút gửi lại; dòng ghi "liên hệ bệnh nhân và kê lại đơn".
- 409: dòng của mục mở hồ sơ hoặc hoàn tất hiện câu của OFF-7 kèm số lượt khám và tên người giữ. Mục phụ thuộc ghi "Bị giữ: mục «…» đang xung đột". Bản khám giữ nguyên trên máy; nút "In lại đơn (từ máy này)" in từ bản đã ký, có nhãn "ký khi mất mạng", và thêm một mục ghi nhận in (mục này cũng bị giữ).
- Lỗi khác: hiện nguyên thông điệp của máy chủ kèm mã HTTP.
- Thông báo (N3) ở đầu trang, mỗi sự việc một thông báo: mục chuyển sang xung đột, chờ xác nhận hoặc cần xử lý; máy chủ đổi số tạm; mã đơn trên máy chủ khác mã đã in. Mục bị giữ không có thông báo riêng. Tắt được từng thông báo ("Đã xem"); danh sách đã tắt giữ trong `sessionStorage` (chỉ có UUID của mục). Huy hiệu "N cần xử lý" tính từ hàng đợi, không phụ thuộc thông báo: tắt hết thông báo thì huy hiệu vẫn còn.
- Kho: lần dọn đầu ngày giữ lại đơn đã ký khi mất mạng của ngày cũ chừng nào còn mục cũ chưa xong, để mục đang xung đột hoặc chờ xác nhận vẫn in lại được qua đêm. Trước đây đơn của ngày cũ bị dọn dù mục của nó chưa lên máy chủ.
- Danh sách xếp mục trước lên trên mục phụ thuộc nó. Mục ghi nhận in được xếp vào hàng đợi trước mục ký của chính nó (hai mục ghi cùng một giao dịch); bộ máy gửi theo phụ thuộc nên không sai, nhưng hiện theo thứ tự hàng đợi thì khó đọc.
- Kiểm thử đơn vị: thêm 12 bài (333 → 345).
  - Xác nhận 422 từ danh sách: đúng 2 yêu cầu cùng `clientUuid`, lần hai kèm lý do; lý do thiếu hoặc quá ngắn thì không gửi gì.
  - 409: "Đồng bộ ngay" và thời gian trôi không gửi lại, không làm mục biến mất; in lại được.
  - Không có đường nào xóa mục: gọi mọi thao tác của danh sách trên mọi dòng ở mọi trạng thái, không mục nào rời hàng đợi. Thêm một bài đọc mã nguồn của danh sách: không có lời gọi `discard`, không ghi thẳng vào kho.
  - Tắt hết thông báo: huy hiệu, số mục chờ và các dòng giữ nguyên.
  - Giữ đơn đã ký của ngày cũ, trên cả kho mã hóa và kho trong bộ nhớ.
- e2e mới `e2e/offline-conflict.mjs` (`pnpm --filter @phongmach/clinic-web e2e:conflict`), 12 bước, hai máy bằng hai `browser.newContext()`, ngắt mạng thật. Đạt trên bản dev và bản build; đã thêm vào `pnpm e2e` và job e2e của CI.
  - **409:** bác sĩ mất mạng mở một lượt đã nạp trước, ký và in; chủ phòng khám mở cùng lượt ở máy kia. Có mạng lại: thông báo và danh sách báo xung đột kèm tên chủ phòng khám, mục ký và mục ghi nhận in bị giữ; "Đồng bộ ngay" không gửi lại; in lại được; máy chủ không nhận lần hoàn tất nào của bác sĩ và lượt khám vẫn do chủ phòng khám giữ; không có nút xóa hay hủy; tắt thông báo thì huy hiệu "4 cần xử lý" vẫn còn; tải lại trang các mục vẫn còn.
  - **401:** giả lập phản hồi 401. Màn hình đăng nhập ghi "Phiên đã hết hạn: đăng nhập lại để đồng bộ 4 mục" và "Máy này còn 4 mục…"; đăng nhập lại thì các mục còn nguyên.
  - **422:** bác sĩ mất mạng ký đơn có amoxicillin; phụ tá ở máy kia ghi dị ứng Penicillin qua giao diện. Có mạng lại: danh sách hiện cảnh báo dị ứng của máy chủ; lý do ngắn thì nút vẫn khóa; ghi lý do rồi gửi lại. Máy chủ có đúng một lượt khám, mã đơn trùng mã đã in, đơn lưu kèm lý do; đúng 2 yêu cầu hoàn tất mang cùng `clientUuid`.
  - Đọc thẳng IndexedDB ở cả hai kịch bản: không có tên bệnh nhân, thuốc, thông điệp lỗi của máy chủ hay lý do xác nhận ở dạng rõ. Bất biến của hàng rào in (F12) đúng cho cả lần in lại từ danh sách.
- Đột biến thử lát 4 trên mã cuối:
  - 45 đột biến qua kiểm thử đơn vị (23 của lát 4-1 chạy lại, 22 mới), mỗi cái làm ít nhất một bài đỏ. Nhóm mới: xác nhận sinh `clientUuid` mới (2 cách); xác nhận không kèm lý do; gửi lại khi lý do chưa đủ; xác nhận cả đơn có lỗi chặn; gọi `discard` từ danh sách (3 cách); thêm nút "Bỏ qua"; nút gửi lại không khóa; mất dòng "đơn đã in"; huy hiệu ẩn khi tắt thông báo; tắt thông báo làm mất dòng; tắt một tắt hết; in lại không ghi nhận, không nhãn, không phụ thuộc mục ký; dọn đơn ngày cũ (3 cách); thứ tự hiện; thông báo không có nút tắt.
  - 10 đột biến qua bài e2e hai máy (bản dev), mỗi cái làm bài đỏ ở một bước: thông báo có họ tên hiện cả ở màn hình chờ (bước 6); huy hiệu ẩn khi tắt thông báo (đột biến ở khung ứng dụng, nơi kiểm thử đơn vị không tới; đỏ ở bước 6); xác nhận sinh `clientUuid` mới (bước 11); thêm nút xóa (bước 4); mất dòng "Phiên đã hết hạn" (bước 7); không hiện "bị giữ" (bước 4); 409 được gửi lại (bước 3); "Đồng bộ ngay" xóa thẳng mục xung đột khỏi kho (bước 5); 409 biến mất khỏi danh sách (bước 4); nhãn hiển thị ghi ra đĩa ở dạng rõ (bước 6).
  - Hai đột biến lúc đầu không đỏ, cả hai do chính đột biến:
    - Một cái viết sai cú pháp JSX (tệp không dịch được, 0 bài chạy). Script đột biến coi đó là "không đỏ"; đã viết lại và chạy lại.
    - Đột biến e2e "Đồng bộ ngay gọi `discard` cho mọi mục" qua cả 12 bước. Lý do: `discard` của bộ máy từ chối bỏ mục còn có mục phụ thuộc, mà trong kịch bản e2e mục bị từ chối nào cũng có mục phụ thuộc, nên đột biến không đổi hành vi. Kiểm thử đơn vị vẫn bắt được nó (ở đó có một mục lỗi không có mục phụ thuộc). Đã thay bằng đột biến xóa thẳng khỏi kho, đỏ ở bước 5.
- **Phát hiện ở bài e2e có sẵn, đã sửa:** `page.waitForFunction` với hàm `async` coi lời hứa trả về là "đúng" và xong ngay, tức là không chờ gì cả [Đã đo, playwright-core 1.63: hàm async trả `false` vẫn xong sau 61 ms]. Bước "nạp trước xong" của `e2e/offline-sign.mjs` dùng đúng mẫu này nên từ lát 3b-2 nó không chờ gì; bài vẫn xanh vì các bước sau đủ chậm. Bài e2e mới dùng lại mẫu đó và đỏ trên bản build (xanh trên bản dev): máy mở hồ sơ khi mất mạng trước khi bộ đệm ghi xong, nên đòi xác nhận "chưa rõ dị ứng". Cả hai bài nay thăm dò bằng `page.evaluate`, có chờ kết quả.
- **Đi khác thiết kế, hoặc chi tiết thêm:**
  1. Nút in lại ở danh sách chỉ có ở mục ký mà máy còn giữ bản đơn. Mỗi lần in lại thêm một mục ghi nhận in, nên con số "cần xử lý" tăng theo số lần in lại khi mục ký đang bị giữ.
  2. Kịch bản 401 của e2e giả lập phản hồi 401 bằng `page.route`; token thật vẫn còn hạn. Hết hạn thật sau 480 phút [Chưa đo].
  3. Thông báo đã tắt giữ theo phiên trình duyệt (`sessionStorage`): mở tab mới thì thông báo hiện lại. Mục bị từ chối lần nữa là sự việc mới và được báo lại.
  4. Thông báo có họ tên bệnh nhân, nên không hiện ở tab "Màn hình chờ" (màn hình đặt nơi công cộng, chỉ có số thứ tự và chữ cái đầu). Huy hiệu ở thanh trên vẫn còn. Bài e2e kiểm điều này; gỡ điều kiện thì bài đỏ ở bước 6.
  5. Đơn 422 có lỗi chặn không có đường xử lý trong M0 ngoài việc liên hệ bệnh nhân và kê lại; mục nằm lại trong danh sách. Cùng loại với giải quyết xung đột: ngoài phạm vi M0.
  6. Lát này không sửa BFF.
- Gói JS 506 → 510 KB, nén 162 → 163 KB [Đã đo, bản build].
- Máy dev lần này là Windows (Git Bash), không phải sandbox Linux như các lát trước:
  - `infra/dev-up.sh` không chạy được nguyên trạng (không có `setsid`); đã dựng tay theo đúng các bước của script.
  - Cổng 5173 bị một dự án khác chiếm, nên giao diện dev chạy ở 5183 với `E2E_URL` tương ứng.
  - Chromium là bản `chrome-headless-shell` của Playwright, đặt qua `CHROMIUM_PATH`.
  - Số đo trên máy này: kiểu đạt 7 gói, 345 kiểm thử đơn vị, 41 tích hợp, e2e 13 + 24 + 13 + 12 bước trên cả bản dev và bản build.

**Lát 5 xong (03/10/2026)** (bài e2e 20 chu kỳ ngắt và khôi phục mạng, đo tiêu chí M0-2; không sửa mã sản phẩm, không sửa BFF):
- **Kết quả M0-2: đạt [Đã đo].** 20 chu kỳ ngắt và khôi phục mạng liên tiếp, 0 bản ghi mất, 0 bản ghi trùng.
  - Trên máy dev, bản build: 4/4 lần chạy liên tiếp đạt 11/11 bước kiểm. Ba hạt giống ngẫu nhiên là 1204340693, 4025600034, 3101454767; hạt giống cố định là 12345.
  - Sau lần đỏ đầu tiên ở CI (do chính bài kiểm thử, xem dòng "CI"), chạy thêm 8 lần trên máy dev, đều đạt 11/11: hai lần với hạt giống của CI (2533173637) và sáu hạt giống ngẫu nhiên (2623727053, 1479480661, 575007583, 1765272687, 366576775, 2878407743).
  - Một lần chạy 100 chu kỳ (`E2E_CYCLES=100`, hạt giống 558698034) cũng đạt 11/11, mất 251 giây. Đây chưa phải T6 đầy đủ: T6 còn đòi đồng bộ 40 ca trong 60 giây.
  - Thời gian: bài 20 chu kỳ 44–55 giây; cả lệnh `pnpm e2e:cycles` (tạo phòng khám thử, chạy BFF và bản build, bài, dừng) 46–57 giây khi đã build sẵn, 63 giây khi phải build. Máy chủ nhận lượt khám sau khi có mạng lại: trung vị 0,3–1,2 giây, lâu nhất 4,3 giây.
  - Cấu hình máy đo: Windows 11, Intel i7-11800H (8 nhân, 16 luồng), 32 GB RAM, Medplum 5.2.0 trong Docker Desktop, `chrome-headless-shell` của Playwright.
  - CI: xem dòng "CI" ở cuối mục này.
- Bài nằm ở `apps/clinic-web/e2e/offline-cycles.mjs` (script `e2e:cycles` của `clinic-web`). Chạy trọn bằng `pnpm e2e:cycles` ở gốc kho (`infra/e2e-cycles.mjs`):
  - tạo một phòng khám thử mới (`services/bff/scripts/e2e-clinic.ts`: Project, tài khoản máy, một bác sĩ có `Practitioner`), ghi tệp phòng khám tạm ở `services/bff/.data/e2e-cycles/` (đã gitignore);
  - chạy một BFF riêng ở cổng 8111 với tệp phòng khám tạm và tệp nhật ký riêng, và bản build của giao diện ở cổng 4174 trỏ `/api` tới 8111;
  - chạy bài rồi dừng hai tiến trình đó. Hai phòng khám demo, BFF 8110 và giao diện demo không bị đụng tới.
  - `vite.config.ts` đọc `BFF_URL` và `PREVIEW_PORT` từ môi trường, mặc định như cũ.
- Kế hoạch từng chu kỳ sinh từ một hạt giống (`e2e/cycles-plan.mjs`, hàm thuần, 8 kiểm thử đơn vị). Bài in hạt giống ở dòng đầu; `E2E_SEED=<số>` chạy lại đúng kế hoạch đó.
  - Mỗi chu kỳ một bệnh nhân mới đi qua năm thao tác trên một máy: tạo bệnh nhân, cấp số, gọi vào khám, khám, ký và in.
  - Mỗi chu kỳ có đúng một lần ngắt (`context.setOffline`) trước một thao tác và một lần bật lại trước một thao tác sau đó, nên luôn có ít nhất một thao tác làm lúc mất mạng.
  - Mất phản hồi (`route.fetch()` rồi `route.abort()`) ở một thao tác ghi làm lúc có mạng. Với 20 chu kỳ, mỗi thao tác ghi (tạo bệnh nhân, cấp số, gọi vào khám, ký) bị mất phản hồi đúng 4 lần, hạt giống nào cũng vậy.
  - Tải lại trang khi đang mất mạng ở khoảng 40% số chu kỳ (hạt giống 12345: 7 lần). Lần tải đầu có mạng và chờ service worker nắm trang.
  - Máy sập đúng lúc tờ đơn ký khi mất mạng được in, ở một nửa số chu kỳ ký trong lúc mất mạng (hạt giống 12345: 3 lần); luôn có ít nhất một lần.
  - Dữ liệu nhập cũng đổi theo hạt giống: 0–5 nhóm sinh hiệu, một trong năm đơn mẫu (2 hoặc 3 thuốc), có hoặc không có chẩn đoán thứ hai.
- Kiểm cuối bài, 11 bước, đếm bằng tài khoản máy của phòng khám thử (đọc thẳng Medplum, không qua BFF). Đã mở mã để xác nhận từng loại bản ghi (`buildCompletionBundle`, `buildCheckIn`, `buildVitalObservations`); thực tế khác danh sách của thiết kế ở các điểm có ghi "khác":
  1. cả 20 chu kỳ chạy hết, sau mỗi chu kỳ máy chủ có lượt khám hoàn tất;
  2. Patient = Encounter = List = Task = Provenance = 20. **Khác:** gói hoàn tất còn tạo một `ClinicalImpression` khi có triệu chứng hoặc khám lâm sàng; bài luôn nhập triệu chứng nên đếm thêm ClinicalImpression = 20;
  3. mọi Encounter là `finished`; bệnh nhân của mỗi chu kỳ (nhận theo số điện thoại riêng) có mặt đúng một lần và có đúng một lượt khám;
  4. MedicationRequest, Condition, Observation đúng bằng số đã nhập, ở tổng số và ở từng lượt khám; AllergyIntolerance = 0. **Khác:** huyết áp là một Observation gồm hai thành phần, nên "số đã nhập" tính theo nhóm sinh hiệu;
  5. 20 số thứ tự khác nhau. **Khác:** đếm theo mã lượt khám (ngày và số); khi cả lần chạy nằm trong một ngày thì các số còn phải liền nhau từ 1 đến 20 (phòng khám mới, một máy);
  6. mỗi mã đơn đã in có đúng một đơn (List) và một việc gửi cổng (Task) trên máy chủ, đúng bệnh nhân. **Khác:** mã lấy từ chính trang in, không lấy từ màn hình; kiểm cả chiều ngược lại (máy chủ không có đơn nào ngoài các tờ đã in);
  7. trên máy không còn mục chờ, mục xung đột hay mục cần xử lý: đọc thẳng bảng `ops` trong IndexedDB (mọi mục `done`), chỉ báo ghi 0, không có thông báo nào. Mục ghi nhận in không sinh bản ghi FHIR (chỉ là dòng nhật ký) nên được kiểm ở đây;
  8. đọc thẳng IndexedDB trước mỗi lần bật lại mạng (lúc hàng đợi đầy nhất) và ở cuối bài: không có tên, số điện thoại, CCCD, triệu chứng, tên thuốc hay mã ICD ở dạng rõ;
  9. hàng rào in (F12): cả 20 lần gọi `print()` đều không còn yêu cầu IndexedDB nào đang dở;
  10. mọi lỗi đã định thật sự xảy ra (mỗi lần mất phản hồi cắt đúng một yêu cầu, đủ số lần tải lại và số lần máy sập);
  11. console không có lỗi nào, kể cả phản hồi 4xx hay 5xx của máy chủ; chỉ trừ lỗi "không tới được máy chủ" do cố ý ngắt mạng và cắt phản hồi.
- Đột biến trên mã sản phẩm, chạy với hạt giống 12345, mỗi cái làm bài đỏ ở bước đếm [Đã đo]:
  - sinh `clientUuid` mới khi gửi lại: Patient 24/20 và Encounter 24/20 (trùng 4 mỗi loại, đúng bằng số lần mất phản hồi ở tạo bệnh nhân và ở cấp số), 4 lượt khám nằm lại ở `arrived`, 4 mục ký thành xung đột; 7/11 bước đỏ;
  - bỏ mục khỏi hàng đợi khi gặp lỗi mạng: Encounter 13/20, List 5/20 (mất 15), hai chu kỳ đã in đơn mà máy chủ không có đơn; 8/11 bước đỏ;
  - in trước khi lưu bền: List, Task, Provenance 17/20; ba tờ đã in ở ba chu kỳ máy sập không có đơn trên máy chủ, ba lượt khám nằm lại ở `in-progress`; 5/11 bước đỏ.
  - Đột biến thứ hai lúc đầu không dịch được (TypeScript báo so sánh thừa), lệnh trả mã lỗi nên trông như "đỏ"; đọc log mới thấy 0 chu kỳ chạy. Đã viết lại rồi chạy lại. Lần chạy lại đầu tiên bài dừng ngay ở chu kỳ hỏng đầu tiên, số đếm khi đó chỉ phản ánh việc bài dừng; đã sửa bài để dựng lại máy và chạy tiếp sau một chu kỳ hỏng.
- Bốn đột biến còn lại của thiết kế, chạy lại trên kiểm thử có sẵn, đều đỏ [Đã đo]:
  - gửi mục của người khác bằng phiên hiện tại: `sync.test.ts`, bài "phiên của người khác: không gửi mục nào của kho này…";
  - ghi dạng rõ vào IndexedDB: `store.test.ts`, hai bài "trên đĩa không có chữ nào của bản nháp ở dạng rõ" và "…trong mọi bảng mới";
  - gỡ quy tắc `allergy-unknown`: 2 bài ở `rules.test.ts`, 1 bài ở `client.test.ts`, 1 bài ở `offline.test.ts` của BFF;
  - 409 bị bỏ âm thầm: 1 bài ở `sync.test.ts` và 4 bài ở `syncList.test.ts`.
- **Đi khác thiết kế, hoặc chi tiết thêm:**
  1. Tên tệp là `offline-cycles.mjs` và script là `e2e:cycles`, không phải `offline.mjs` (script `e2e:offline` đang trỏ tới `offline-sign.mjs`).
  2. Thêm kiểu lỗi thứ ba ngoài hai kiểu thiết kế nêu: máy sập đúng lúc in. Không có nó thì đột biến "in trước khi lưu bền" không làm lệch số đếm nào, vì bản ghi vẫn được lưu ngay sau khi in. Cách làm: mỗi lần `print()` gửi một yêu cầu đồng bộ tới bài kiểm thử kèm nguyên văn trang in; bài đóng trang trong lúc trang còn đứng yên bên trong `print()`, mở trang mới và đăng nhập lại (phiên mất theo tab, kho trên máy còn).
  3. Hạn mức FHIR của phòng khám thử được nâng lên 500.000 điểm/phút (`Project.systemSetting`, tên `userFhirQuota`). Lý do ở phát hiện 1 bên dưới.
  4. Thiết kế ghi "chờ danh sách chờ đồng bộ về 0"; bài chờ theo máy chủ (có lượt khám `finished` của bệnh nhân vừa khám), tối đa 100 giây vì bộ máy đồng bộ chờ gửi lại tới 60 giây và chạy định kỳ 30 giây.
  5. Sau một chu kỳ hỏng giữa chừng, bài dựng lại máy (có mạng, trang mới, đăng nhập lại) và chạy tiếp, rồi vẫn đếm.
  6. Khi "Ký & In" báo chưa ký được mà không in (phát hiện 3), bài bấm lại như bác sĩ sẽ làm và ghi số lần ở cuối bài. Khi hàng chờ hiện hai dòng cho cùng một lượt khám (phát hiện 5), bài bấm "Tiếp tục khám" nếu có, không thì "Gọi vào khám", và ghi lại chu kỳ đó ở cuối bài. Cả hai không làm bài đỏ: tiêu chí M0-2 tính trên bản ghi của máy chủ.
  7. Không gộp vào `pnpm e2e`: bài cần BFF và bản build riêng, còn `pnpm e2e` chạy trên BFF và giao diện demo đang mở. Script điều phối viết bằng Node để chạy được cả trên Linux lẫn Windows.
  8. Hàm trợ giúp của hai bài e2e ngoại tuyến có sẵn được tách ra `e2e/offline-helpers.mjs`; hai bài đó chuyển sang dùng tệp này.
- **Phát hiện trong lúc làm, chưa sửa (ngoài phạm vi lát này):**
  1. **Hạn mức FHIR mặc định chỉ đủ cho khoảng 20 lượt khám mỗi phút qua một tài khoản máy.** Một lượt khám đi hết đường tốn chừng 2.500 điểm (ghi 100, tìm 20) [Phân tích, từ mã]. Khi chưa nâng hạn mức, hai lần chạy đều bị Medplum trả 429 ở chu kỳ 17–18; log BFF ghi `_consumedPoints 50011, limit 50000` và BFF trả HTTP 500 bảy lần [Đã đo]. Ở cả hai lần đó số đếm cuối vẫn đúng 20/20: nhóm "gửi lại" của OFF-7 hội tụ. Hệ quả cho T6: "đồng bộ 40 ca trong 60 giây" cần khoảng 100.000 điểm trong một phút, gấp đôi hạn mức mặc định, nên T-QUOTA phải làm trước T6.
  2. **Mục "thử lại" có thể nằm chờ thêm tới 30 giây.** `SyncEngine.schedule` chỉ hẹn theo các mục có `nextAt` còn ở tương lai. Mục hết thời gian chờ ngay trong lúc một lượt gửi đang chạy thì bị bỏ qua ở lượt đó và không được hẹn lại, phải chờ chu kỳ 30 giây [Đã đọc mã]. Ở bước thử, sau khi máy sập rồi đăng nhập lại ngay, 5 mục nằm yên hơn 16 giây dù có mạng [Đã đo]. Không mất dữ liệu.
  3. **"Ký & In" có lúc báo đã giữ trên máy nhưng không in.** Xảy ra khi ký lúc ứng dụng coi là có mạng mà một thao tác trước của lượt khám còn trong thời gian chờ gửi lại. Câu báo là "Đang chờ thao tác trước đó của lượt khám này được máy chủ nhận…" hoặc "Mất kết nối. Đã giữ trên máy và sẽ tự gửi khi có mạng…". Mục ký đã vào hàng đợi và sẽ tự gửi, nhưng không có tờ đơn; bấm lại thì in. Gặp ở 1/100 chu kỳ của lần chạy 100, và 11–26 lần bấm liền ở một chu kỳ khi Medplum trả 429 [Đã đo]. Bác sĩ không bấm lại thì lượt khám được lưu mà bệnh nhân không có đơn giấy. Thiết kế sửa: mục "Thiết kế OFF-8" bên dưới (chờ duyệt).
  4. **Chế độ "Mất mạng" không tự thoát khi không còn mục chờ.** Sau một lần gọi lỗi mạng mà trình duyệt không phát sự kiện `online`, ứng dụng không còn lời gọi nào thăm dò lại máy chủ: tìm kiếm, hàng chờ và nạp trước đều chỉ gọi khi đang "có mạng". Nó chỉ thoát khi có lần ghi kế tiếp hoặc một mục chờ gửi lại thành công [Đã đọc mã; chưa đo riêng].
  5. **Hàng chờ có lúc hiện hai dòng cho cùng một lượt khám.** Sau một lần mất phản hồi ở "cấp số", máy chủ đã có lượt khám còn mục cấp số trên máy chưa được gửi lại. Nếu lúc đó máy tải được hàng chờ của máy chủ thì `mergeQueue` không biết hai thứ là một (dòng của máy chủ không mang `clientUuid`), nên hiện cả dòng của máy chủ ("Gọi vào khám") lẫn dòng tạm trên máy ("Tiếp tục khám" nếu đã mở). Hết khi mục cấp số gửi lại xong. Máy chủ vẫn chỉ có một lượt khám. Gặp ở lần chạy CI đầu tiên (hạt giống 2533173637, chu kỳ 02), không gặp ở máy dev với cùng hạt giống (hai lần chạy) [Đã đo; cơ chế: Đã đọc mã]. Bấm "Gọi vào khám" ở dòng của máy chủ sẽ mở một bản nháp trống cho lượt đang khám dở [Đã đọc mã, chưa đo].
- **Bẫy mới:**
  - Playwright: sau khi tải lại trang lúc đang `setOffline(true)`, `navigator.onLine` trở lại `true` dù mọi yêu cầu vẫn lỗi, và bật mạng lại không phát sự kiện `online` [Đã đo, playwright-core 1.63]. Các chu kỳ có tải lại trang vì thế đi qua ca "trình duyệt tưởng có mạng nhưng gọi gì cũng lỗi"; các chu kỳ khác đi qua ca trình duyệt biết mình mất mạng.
  - `route.fetch()` đi từ Node nên không chịu `setOffline`: bộ chặn phản hồi phải tự kiểm lúc đang ngắt mạng.
  - Dòng lỗi console của một yêu cầu bị cắt phản hồi đến sau khi máy chủ đã ghi xong, nên không bật tắt "lỗi được chờ đợi" theo từng bước. Mẫu `Failed to load resource` khớp cả phản hồi 4xx và 5xx; bài này chỉ chờ `net::ERR_…`.
  - Git Bash: số PID của MSYS trong tệp PID cũ có thể đã thuộc tiến trình khác. Trước khi dừng một tiến trình phải kiểm cổng và dòng lệnh của nó.
- Số đo trên máy dev: kiểu đạt 7 gói; 363 kiểm thử đơn vị (355 + 8 bài của bộ sinh kế hoạch); 41 tích hợp; e2e 13 + 24 + 13 + 12 bước trên cả bản dev và bản build; bài 20 chu kỳ 11 bước, chỉ chạy trên bản build. Gói JS không đổi: 510 KB, nén 164 KB [Đã đo, bản build].
- CI [Đã đo]: bước mới nằm trong job e2e, chạy sau bốn bài có sẵn và dùng lại bản build của job. Mỗi lần chạy một hạt giống ngẫu nhiên; dòng đầu của bước in lệnh chạy lại.
  - Lần chạy đầu (hạt giống 2533173637) đỏ ở chu kỳ 02: bộ định vị của bài gặp hai nút khi hàng chờ hiện hai dòng cho một lượt khám (phát hiện 5). Lỗi là của bài kiểm thử; 19 chu kỳ còn lại vẫn đúng số bản ghi. Đã sửa bài.
  - Lần chạy kế (hạt giống 1428297068) xanh cả ba job, bài đạt 11/11. Bước M0-2 mất 41 giây (bài 39,7 giây). Job e2e mất 3 phút 35 giây, so với 2 phút 41 giây trên `main` (commit `950823a`): tăng khoảng 1 phút.
  - Job e2e còn xa mức 10 phút nên chưa cần tách job riêng.

**Lát 6 xong (03/10/2026)** (nhãn và tài liệu; không đổi hành vi của ứng dụng ngoài chữ trên trang "Phạm vi" và dải nhãn). Tóm tắt cả sáu lát, kết quả M0-2, bài học và giới hạn nằm ở mục 5.9.
- Trang "Phạm vi": ngoại tuyến chuyển sang khối "Đã làm thật"; khối "Chưa làm ở M0" nêu phần ngoại tuyến chưa có (hai máy thấy nhau, giải quyết xung đột, chờ ký số và gửi cổng, lưu toàn bộ danh sách bệnh nhân, mã PIN). Dải nhãn: bỏ "ngoại tuyến" khỏi "Chưa có"; Zalo chuyển từ "Mô phỏng" sang "Chưa có" vì chưa có dòng mã nào về Zalo.
- `e2e/visit.mjs` bước 22 kiểm theo từng khối thay vì tìm chữ "Ngoại tuyến" ở đâu đó trên trang, và kiểm dải nhãn khớp với trang. Số bước không đổi (24).
- Đột biến (6, mỗi cái làm bài đỏ đúng ở bước 22, 21 bước trước vẫn đạt) [Đã đo, bản dev]: đưa dòng ngoại tuyến về khối "Chưa làm"; để cả hai khối cùng có; chuyển dòng sang khối "Mô phỏng"; bỏ các dòng giới hạn của ngoại tuyến; dải nhãn ghi "Chưa có: ngoại tuyến"; dải nhãn ghi Zalo là mô phỏng trong khi trang để Zalo ở "Chưa làm". Bước kiểm cũ (chỉ tìm chữ) xanh với cả sáu.
- `README.md` (dòng hiện trạng, bảng cấu trúc, đoạn ngắt mạng trên một máy trong kịch bản, mục "Giới hạn"), chú thích ở `vite.config.ts`, `styles.css`, `OfflineSignResult.tsx`, mô tả gói `clinic-web`, và các mục 2, 5.2, 5.3, 5.7 của kế hoạch.
- **Phát hiện khi rà, chưa sửa (ngoài phạm vi lát này):** bản sửa phát hiện 2 của lát 5 (commit `376bd97`, PR #7) được merge vào nhánh của lát 5 **sau** khi nhánh đó đã vào `main`, nên `main` chưa có bản sửa này [Đã đo: `git log origin/main..origin/claude/m0-s3-5-network-cycles-098118` còn 3 commit]. PR #9 (sửa phát hiện 5) còn là bản nháp và đang lấy nhánh của lát 5 làm gốc.

#### Thiết kế OFF-8: "Ký & In" lúc có mạng mà máy chủ chưa nhận ngay [Chờ duyệt] (03/10/2026)

Thiết kế cho phát hiện 3 của lát 5. **Chưa sửa mã sản phẩm, chưa sửa BFF**: mới có kiểm thử tái hiện và bản thiết kế này. Chờ chủ dự án duyệt hướng làm và trả lời bốn câu hỏi ở cuối mục.

**Hiện tượng và cơ chế [Đã đọc mã, đã tái hiện].** Ở nhánh có mạng, `OfflineClient.complete` lưu mục hoàn tất vào hàng đợi rồi gọi `engine.submit(opId, promote)`. `submit` có hai kết quả dứt điểm: máy chủ nhận (`done`, in qua máy chủ) và máy chủ từ chối (`rejected`, bỏ mục, bản nháp còn). Năm kết quả còn lại đều bị `complete` trả thành `failed` kèm một dòng lỗi, trong khi mục vẫn nằm trong hàng đợi và bộ máy vẫn tự gửi nó. `promote` (chuyển mục sang dạng ký khi mất mạng, rồi in từ máy) chỉ chạy khi chính lượt gửi đó gặp lỗi mạng: `settleFocus` thoát ngay trong mọi trường hợp khác.

| Kết quả | Khi nào | Yêu cầu hoàn tất đã tới máy chủ chưa | Nếu bác sĩ không bấm lại |
|---|---|---|---|
| `waiting` | Mục trước của lượt khám (cấp số, mở hồ sơ) đang `retry`, chưa hết thời gian chờ | Chưa | Mục trước xong thì máy tự gửi: lượt khám kết thúc trên máy chủ, không có đơn giấy |
| `offline`, chưa chuyển | Bộ máy chuyển sang "mất mạng" sau lúc `complete` còn thấy "có mạng": mạng vừa có lại, lượt gửi lại mục trước lỗi mạng đúng lúc đó | Chưa | Như trên |
| `retrying` | Chính yêu cầu hoàn tất nhận 5xx, 503 `incomplete` hoặc 429 | Rồi; máy chủ có thể đã ghi dở | Máy tự gửi lại sau 2 s · 2^(n−1): như trên |
| `paused` | Phiên hết hạn (401) | Chưa (bị chặn ở khâu xác thực) | Ứng dụng về màn hình đăng nhập ngay, nên **không còn nút nào để bấm lại**. Đăng nhập lại thì máy tự gửi: như trên |
| `held` | Mục trước đã bị máy chủ từ chối (409, lỗi khác) | Chưa | Không bao giờ gửi (M0 chưa có giải quyết xung đột). **Bấm lại cũng không in**, và máy không giữ bản đơn nào để in lại |

Mục nằm lại ở "dạng có mạng": không có id tạm của đơn (`rxTmpId`), không có bản đơn trong bảng `signed`, không có mục ghi nhận in, bản nháp chưa bị xóa. Riêng `clientTimes` thì tùy cách mở hồ sơ: mở lúc có mạng thì không có; mở bằng dữ liệu trên máy (ca `waiting` và `held` thường gặp, vì mục mở hồ sơ chưa xong) thì yêu cầu đã mang sẵn giờ ký của lần bấm.

Gốc của lỗi là một trạng thái lẽ ra không được tồn tại: **mục hoàn tất đã vào hàng đợi và sẽ tự gửi, nhưng chưa có tờ đơn, còn màn hình vẫn là màn hình khám.**

**Tái hiện [Đã đo].** 7 bài mới trong `apps/clinic-web/src/local/client.test.ts`, nhóm "TÁI HIỆN (chưa sửa)…", dùng BFF giả và đồng hồ ảo. Cả 7 xanh trên mã hiện tại (15 lần chạy liền, 0 lần đỏ). Chúng ghi lại hành vi hiện tại, tức là lỗi; khi sửa thì đổi kỳ vọng theo phần "Kiểm thử" bên dưới.

1. `waiting`: mục mở hồ sơ gặp 503 hai lần, còn 4 giây mới gửi lại. Ký: "Đang chờ thao tác trước đó…", 0 lần in, yêu cầu hoàn tất chưa gửi lần nào. Cho thời gian trôi 4 giây: máy chủ có lượt khám `done`, bản nháp bị xóa, vẫn 0 lần in và máy không có bản đơn.
2. Cùng tình huống, bấm lại sau khi mục trước xong: máy chủ nhận (đường "bấm lại thì in được").
3. `offline` chưa chuyển: yêu cầu gửi lại mục mở hồ sơ đang đi thì bác sĩ ký, rồi yêu cầu đó lỗi mạng. Ký: "Mất kết nối. Đã giữ trên máy…", 0 lần in; sau đó máy tự gửi, lượt khám `done`.
4. `retrying`: yêu cầu hoàn tất gặp 503. 0 lần in, mục ở trạng thái `retry` và không có `clientTimes`; 2 giây sau máy gửi lại (2 yêu cầu cùng `clientUuid`), lượt khám `done`.
5. `paused`: 401 lúc ký. 0 lần in; đổi token (đăng nhập lại) thì bộ máy gửi ngay, lượt khám `done`.
6. `held`: mục mở hồ sơ đang xung đột (người khác đang khám). Bấm hai lần đều báo lỗi, 0 lần in, 0 yêu cầu hoàn tất, máy không có bản đơn.
7. Liên quan tới rủi ro 503: ký gặp 503, rồi mất mạng, ký lại. Nhánh mất mạng chuyển luôn mục đã tới máy chủ sang giờ ký mới của máy khách. Quy tắc "không đổi giờ ký sau 503" của lát 3b-1 vì thế hiện chỉ được giữ ở `submit`, không được giữ ở đường này.

Sau khi thêm 7 bài: kiểu đạt 7 gói, 370 kiểm thử đơn vị (363 + 7) [Đã đo]. Chưa chạy lại bài e2e 100 chu kỳ; hai số đo 1/100 chu kỳ và 11–26 lần bấm là của lát 5.

**Bất biến phải đạt (K).** Khi `complete()` trả về, không có mục hoàn tất nào vừa còn tự gửi được, vừa chưa có tờ đơn và chưa có bản đơn in lại được trên máy. "Ký & In" chỉ được kết thúc bằng một trong ba cách:

1. máy chủ nhận, in qua máy chủ;
2. đã lưu bền trên máy ở dạng ký khi mất mạng, in từ máy, màn hình chuyển sang kết quả ký;
3. không lưu được hoặc máy chủ từ chối: không in, hàng đợi không có mục hoàn tất nào của lượt này, màn hình khám còn nguyên và nói rõ "CHƯA in".

K giữ nguyên N1 (cách 2 lưu bền rồi mới in), N2 (cùng mục, cùng `clientUuid`), N3 (không có kết quả nào im lặng) và không cần nút xóa mục chưa đồng bộ.

**Phương án A: máy chủ chưa nhận ngay thì ký như khi mất mạng.**

- Mọi kết quả chưa dứt điểm đi cùng một đường với ký khi mất mạng: trong **một** giao dịch, chuyển mục sang dạng ngoại tuyến (`clientTimes`, `rxTmpId`; cùng id, cùng `clientUuid`), ghi bản đơn để in lại, ghi mục ghi nhận in, xóa bản nháp; sau đó mới in từ máy, có nhãn; màn hình kết quả ký theo dõi mục (chờ đồng bộ, đã đồng bộ, bị giữ, xung đột, chờ xác nhận) như đã có từ lát 3b-2.
- Giờ ký là giờ của lần bấm, đã tính trước lần gửi đầu tiên. Việc chuyển không sinh giờ mới.
- Việc chuyển làm **trong bộ máy đồng bộ, lúc đang giữ khóa**, như ca lỗi mạng hiện nay; không làm ở `complete` sau khi `submit` trả về. Làm sau thì một lượt gửi nền có thể chen vào gửi bản cũ. Nếu bản cũ được máy chủ nhận trước khi kịp chuyển, mục ghi nhận in sẽ mang một id tạm không bao giờ có ánh xạ và nằm mãi trong hàng đợi [Đã đọc mã: `effectsOf` chỉ ghi ánh xạ khi mục mang `rxTmpId` lúc gửi].
- Kết thúc khám không kê đơn đi cùng đường, chỉ không có bước in.
- Không sửa BFF: máy chủ nhận một yêu cầu y như yêu cầu ký khi mất mạng đã có kiểm thử tích hợp.

Rủi ro của A:

1. **Mục đã tới máy chủ (ca `retrying`).** Xem riêng ở dưới.
2. Tờ đơn mang nhãn "KÝ KHI MẤT MẠNG: chưa đồng bộ lên hệ thống, chưa liên thông" cả khi phòng khám đang có mạng và máy chủ nhận sau đó vài giây. Vế "chưa đồng bộ, chưa liên thông" đúng tại lúc in; vế "mất mạng" thì không.
3. Các lượt này được đo thời gian khám bằng đồng hồ máy khách (nguồn `client`) và nhật ký ghi `queryKind: 'offline'`, dù lúc đó có mạng. Đúng theo OFF-3, nhưng cột "Đo ở máy khám" sẽ gồm cả chúng.
4. `held`: in một đơn cho lượt khám mà hệ thống đã biết là đang xung đột. Kết cục giống hệt ca "ký khi mất mạng rồi mới biết xung đột" mà OFF-7 đã chấp nhận (đơn giữ trên máy, in lại được, báo đỏ), chỉ khác là lần này biết trước khi in.
5. `paused`: tờ đơn in ra khi ứng dụng đang chuyển về màn hình đăng nhập. Việc chuyển mục phải ghi xong trước khi kho bị đóng theo phiên; thứ tự này phụ thuộc React [Chưa đo]. Thua cuộc đua thì rơi về hành vi hiện nay.
6. Sửa vào bộ máy đồng bộ, lõi của "0 mất, 0 trùng": phải chạy lại toàn bộ đột biến của lát 3b và 4, và bài 20 chu kỳ.

**Phương án B: giữ luồng, nói rõ "CHƯA in, bấm lại để in", đánh dấu trong danh sách chờ đồng bộ.**

- Đổi câu báo; dòng của mục trong danh sách "Chờ đồng bộ" có nhãn "chưa in".
- Rủi ro: vẫn trông vào việc bác sĩ đọc và bấm lại. Bác sĩ bỏ đi thì kết cục như hiện nay.
- Không cứu được `paused` (màn hình khám đã mất) và `held` (bấm lại không in, máy không có bản đơn).
- Khi máy chủ lỗi kéo dài (429, Medplum dừng mà BFF còn chạy) bác sĩ không in được đơn nào, tệ hơn cả lúc mất mạng hẳn: 11–26 lần bấm đã đo vẫn còn nguyên.
- Mục xong thì rời danh sách, nên nhãn "chưa in" mất theo. Muốn nhãn sống tới khi in thật thì phải thêm trạng thái "đã ký, chưa in" lưu trên máy, thông báo riêng và nút in từ thông báo: nhiều việc giao diện hơn A mà bảo đảm yếu hơn.
- Ưu điểm: không đụng bộ máy đồng bộ, không đổi nội dung của bất kỳ mục nào.

**Phương án C: xử lý mục trước rồi mới quyết định.**

- **C1, đẩy mục trước ngay.** Khi một mục đang được người dùng chờ kết quả, các mục trước của nó bỏ qua thời gian chờ gửi lại trong lượt gửi đó (giống "Đồng bộ ngay" nhưng chỉ cho chuỗi của lượt khám này). Máy chủ đã hồi thì mục trước xong, yêu cầu hoàn tất được gửi và nhận ngay: ký có mạng bình thường, giờ máy chủ, không nhãn.
- **C2, chờ có giới hạn.** Giữ nút ở "Đang lưu…" tối đa vài giây cho bộ máy tự gửi lại, rồi mới quyết định.
- Cả hai chỉ giảm số ca, không đóng được K: mục trước lại lỗi, `held`, `paused`, hoặc máy chủ lỗi lâu hơn thời gian chờ thì vẫn phải rơi về A hoặc B.
- Rủi ro C1: mỗi lần bấm ký thêm tối đa một yêu cầu cho mỗi mục trước, bỏ qua thời gian chờ lũy thừa (không đáng kể khi A làm cho chỉ còn một lần bấm).
- Rủi ro C2: thêm bộ hẹn giờ và trạng thái chờ ở màn hình khám; bác sĩ chờ vô ích khi máy chủ lỗi dài (cửa sổ hạn mức 429 là một phút); thêm kiểm thử hẹn giờ.

**Loại:**

- Tự gỡ mục khỏi hàng đợi khi không in ("không in thì cũng không gửi"): không áp dụng được cho mục máy chủ có thể đã ghi dở, đi ngược N1, và bác sĩ vẫn phải bấm lại.
- In từ máy nhưng giữ nguyên yêu cầu ở dạng có mạng: giấy ghi giờ bấm, còn bản ghi lấy giờ máy chủ của lần gửi lại thành công. Máy chủ lỗi càng lâu thì lệch càng lớn; qua nửa đêm thì mã trên giấy không có trên máy chủ.
- Cố định giờ ký ở máy khách cho mọi lần ký, kể cả lúc có mạng: gọn nhất về lâu dài, nhưng phải sửa BFF và đổi nghĩa của số đo "đo ở máy chủ" (OFF-3). Để lại cho M1 cùng T-SIGN.

**Khuyến nghị: A, kèm C1 trong cùng lát.** A là phương án duy nhất đưa cả năm kết quả về K (trừ các ca hiếm ở "Rủi ro còn lại"); C1 là thay đổi nhỏ giúp ca đo được ở lát 5 (mục trước đang chờ gửi lại, máy chủ đã hồi) đi đường có mạng bình thường thay vì mang nhãn mất mạng. Không làm C2. Phần "nói rõ CHƯA in" của B chỉ dùng làm câu báo cho các ca còn lại mà A không chuyển được (xem "Rủi ro còn lại").

**Mục đã tới máy chủ (`retrying`): cân nhắc riêng, vì lát 3b-1 đã quyết không đổi giờ ký sau 503.** Lý do khi đó: máy chủ có thể đã ghi dở với giờ của nó, đổi sang giờ máy khách có thể làm lệch mã đơn giữa các phần đã ghi. Đọc lại mã cho thấy rủi ro này có thật nhưng hẹp hơn mô tả, và đã có sẵn ở các đường khác:

- Giờ ký của máy khách được tính trước lần gửi đầu, trong cùng một lần `complete()`. Nó và giờ máy chủ của lần ghi dở là **cùng một thời điểm đọc trên hai đồng hồ**: chênh nhau bằng độ lệch đồng hồ cộng độ trễ mạng [Đã đọc mã].
- Đường gửi lại hiện nay của mục dạng có mạng còn lệch hơn thế: mỗi lần gửi lại, máy chủ lấy giờ mới làm giờ ký (`routes/clinical.ts`), nên các phần ghi ở lần 1 và lần 2 cách nhau đúng bằng thời gian chờ gửi lại, 2 đến 60 giây hoặc lâu hơn [Đã đọc mã]. Sau khi chuyển, mọi lần gửi lại mang cùng một giờ ký, nên không lệch thêm.
- Nhánh mất mạng đã đổi giờ ký của mục đã tới máy chủ (bài tái hiện 7) [Đã đo].
- Cái hỏng thật sự chỉ xảy ra khi hai đồng hồ **khác ngày** (giờ Việt Nam): mã đơn tính theo ngày ký, và nằm ở ba nơi (`MedicationRequest.groupIdentifier`, `List.identifier`, `Task.identifier`) [Đã đọc mã]. Ghi dở với mã ngày này rồi ghi nốt với mã ngày khác cho ra một đơn mang hai mã, không có kiểm tra nào hiện nay phát hiện.

Hai lựa chọn:

- **A-1 (khuyến nghị): vẫn chuyển, có hàng rào ngày.** Chỉ chuyển mục đã tới máy chủ khi ngày theo giờ ký của máy khách trùng ngày theo giờ máy chủ lúc trả lỗi (tiêu đề `Date` của phản hồi lỗi). Khác ngày, hoặc không đọc được `Date`, thì không chuyển, không in, báo "CHƯA in". Ca hai mã bị chặn; phần còn lại là độ lệch vài giây giữa các mốc thời gian, nhỏ hơn mức đường gửi lại hiện nay đã có. Cần `api.ts` giữ lại tiêu đề `Date` của phản hồi lỗi. [Chưa đo: tiêu đề này có tới trình duyệt qua proxy của Vite và qua bản build hay không.]
- **A-2: không chuyển mục đã tới máy chủ.** Giữ nguyên quy tắc lát 3b-1; ca này không in và báo "CHƯA in, máy chủ đang lỗi, bấm lại". Hiện tượng còn nguyên ở đúng nơi đã đo 11–26 lần bấm, và khi Medplum dừng mà BFF còn chạy thì không in được đơn nào dù máy chủ chưa ghi gì.

Cách sửa tận gốc nằm ở BFF: gói hoàn tất đọc lại giờ ký và mã của phần đã ghi trước khi ghi nốt. Việc này đóng luôn ca gửi lại qua nửa đêm của đường có mạng. Ngoài phạm vi OFF-8, ghi vào T-IDEM.

**Chi tiết của phương án khuyến nghị (A + C1 + A-1).**

- `SyncEngine`:
  - `settleFocus` chuyển mọi mục đang được chờ kết quả mà cuối lượt gửi chưa xong và chưa bị từ chối, không chỉ khi lỗi mạng; kể cả ở hai lối ra sớm (phiên không phải chủ kho, đang chờ đăng nhập lại).
  - `promote` nhận thêm thông tin "máy chủ đã trả lỗi cho mục này chưa" và giờ máy chủ của lần lỗi đó, và được phép từ chối chuyển.
  - Kết quả của `submit` cho biết mục đã được chuyển hay chưa.
  - C1: trong lượt gửi, mục trước (qua mọi bậc) của một mục đang được chờ kết quả cũng bỏ qua `nextAt`.
- `OfflineClient.complete`: sau `submit`, `done` và `rejected` như cũ; mọi kết quả khác mà mục đã chuyển thì in từ máy và trả `offline`; chưa chuyển thì trả `failed` với một câu duy nhất có chữ "CHƯA in". Nhánh mất mạng dùng chung hàm chuyển, nên cùng chịu hàng rào ngày.
- `checkIn` và `openVisit` bỏ lần ghi lại mục sau `submit`: bộ máy đã chuyển trong lúc giữ khóa. Lần ghi lại hiện nay còn đặt `nextAt` về 0, nên mục vừa bị máy chủ trả lỗi tạm sẽ được gửi lại ở lượt gửi kế tiếp bất kỳ, không chờ hết thời gian chờ [Đã đọc mã].
- Màn hình kết quả ký khi mất mạng dùng lại nguyên: đã có trạng thái chờ, bị giữ, xung đột, chờ xác nhận và nút in lại.
- Tệp dự kiến sửa: `local/sync.ts`, `local/client.ts`, `api.ts`, kiểm thử và e2e. Không sửa BFF, không sửa gói in (nếu giữ nhãn, câu hỏi 4).

**Rủi ro còn lại sau khi làm** (K không đúng ở các ca này; màn hình phải nói rõ "CHƯA in"):

1. Hàng rào ngày từ chối (A-1): mục đã tới máy chủ, hai đồng hồ khác ngày. Mục vẫn tự gửi.
2. Lỗi kép: máy chủ chưa nhận **và** kho trên máy không ghi được lúc chuyển (đầy bộ nhớ). Mục dạng có mạng đã lưu từ trước nên vẫn tự gửi.
3. 401 lúc ký mà kho đóng trước khi kịp chuyển [Chưa đo]. Đo bằng e2e; nếu xảy ra thật thì phải cho việc về màn hình đăng nhập chờ bộ máy xong lượt đang chạy.
4. Trình duyệt sập hoặc bị tải lại giữa lúc lưu mục và lúc có kết quả: mở lại thì mục tự gửi, không có tờ đơn, không có dấu "chưa in". Cùng loại với "máy sập đúng lúc in" mà lát 5 đã ghi nhận; A không đóng lỗ này. Hướng xử lý chung là một dấu "đã ký, chưa in" trên bản đơn giữ ở máy kèm thông báo: ngoài phạm vi OFF-8.

**Kiểm thử và tiêu chí chấp nhận (khi được duyệt).**

- Đổi kỳ vọng của 7 bài tái hiện:
  - bài 1: máy chủ đã hồi thì C1 đẩy mục mở hồ sơ, kết quả `online`, không cần bấm lại; thêm biến thể mục trước lỗi tiếp: `offline`, in đúng một lần **sau** khi mục, bản đơn và mục ghi nhận in đã nằm trong kho, bản nháp đã xóa; đồng bộ xong có đúng 1 lần hoàn tất và 1 dòng ghi nhận in;
  - bài 2 bỏ (không còn đường "bấm lại");
  - bài 3, 5, 6: `offline`, in đúng một lần; bài 6 thêm: mục bị giữ, in lại được từ danh sách chờ đồng bộ;
  - bài 4: `offline`, in đúng một lần, giờ ký trong mục là giờ bấm, 2 yêu cầu cùng `clientUuid`; thêm hai biến thể hàng rào ngày (khác ngày; không có `Date`): `failed` có "CHƯA in", mục giữ nguyên dạng;
  - bài 7: nhánh mất mạng chịu cùng hàng rào.
- Bài mới ở `sync.test.ts`: chuyển trong lúc giữ khóa khi hai tab cùng mở; C1 không đẩy mục của lượt khám khác; mục bị từ chối không bao giờ bị chuyển.
- Đột biến, mỗi cái phải làm ít nhất một bài đỏ: chỉ chuyển khi lỗi mạng (hành vi hiện nay); chuyển ngoài khóa; in trước khi ghi; sinh `clientUuid` mới khi chuyển; lấy giờ ký lúc chuyển thay cho giờ bấm; bỏ hàng rào ngày; C1 đẩy mọi mục; trả `failed` mà không có chữ "CHƯA in".
- e2e:
  - `offline-cycles.mjs` đang ghi số lần "Ký & In" báo chưa ký được: đổi thành bước kiểm, phải bằng 0. Chạy 100 chu kỳ với hạt giống 558698034 và một lần 20 chu kỳ không nâng hạn mức FHIR (ca 429): mỗi chu kỳ đúng một lần in, 11 bước cũ vẫn đạt.
  - `offline-sign.mjs` thêm ca máy chủ trả 503 cho yêu cầu hoàn tất (giả lập bằng `page.route`): in một lần, PDF một trang A5, đồng bộ xong có đúng một đơn, mã trùng mã đã in.
  - `offline-conflict.mjs` thêm ca 401 đúng lúc ký (rủi ro còn lại 3).

**Câu hỏi cần chủ dự án quyết:**

1. Duyệt hướng **A kèm C1**, hay chọn B, hay chỉ A?
2. Mục đã tới máy chủ (5xx, 503, 429): **A-1** (vẫn chuyển, có hàng rào ngày; khuyến nghị) hay **A-2** (không chuyển, báo "CHƯA in", giữ đúng quy tắc lát 3b-1)?
3. `held` (đã biết xung đột trước khi ký) và `paused` (hết phiên đúng lúc ký): in như ký khi mất mạng (khuyến nghị, nhất quán với OFF-6 và OFF-7), hay không in?
4. Nhãn trên giấy: giữ "KÝ KHI MẤT MẠNG: chưa đồng bộ lên hệ thống, chưa liên thông" cho M0 (khuyến nghị; chỉ đổi tiêu đề màn hình kết quả thành "Đã ký đơn, chờ máy chủ nhận" khi đang có mạng), hay đổi nhãn trên giấy thành câu trung tính "CHƯA ĐỒNG BỘ…" (phải sửa gói in và các bài kiểm trang in)?

**Phát hiện thêm trong lúc thiết kế, chưa sửa:**

1. `paused` và `held` nặng hơn mô tả ban đầu của phát hiện 3: ở hai ca này bấm lại không có tác dụng (xem bảng).
2. Sau khi "Ký & In" báo lỗi mà mục còn trong hàng đợi, màn hình khám vẫn sửa được. Nếu bác sĩ sửa đơn rồi ký lại sau khi máy đã tự gửi xong mục cũ, lần ký lại trả kết quả cũ và in **đơn cũ**, khác với màn hình [Đã đọc mã, chưa đo]. A làm đường này biến mất, trừ các ca ở "Rủi ro còn lại".
3. Rủi ro còn lại 4 (sập giữa lúc lưu và lúc có kết quả) có từ lát 3b, không do OFF-8 sinh ra.

**Quyết định của chủ dự án (02/10/2026):**

1. **Không dùng mã PIN cho kho cục bộ ở M0** (lý do ở OFF-5).
2. **Chấp nhận giới hạn N5 cho M0.** Kịch bản 4 trên sân khấu làm đoạn ngắt mạng trên một máy (bác sĩ tự tiếp đón người mới đến). Để hai máy thấy nhau khi mất Internet cần một trạm đồng bộ trong mạng LAN của phòng khám: ngoài M0, thuộc T-OFF-3.

Các điểm mặc định đã nêu và được duyệt cùng thiết kế: số tạm được ưu tiên giữ (OFF-2); giờ không hợp lý thì vẫn lưu, chỉ không tính số đo (OFF-3); đơn ngoại tuyến bị quy tắc chặn khi đồng bộ thì chờ bác sĩ xác nhận (OFF-7); đăng xuất khi còn mục chờ thì giữ dữ liệu đã mã hóa thay vì xóa (OFF-6).

### 5.9 Trạng thái M0-S3 (cập nhật 04/10/2026)

M0-S3 (02–13/11) được làm trước lịch, ngay sau M0-S2. Phần ngoại tuyến xong qua sáu lát: lát 1–3b (PR #2), lát 4 (PR #4), lát 5 (PR #6), lát 6 (nhãn và tài liệu). Các việc còn lại của M0-S3 theo mục 5.5 cần người thật hoặc chưa làm; bảng dưới gồm cả hai. Thiết kế (N1–N5, OFF-1 đến OFF-7) và chi tiết từng lát nằm ở mục 5.8, không chép lại ở đây. Mọi con số chỉ nói về một máy dev và runner CI, dữ liệu giả, Chromium không giao diện: **chưa có bác sĩ thật dùng thử, chưa thử trên máy tính bảng hay trình duyệt khác**.

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| In khi mất mạng (OFF-1) | Xong | Gói `@phongmach/print` dùng chung cho BFF và trình duyệt. Trang in dựng ở trình duyệt giống từng ký tự trang BFF dựng, trừ dòng liên thông; mã đơn sinh ở máy khách trùng mã máy chủ tính lại; PDF đúng 1 trang A5; trang in có nhãn "KÝ KHI MẤT MẠNG" |
| Số thứ tự tạm (OFF-2) | Xong | Số tạm = số lớn nhất máy biết + 1, có nhãn "(tạm)" ở hàng chờ và màn hình chờ. Máy chủ giữ số tạm nếu còn trống; đã có người lấy thì cấp số kế tiếp và giao diện báo đổi số (kiểm thử tích hợp, e2e) |
| Đồng hồ phiên khám khi mất mạng (OFF-3) | Xong | `measureVisit`: thời lượng theo đồng hồ máy khách, máy chủ kiểm tra hợp lý. Giờ không hợp lý thì vẫn lưu lượt khám, không tính vào p50/p90, đếm riêng ở trang "Thời gian khám" |
| Tìm bệnh nhân trên máy (OFF-4) | Xong | Bộ đệm mã hóa gồm người trong hàng chờ hôm nay, hồ sơ đã mở trong ngày, bệnh nhân tạo trên máy; nạp trước qua `GET /api/queue/prefetch`. Máy chưa có dữ liệu dị ứng thì quy tắc `allergy-unknown` đòi bác sĩ xác nhận, và máy chủ chạy lại quy tắc với dị ứng thật khi đồng bộ |
| Kho trên máy có mã hóa (OFF-5) | Xong, **không có mã PIN** (quyết định 02/10) | IndexedDB (Dexie), AES-GCM 256 bit, khóa không xuất được, mỗi (phòng khám, người dùng) một kho. Các bài e2e đọc thẳng IndexedDB: không có tên, số điện thoại, CCCD, triệu chứng, thuốc, mã ICD ở dạng rõ. Khóa nằm cùng máy với dữ liệu: xem giới hạn (g) |
| Hàng đợi đồng bộ, phiên hết hạn (N1–N3, OFF-6) | Xong | Lưu bền rồi mới gửi, rồi mới in; một thao tác một `clientUuid`; gửi theo phụ thuộc, chờ lũy thừa 2 có trần 60 giây; một tab gửi (Web Locks). 401 thì tạm dừng, không xóa mục nào; đăng xuất khi còn mục chờ thì giữ kho đã mã hóa; không có nút xóa hay hủy mục chưa đồng bộ |
| Quyền và mục bị từ chối khi đồng bộ (OFF-7) | Xong phần **phát hiện và báo**; giải quyết xung đột ngoài M0 | 409: giữ bản khám trên máy, in lại được, không gửi lại, không ghi đè. 422 quy tắc: bác sĩ ghi lý do rồi gửi lại cùng `clientUuid`. Lỗi khác: hiện nguyên thông điệp. Bài e2e hai máy `offline-conflict.mjs` (12 bước) |
| Chỉ báo mạng, danh sách "Chờ đồng bộ", thông báo | Xong | `SyncBar`, `SyncPanel`: "Có mạng" hoặc "Mất mạng", số mục chờ ("đang đếm" trước lần đếm đầu), huy hiệu "N cần xử lý" không tắt được, thông báo có họ tên không hiện ở màn hình chờ |
| Bài 20 chu kỳ ngắt và khôi phục mạng (M0-2) | **Đạt** | Xem "Kết quả M0-2" bên dưới |
| Nhãn và tài liệu sau ngoại tuyến (M0-5) | Xong | Trang "Phạm vi" và dải nhãn nói đúng hiện trạng theo cả hai chiều; `e2e:visit` bước 22 (bước 23 từ M0-ZALO) kiểm từng khối, 6 đột biến đều đỏ ở đúng bước đó (mục 5.8, "Lát 6 xong") |
| Màn hình nhật ký truy cập cho quản trị | Xong từ M0-S1 | Mục 5.6 |
| Đo M0-3: tìm bệnh nhân qua BFF trên 20.000 bệnh nhân | **Tốc độ đạt, tính đúng chưa đạt** | p95 tuần tự 23–30 ms cho 4 số cuối và tên không dấu (ngưỡng 200 ms). Người cần tìm vắng mặt dù không quá 20 người khớp: 4 số cuối 1–2/200 truy vấn (9/50 ca khó), tên hai từ 4/124 và 9/119, đủ họ tên 1/193. Nguyên nhân, cấu hình máy và hướng sửa ở mục 2 ("Tìm bệnh nhân qua BFF"); chưa sửa mã |
| Zalo mô phỏng (nút, bản xem trước tin nhắn) | Xong (M0-ZALO, PR #11) | Nút có huy hiệu MÔ PHỎNG ở màn hình kết quả ký, cả khi có mạng lẫn khi ký lúc mất mạng; hộp thoại ghi "MÔ PHỎNG: không có tin nhắn nào được gửi". Tin không có thuốc hay chẩn đoán, số nhận đã che; bài e2e ghi mọi yêu cầu mạng từ lúc bấm tới lúc đóng. Trang "Phạm vi" và dải nhãn đưa Zalo trở lại "Mô phỏng". Xem đoạn "M0-ZALO" bên dưới |
| Phiên thử với 3 bác sĩ (M0-1) | **Chưa**: cần người thật | Đồng hồ phiên khám và trang số đo đã có (mục 5.7) |
| Kịch bản 10 phút, bản dự phòng, diễn tập hai lần (M0-6) | **Chưa** | `README.md` có các bước đi qua bằng tay, gồm đoạn ngắt mạng trên một máy; chưa có bài diễn tập tự động, video hay máy dự phòng |
| T6 đầy đủ (100 chu kỳ, đồng bộ 40 ca trong 60 giây) | **Chưa** | Một lần chạy 100 chu kỳ đạt; vế "40 ca trong 60 giây" chưa đo và cần T-QUOTA trước (bài học 6) |
| Nhiều lời ghi tới cùng lúc (xung đột giao dịch của Medplum, F13) | Xong (PR #14) | Tạo bệnh nhân, cấp số, dị ứng, tiền sử: BFF thử lại có giới hạn, hết lượt trả 503 `busy`. Hoàn tất lượt khám ghi theo bước, đóng lượt khám sau cùng: 3, 5, 12 lượt ký cùng lúc từ 5/24, 12/25, 20/24 lượt thiếu bản ghi xuống 0. Xem đoạn "Ghi cùng lúc" bên dưới |

**M0-ZALO (03/10/2026, PR #11).** Thiết kế được chủ dự án duyệt cùng ngày, gồm ba điểm chốt: e2e lọc đúng các yêu cầu nền của màn hình thay vì đổi ứng dụng cho dễ kiểm; che số còn 3 số đầu và 3 số cuối; thêm một bước vào `offline-sign.mjs`.

- Hàm thuần `zaloPrescriptionMessage` (`packages/clinical/src/zalo.ts`, dùng chung cho giao diện và BFF) nhận cả đơn nhưng chỉ lấy năm trường: tên phòng khám, tên bệnh nhân, mã đơn, ngày kê (giờ Việt Nam) và đường dẫn xem đơn (M0 ghi "(đường dẫn sẽ có ở M1)"). Số nhận che bằng `maskPhone` (`091****678`); số không hợp lệ thì không hiện gì. M1 dùng `params` làm tham số mẫu ZNS. Mỗi trường bỏ ký tự điều khiển, xuống dòng, ký tự đảo chiều và độ rộng 0: tên do người dùng nhập không thêm được dòng nào vào tin (ví dụ một dòng "Xem đơn tại:" giả).
- Thành phần `ZaloPreview` chỉ nhận đơn và tên phòng khám, không nhận token hay hàng đợi. Vì vậy nó không gọi mạng, không ghi hàng đợi đồng bộ, không sinh dòng nhật ký truy cập, và mở được khi mất mạng [Đã đọc mã]. Hộp thoại chỉ có nút "Đóng" (Esc cũng đóng) và ghi lý do không có thuốc hay chẩn đoán.
- Kiểm thử: 47 kiểm thử đơn vị cho hàm dựng tin (nội dung; ngày theo giờ Việt Nam; 27 chuỗi không được có mặt: thuốc, cách dùng, chẩn đoán, lời dặn, lý do xác nhận, mã quốc gia, bác sĩ ký, CCCD, ngày sinh; che số với 5 dạng số và 4 chuỗi không hợp lệ; thoát ký tự); 7 kiểm thử thành phần (nhãn, che số, thẻ HTML hiện dạng chữ, chỉ có nút "Đóng"). `e2e:visit` bước 12 (bấm nút, nhãn, số đã che, không thuốc hay chẩn đoán, không yêu cầu mạng) và bước 23 (Zalo đúng khối trên trang "Phạm vi", dải nhãn khớp). `e2e:offline` bước 8 (mất mạng: mở được, đúng 0 yêu cầu).
- Cách kiểm "không yêu cầu mạng" khi có mạng [Đã đọc mã]: màn hình kết quả ký tự hỏi trạng thái liên thông mỗi 2 giây, và máy tải lại hàng chờ, nạp trước hồ sơ mỗi 30 giây. Bài ghi mọi yêu cầu của trang (mọi địa chỉ, mọi phương thức) từ lúc bấm tới lúc đóng và chỉ bỏ qua đúng các GET đó: `/api/prescriptions/<id của đơn này>`, `/api/queue`, `/api/queue/prefetch`. Khi mất mạng không còn việc nền nào (hàng đợi không gửi khi trình duyệt báo mất mạng), nên bài đòi đúng 0.
- Đột biến (12) [Đã đo, bản dev, mỗi lần đếm số bài thật sự chạy]. Bốn đột biến prompt yêu cầu đều đỏ: bỏ nhãn trong hộp thoại (1 kiểm thử thành phần, `e2e:visit` bước 12, `e2e:offline` bước 8); đưa tên thuốc vào tin (6 kiểm thử đơn vị, 1 thành phần, bước 12); hiện số đầy đủ (9 đơn vị, 1 thành phần, bước 12, bước 8); bấm nút thì gọi `POST /api/zalo/send` (bước 12 và bước 8; kiểm thử thành phần vẫn xanh vì không bấm được nút trong HTML tĩnh). Thêm bảy đột biến: bỏ huy hiệu MÔ PHỎNG trên nút (thành phần, bước 12); bỏ lọc ký tự định dạng và ký tự điều khiển (1 đơn vị: phép gộp khoảng trắng vẫn chặn được xuống dòng, nên bài xuống dòng xanh là đúng); bỏ hẳn bộ lọc (4 đơn vị); hiển thị dòng tin dạng HTML (thành phần); dải nhãn ghi "Chưa có: Zalo"; trang "Phạm vi" bỏ Zalo khỏi "Mô phỏng"; khối "Chưa làm" ghi "Gửi đơn qua Zalo" là chưa làm (ba cái cuối đỏ ở bước 23).
- **Điểm mù đã đo:** đột biến gọi `GET /api/queue` khi bấm nút (trùng một yêu cầu nền) làm bước 12 xanh. Bài chỉ đỏ ở bước cuối (lỗi 401 trong console) vì lời gọi đó không có token. Một lời gọi trùng hệt yêu cầu nền và có token thì không bài nào bắt được [Phân tích]. Chấp nhận, vì thành phần không có token để gọi.
- Đi khác thiết kế: (1) sửa phép đếm của `e2e:visit` (bấm đúp) và `e2e:offline` (mất phản hồi khi ký) thành so tập id lượt khám, commit riêng. Hai bước này đếm bằng độ dài danh sách mà BFF giới hạn 50 lượt; bệnh nhân demo "Nguyễn Văn An" đã có 50 lượt sau nhiều lần chạy e2e trên máy dev, nên `e2e:offline` hỏng ở bước đó dù ứng dụng đúng. CI dựng cơ sở dữ liệu mới nên không gặp. Việc này ngoài phạm vi prompt nhưng chặn việc kiểm trên máy dev. (2) Thêm bước vào `offline-sign.mjs` (chủ dự án đồng ý).
- Câu chữ của tin ("Kính gửi Quý khách …, Phòng khám đã kê đơn thuốc cho Quý khách ngày …") mới do đội viết, chưa ai ngoài đội duyệt. Giới hạn độ dài tham số của mẫu ZNS chưa biết [Chưa kiểm chứng]; hàm hiện không cắt chuỗi.
- **Phát hiện ngoài phạm vi [Đã đo, 1 lần ở CI]; đã sửa ở PR #14, xem đoạn "Ghi cùng lúc" bên dưới.** Lần chạy CI của commit tài liệu `602da88` (mã giống hệt `9eed4b5`, vốn đã xanh cả ba job) đỏ ở job tích hợp: bài "cấp số tăng dần…" tạo ba bệnh nhân cùng lúc và một lời `POST /api/patients` nhận 500. Log Medplum cho thấy giao dịch `serializable` của lời tạo có điều kiện đó xung đột với hai lời kia, được thử 3 lần rồi bỏ ("Transaction failed final attempt"). BFF không thử lại và trả mọi lỗi không phải 4xx thành 500. Đây là lần đầu thấy lỗi này trong 34 lần chạy CI của kho. Với người dùng [Phân tích]: hai người tạo bệnh nhân cùng lúc có thể gặp một lỗi 500; gửi lại cùng `clientUuid` thì không tạo trùng (T-IDEM), còn giao diện xử lý lỗi 500 này ra sao thì [Chưa kiểm chứng]. Đề xuất [Đề xuất]: BFF thử lại lời ghi có `clientUuid` khi Medplum báo xung đột giao dịch. Không nên sửa bằng cách cho bài kiểm thử tạo tuần tự, vì như thế chỉ giấu hành vi này.

**Ghi cùng lúc: xung đột giao dịch của Medplum (04/10/2026, PR #14).** Xuất phát từ lần CI đỏ ghi ở đoạn M0-ZALO. Thiết kế ngắn được chủ dự án duyệt ngày 03/10 trước khi viết mã; hai điểm nảy sinh khi đo (đường hoàn tất, cấp số hết vòng) được hỏi và duyệt riêng ngày 04/10. Mọi số dưới đây đo trên máy dev, stack Medplum dùng chung (CSDL đã có nhiều dữ liệu), một bản BFF, dữ liệu giả.

- **Tái hiện [Đã đo].** N lời `POST /api/patients` cùng lúc trên một phòng khám tạm: 3 lời 0/30, 10 lời 3/40, 20 lời 22/80 nhận 500; gọi thẳng kho: 3, 5, 10 lời 0/135, 20 lời 5/60. 40 lời không đo được: tài khoản máy của phòng khám tạm cạn hạn mức 50.000 điểm/phút sau khoảng 150–270 lời tạo, và 429 cũng thành 500. Cấp số 2, 3, 5 lời cùng lúc: 0/90, không trùng số. Mở hồ sơ 12 lời cùng lúc (`updateResource` + `If-Match`): 60/60 đạt, nên các lời cập nhật không được bọc.
- **Medplum trả gì [Đã đo].** `OperationOutcomeError`, `outcome.id = "conflict"`, `issue[0].details.coding[0].code = "40001"` (HTTP 409). Log Medplum của đúng khoảng đo: 30 dòng "Transaction failed final attempt" cho 30 lỗi BFF thấy; mỗi lời được thử 3 lần, gốc 50 ms. 0/5 lời hỏng để lại bản ghi; cả 5 qua ở lần thử lại đầu.
- **Sửa cho lời tạo đơn lẻ.** `services/bff/src/conflict.ts`: thử lại tối đa 3 lần, chờ ngẫu nhiên trong [0, 50·2^k) ms (tổng chờ không quá 350 ms), chỉ khi lỗi đúng là `conflict` + `40001`; hết lượt thì trả 503 `busy` kèm `retry: true`. Áp cho tạo bệnh nhân, cấp số (giữ nguyên số đang thử, không tính vào 5 vòng cấp số), dị ứng, tiền sử. Mỗi lần thử lại ghi một dòng log "thử lại vì xung đột giao dịch" (loại lời ghi và lần thử, không có dữ liệu bệnh nhân).
- **Phát hiện nặng hơn: ký cùng lúc làm mất bản ghi [Đã đo].** Trong gói hoàn tất, mục bị 409 được báo riêng trong HTTP 200 còn mục đóng lượt khám vẫn chạy (14 gói gửi cùng lúc: 10 gói có mục 409, cả 14 lượt khám đều `finished`). BFF trả 503 `incomplete`, máy khách gửi lại cùng `clientUuid`, BFF thấy lượt đã đóng bằng đúng UUID đó nên trả 200 mà không ghi bù. Sau khi gửi lại: 3 lượt ký cùng lúc, 5/24 lượt thiếu một sinh hiệu; 5 lượt, 12/25 (một lượt thiếu cả chẩn đoán); 12 lượt, 20/24, trong đó 2 lượt mất hẳn đơn thuốc. Lỗi có từ M0-S2 và không bài nào thấy: bài F11 chỉ chèn lỗi vào chính mục đóng, bài 20 chu kỳ chạy một máy.
- **Sửa đường hoàn tất.** `planCompletion` (thay `buildCompletionBundle`) chia việc ghi thành các bước; bước sau chỉ gửi khi mọi mục của bước trước đã được ghi và chỉ trỏ tới id thật: (1) sinh hiệu, chẩn đoán, nhận định, từng thuốc; (2) đơn; (3) chữ ký mô phỏng và việc gửi cổng; (4) đóng lượt khám bằng một lời ghi riêng kèm `If-Match`. Mục 409 mã 40001 thì BFF gửi lại gói của bước đó (mục đã ghi trả 200), tối đa 3 lần. Còn mục lỗi thì 503 `incomplete` như trước, lượt khám chưa đóng, gửi lại cùng `clientUuid` thì chạy lại từ đầu và hội tụ. 412 ở lời đóng vẫn là 503 `incomplete` (yêu cầu của chủ dự án; bài F11 cũ không đổi một dòng).
- **Đi khác thiết kế đã duyệt.** Thiết kế duyệt là "một gói các mục tạo, rồi một lời đóng riêng". Đo tất định cho thấy chưa đủ: khi mục thuốc lỗi mà mục đơn chạy, đơn được lưu trỏ tới `MedicationRequest/<id không tồn tại>` và gửi lại gói không sửa được (F11). Vì vậy các mục tạo được chia tiếp theo quan hệ tham chiếu. Nguyên tắc giữ nguyên: kiểm xong mới đi tiếp, đóng sau cùng.
- **Cấp số hết vòng [Đã đo].** 12 lời cấp số cùng lúc: 22/60 lời nhận 500 vì hết 5 vòng tìm số trống (không phải 40001; các lời được cấp không trùng số). Chủ dự án chọn trả 503 `busy` thay cho 500, không đổi cách cấp số.
- **Sau khi sửa [Đã đo].** 3, 5, 12 lượt ký cùng lúc: 24/24, 25/25, 24/24 lời trả 201 ngay, 0 lượt thiếu bản ghi. 8 vòng × 12 lượt: mỗi vòng BFF gửi lại gói 4–9 lần, xa nhất tới lần thử thứ 2 trên 3, cả 96 lời 201. Thời gian ký một lượt khi không ai ký cùng (trung vị, 2 × 10 lượt mỗi loại): có đơn 186–191 ms thành 215–228 ms, không đơn 125–127 ms thành 127–144 ms. Có đơn thì thêm 3 lời gọi Medplum; `fetch` trên máy này có sàn khoảng 15 ms mỗi lời.
- **Kiểm thử.** 8 kiểm thử đơn vị mới ở BFF; `clinical` viết lại 7 bài cho `planCompletion`. Tệp `services/bff/test/integration/conflict.test.ts`: 19 bài trên Medplum thật, sáu phòng khám tạm. Hai bài tái hiện, 20 lời tạo bệnh nhân cùng lúc (tối đa 6 vòng) và 12 lượt ký cùng lúc (tối đa 3 vòng, mỗi vòng một phòng khám), **đòi thấy ít nhất một xung đột thật**, mã phải là 40001, rồi đếm thẳng trong Medplum. Các bài tất định bọc client Medplum bằng `Proxy`: chèn 409 vào một lời tạo, bỏ một mục khỏi gói rồi báo mục đó 409 (đúng điều Medplum làm), cho "lễ tân khác" lấy số trước. Chúng kiểm: lượt khám chưa đóng khi còn mục chưa ghi; không có đơn trỏ tới thuốc chưa tồn tại; gửi lại thì 201, đủ bản ghi, không trùng; lỗi không phải 40001 thì không thử lại. Bài tạo ba bệnh nhân bằng `Promise.all` giữ nguyên. Trên máy dev: bài bệnh nhân 40 lần chạy đều đạt (nghĩa là lần nào cũng gặp xung đột), các lần có ghi số là 1–18 xung đột thật, một lần phải sang vòng 2; bài ký với 12 lượt 12 lần chạy đều đạt, 5 lần có ghi số là 4–7 mục 409. `pnpm e2e:cycles` (hạt giống 2091646424): 11/11. Số của CI (CSDL mới dựng) in ở log của job tích hợp, dòng bắt đầu bằng "[xung đột", và ghi ở mô tả PR #14.
- **Đột biến (36) [Đã đo, đếm số bài thật sự chạy].** Cả 36 đỏ: 11 ở hàm thử lại (gỡ hẳn, nhận diện sai hoặc quá rộng, bỏ giới hạn, lệch một lần, bỏ chờ, bỏ ngẫu nhiên, không tăng, hết lượt ném lỗi gốc, không báo), 3 ở mã 503, 4 gỡ bọc từng đường, 2 ở việc chuyển chính sách, 1 cấp số hết vòng, 10 ở các bước hoàn tất của BFF, 4 ở `planCompletion`, và 1 đột biến ghép "hành vi trước bản sửa" (không gửi lại gói và bỏ qua mục lỗi). Script đọc báo cáo JSON của vitest; đột biến chỉ tính đỏ khi số bài chạy bằng lần chạy gốc. Ba chỗ đáng ghi: (1) lần chạy đầu một đột biến bị ghi "không hợp lệ" vì Medplum từ chối đăng nhập (5 lần/phút, F5), chạy lại thì đỏ; (2) bài ký cùng lúc ban đầu dùng 5 lượt, 2 trong 11 lần chạy không gặp xung đột nào trong 3 vòng nên bài đỏ ở chính điều kiện "phải thấy xung đột"; đã nâng lên 12 lượt; (3) đột biến "bỏ qua mục lỗi của bước 1" một mình không làm bài 12 lượt ký cùng lúc đỏ, vì việc gửi lại gói đã hấp thụ hết xung đột; các bài tất định bắt nó, còn bài cùng lúc chỉ đỏ với đột biến ghép.
- **Giao diện với 5xx của lần gửi đầu [Đã đọc mã; mức hàng đợi đã có kiểm thử đơn vị].** Không báo lỗi tại chỗ: mục nằm trong hàng đợi và tự gửi lại sau 2 giây với cùng `clientUuid`. Tạo bệnh nhân trả bản trên máy với id tạm kèm câu "Mất mạng: đã tạo bệnh nhân trên máy này…" dù mạng vẫn có; cấp số ngay sau đó ra số "(tạm)"; "Ký & In" báo "Đã giữ trên máy, máy sẽ tự gửi lại" và không in (ca OFF-8). Chưa sửa giao diện; BFF thử lại làm các ca này hiếm đi.
- **Môi trường.** Giữa phiên, stack Medplum dùng chung dừng và không khởi động lại được: `.env` và `config/` của nó nằm trong một worktree đã bị xóa. Đã dựng lại với mật khẩu lấy từ container cũ, không sinh mật khẩu mới, không đụng volume; hai tệp nay nằm ở checkout gốc. Chạy liền nhiều lần bộ tích hợp trên một máy sẽ gặp giới hạn đăng nhập 5 lần/phút (mỗi tệp một lần đăng nhập siêu quản trị); CI chạy một lần ba tệp nên không gặp.

Kiểm thử đã chạy [Đã đo, 03/10/2026, mã của lát 6; máy dev Windows 11, i7-11800H, 32 GB RAM, Medplum 5.2.0 trong Docker Desktop]: kiểu đạt cả 7 gói; 370 kiểm thử đơn vị = 34 (mô hình) + 16 (danh mục) + 27 (quy tắc) + 36 (clinical) + 4 (in) + 163 (web) + 90 (BFF); 41 kiểm thử tích hợp với Medplum thật; e2e 13 + 24 + 13 + 12 bước trên Chromium thật (`e2e`, `e2e:visit`, `e2e:offline`, `e2e:conflict`), đạt trên cả bản dev và bản build; bài 20 chu kỳ 11 bước trên bản build. So với lúc bắt đầu M0-S3 (217 đơn vị, 35 tích hợp, e2e 13 + 21 bước): thêm 153 kiểm thử đơn vị, 6 tích hợp, 3 bước ở `e2e:visit` và ba bài e2e mới.

- Đột biến: 111 đột biến ở lát 1–5 (5 + 7 + 9 + 17 + 15 ở lát 1 đến 3b; 45 qua kiểm thử đơn vị và 10 qua bài e2e hai máy ở lát 4; 3 qua bài 20 chu kỳ ở lát 5) và 6 ở lát 6. Sau khi sửa các ca nêu ở bài học 3, mỗi đột biến làm ít nhất một bài đỏ. M0-ZALO thêm 12 đột biến (đoạn "M0-ZALO" ở trên). PR #14 thêm 36 đột biến (đoạn "Ghi cùng lúc").
- CI trên `main` (commit `43e4b6d`) xanh cả ba job: kiểu, đơn vị và build 40 giây; tích hợp 1 phút 15 giây; e2e 3 phút 23 giây, trong đó có bài 20 chu kỳ [Đã đo].
- Gói JS của bản build: 312 KB (nén 96,7 KB) trước M0-S3, 510,5 KB (nén 163,8 KB) sau lát 5, 511,7 KB (nén 164,2 KB) sau lát 6, 514,9 KB (nén 165,2 KB) sau M0-ZALO [Đã đo, bản build của CI]. Phần tăng của lát 6 là chữ trên trang "Phạm vi".
- Sau M0-ZALO [Đã đo, 03/10/2026, cùng máy dev]: kiểu đạt cả 7 gói; 424 kiểm thử đơn vị (thêm 47 ở `clinical`, 7 ở `clinic-web`); 41 kiểm thử tích hợp (không đổi, chạy lại ở CI); e2e 13 + 25 + 14 + 12 bước, đạt trên bản dev (máy dev) và bản build (CI). CI của PR #11 xanh cả ba job: kiểu, đơn vị và build 47 giây; tích hợp 1 phút 44 giây; e2e 3 phút 7 giây, trong đó có bài 20 chu kỳ.
- Sau PR #14 [Đã đo, 04/10/2026, cùng máy dev]: kiểu đạt cả 7 gói; 432 kiểm thử đơn vị = 34 (mô hình) + 16 (danh mục) + 27 (quy tắc) + 83 (clinical) + 4 (in) + 170 (web) + 98 (BFF, thêm 8); 60 kiểm thử tích hợp = 14 + 27 + 19 (tệp mới `conflict.test.ts`); bài 20 chu kỳ 11/11. e2e còn lại không chạy trên máy dev ở phiên này (giao diện không đổi), chạy ở CI.

**Kết quả M0-2: đạt [Đã đo].** Tiêu chí (mục 5.3): 20 lần ngắt và khôi phục mạng liên tiếp, 0 bản ghi mất, 0 bản ghi trùng.

- Bài `pnpm e2e:cycles`: 20 bệnh nhân mới đi hết đường (tạo, cấp số, gọi vào khám, khám, ký và in) trên một phòng khám thử riêng, mỗi chu kỳ một lần ngắt và một lần bật lại mạng ở thời điểm sinh từ hạt giống. Lỗi chèn thêm: mất phản hồi 16 lần (4 lần cho mỗi thao tác ghi), tải lại trang khi đang mất mạng ở khoảng 40% số chu kỳ, máy sập đúng lúc in ở một nửa số chu kỳ ký khi mất mạng.
- Cuối bài đếm thẳng trong Medplum bằng tài khoản máy của phòng khám thử: Patient = Encounter = List = Task = Provenance = ClinicalImpression = 20; mọi Encounter `finished`; MedicationRequest, Condition, Observation đúng bằng số đã nhập; 20 số thứ tự khác nhau; mỗi mã đơn đã in có đúng một đơn trên máy chủ và ngược lại; trên máy không còn mục chờ; IndexedDB không có dữ liệu bệnh nhân ở dạng rõ.
- Máy dev, bản build: 13 lần chạy 20 chu kỳ đều đạt 11/11 bước kiểm (12 lần ở lát 5 với 11 hạt giống khác nhau, 1 lần ở lát 6 với hạt giống 1577264254) và 1 lần chạy 100 chu kỳ đạt 11/11 (251 giây).
- CI: lần chạy đầu đỏ ở chu kỳ 02 do chính bài kiểm thử (bộ định vị gặp hai nút, phát hiện 5 của lát 5), 19 chu kỳ còn lại vẫn đúng số bản ghi; đã sửa bài. Ba lần chạy đã đọc log sau đó đều 11/11: hạt giống 1428297068 (nhánh lát 5), 1300616032 và 578461091 (`main`).
- Bài chỉ có nghĩa vì đã thấy nó đỏ: sinh `clientUuid` mới khi gửi lại cho Patient 24/20; bỏ mục khi gặp lỗi mạng cho Encounter 13/20 và List 5/20; in trước khi lưu bền cho List 17/20.
- Thời gian: bài 20 chu kỳ 44–60 giây trên máy dev, thêm khoảng 1 phút cho job e2e của CI. Máy chủ nhận lượt khám sau khi có mạng lại: trung vị 0,3–1,5 giây, lâu nhất 4,3 giây.
- **M0-2 không đo điều gì:** tiêu chí tính trên bản ghi của máy chủ, nên hai lỗi phía người dùng đi qua mà bài vẫn xanh: "Ký & In" có lúc không in (phát hiện 3) và hàng chờ có lúc hiện hai dòng cho một lượt khám (phát hiện 5). Bài tự bấm lại và ghi số lần ở cuối. Bài cũng chỉ chạy một máy, một người dùng: vì vậy nó không thể thấy lỗi mất bản ghi khi nhiều lượt ký cùng lúc (đoạn "Ghi cùng lúc" ở trên). "0 mất" của M0-2 chỉ nói về một máy.

Bài học từ M0-S3:

1. **Một đường cho cả lúc có mạng lẫn lúc mất mạng (N1) trả công, nhưng sinh ra trạng thái trung gian.** Mọi thao tác ghi đi qua cùng một hàng đợi, nên đường ngoại tuyến được chạy hằng ngày và "0 trùng" dựa hẳn vào `clientUuid` đã có kiểm thử từ M0-S1. Cái giá: thao tác làm lúc có mạng mà máy chủ chưa nhận ngay rơi vào trạng thái "đã vào hàng đợi, sẽ tự gửi, nhưng chưa có tờ đơn" (phát hiện 3 của lát 5, thiết kế OFF-8). Mỗi đường mới phải trả lời được: khi hàm trả về, mục đang ở đâu và người dùng đang cầm gì trong tay.
2. **Trình duyệt bỏ mất sự kiện IndexedDB khi trang gọi `print()` (F12).** Không có trong thiết kế, chỉ lộ ra khi bài e2e ký rồi in thật. Hàng rào in và hạn 20 giây cho mỗi thao tác kho đưa số yêu cầu bị mất từ 83/200 về 0/200. Mọi lần in phải đi qua `printHtml`.
3. **Bài kiểm thử chỉ đáng tin sau khi đã thấy nó đỏ.** Trong 111 đột biến của lát 1–5: 3 lần bài kiểm thử vẫn xanh vì yếu (vectơ UUID chỉ có chữ số; bài hai tab không tất định; bài dựa vào kết quả của bài trước) và đã được viết lại; 3 lần chính đột biến viết sai hoặc không đổi hành vi; 1 lần tệp không dịch được trông như "đỏ" dù không chu kỳ nào chạy. Một bước chờ `page.waitForFunction` với hàm `async` đã không chờ gì từ lát 3b-2 tới lát 4. Bước kiểm trang "Phạm vi" chỉ tìm chữ "Ngoại tuyến" nên xanh cả khi nhãn đặt sai khối (lát 6). Script đột biến phải đếm số bài thật sự chạy.
4. **Đếm bản ghi chưa đủ nếu không chèn đúng loại lỗi.** Đột biến "in trước khi lưu bền" không làm lệch số đếm nào cho tới khi bài 20 chu kỳ có thêm kiểu lỗi "máy sập đúng lúc in". Ngược lại, số đếm đúng không nói gì về cái người dùng thấy (đoạn "M0-2 không đo điều gì" ở trên).
5. **"Mất mạng" có hai dạng.** Trình duyệt biết mình mất mạng (sự kiện `offline`), và trình duyệt tưởng có mạng nhưng gọi gì cũng lỗi (mất phản hồi, tải lại trang khi mất mạng). Ứng dụng coi lỗi mạng của chính lời gọi là tín hiệu, không chỉ dựa vào `navigator.onLine`. Chiều ngược lại còn thiếu: không có lời gọi nào thăm dò để tự thoát chế độ "Mất mạng" (phát hiện 4).
6. **Hạn mức FHIR mặc định là trần thật của việc đồng bộ.** Một lượt khám đi hết đường tốn khoảng 2.500 điểm [Phân tích], tức khoảng 20 lượt khám mỗi phút qua một tài khoản máy với hạn mức 50.000 điểm/phút. Gặp 429 thì nhóm "gửi lại" vẫn hội tụ đủ 20/20 [Đã đo], nhưng T6 ("40 ca trong 60 giây") cần T-QUOTA trước.
7. **Ngoại tuyến làm nhật ký truy cập dày hơn và thêm một loại giờ "máy khách khai".** Thêm dòng `queue-prefetch` và một `queue-read` mỗi 30 giây khi màn hình hàng chờ không mở; dòng của thao tác làm lúc mất mạng mang `clientTs` không kiểm chứng được. Tính vào Q13 (khối lượng nhật ký) và T-SIGN (giờ ký).
8. **PR xếp chồng phải merge theo thứ tự từ gốc.** PR #7 (sửa phát hiện 2) lấy nhánh của lát 5 làm gốc và được merge 33 giây sau khi nhánh đó đã vào `main`, nên bản sửa nằm lại ngoài `main` (mục 5.8, "Lát 6 xong").
9. **Điểm chốt chỉ là điểm chốt khi nó là một lời ghi riêng.** Thiết kế "mục đóng lượt khám đứng cuối gói" dựa vào giả định máy chủ dừng ở mục lỗi đầu tiên. Medplum không dừng (F11), nên một xung đột giao dịch ở mục đầu (F13) để lại lượt khám đã đóng mà thiếu bản ghi, và lần gửi lại "idempotent" chỉ xác nhận lại cái sai. Bài kiểm thử cũ chèn lỗi vào đúng mục đóng nên không thấy; bài 20 chu kỳ chạy một máy nên cũng không thấy. Mọi đường ghi nhiều bản ghi cần một bài chèn lỗi vào **từng** mục và một bài nhiều lời cùng lúc có đếm bản ghi.
10. **Bài tái hiện phải tự chứng minh là nó đã tái hiện.** Hai bài "cùng lúc" đòi thấy ít nhất một xung đột thật. Nhờ điều kiện đó mới lộ ra rằng 5 lượt ký cùng lúc có lần không sinh xung đột nào (bài lẽ ra xanh mà không kiểm được gì), và phải nâng lên 12 lượt.

Giới hạn đã biết, cần quyết định. Mục (a) nên quyết trước buổi trình diễn 13/11; còn lại cho M1:

- (a) **Bốn lỗi đã biết của lát 5 còn trên `main`**, không lỗi nào làm mất hay trùng bản ghi trên máy chủ: mục "thử lại" có thể nằm chờ thêm tới 30 giây (đã có bản sửa ở PR #7, chưa vào `main`); "Ký & In" lúc có mạng mà máy chủ chưa nhận ngay có lúc không in đơn (thiết kế OFF-8 chờ duyệt, bốn câu hỏi ở cuối mục đó); chế độ "Mất mạng" không tự thoát khi không còn mục chờ; hàng chờ có lúc hiện hai dòng cho một lượt khám (PR #9, bản nháp). Lỗi thứ hai và thứ tư có thể gặp ngay trên sân khấu [Phân tích].
- (b) **Hai máy không thấy nhau khi phòng khám mất Internet (N5).** Cần một trạm đồng bộ trong mạng LAN: T-OFF-3, Giai đoạn 2. Tới lúc đó phải nói rõ trong tài liệu bán hàng.
- (c) **Mục bị từ chối không có đường ra.** Xung đột 409 chỉ được phát hiện và báo. Đơn 422 có lỗi chặn (`blocking`) không có ô lý do và không có nút gửi lại: chỉ còn liên hệ bệnh nhân và kê lại. Không có nút xóa hay hủy, nên các mục này nằm lại trong danh sách, huy hiệu "cần xử lý" không về 0, và mỗi lần in lại thêm một mục. M1 cần quy trình giải quyết (gộp, tách thành lượt khám riêng, hủy có ghi nhận) và người có quyền làm việc đó.
- (d) **"Đã in đơn rồi mới thấy cảnh báo".** Đơn ký khi mất mạng bị quy tắc của máy chủ bắt lại lúc đồng bộ (ví dụ dị ứng vừa được ghi ở máy khác) khi bệnh nhân đã cầm đơn. Hiện bác sĩ ghi lý do rồi gửi lại, màn hình nhắc liên hệ bệnh nhân. Cần cố vấn y khoa duyệt cách xử lý trước M1.
- (e) **Hết hạn phiên thật sau 480 phút [Chưa đo].** Bài e2e giả lập phản hồi 401; chưa có lần nào để token hết hạn thật giữa lúc mất mạng. Đóng tab khi mất mạng làm mất token, phải có mạng mới đăng nhập lại được (dữ liệu trên máy còn nguyên).
- (f) **Mục chờ của người nghỉ việc nằm lại trên máy**: chỉ phiên của chính người đó gửi được. M1 cần quy trình quản trị, cùng T-IDP.
- (g) **Khóa mã hóa nằm cùng máy với dữ liệu, không có mã PIN.** Chỉ chống xem lướt, không chống người dùng chung trình duyệt hay người lấy được ổ đĩa (OFF-5). Định dạng lưu cho phép M1 bọc khóa bằng PIN hoặc bằng khóa do IdP cấp. `navigator.storage.persist()` được gọi nhưng kết quả không được kiểm; chưa đo trình duyệt có tự dọn kho khi đầy bộ nhớ hay không [Đã đọc mã].
- (h) **Giờ ký và thời lượng khám của lượt làm lúc mất mạng do máy khách khai**; đơn in khi mất mạng dùng chữ ký mô phỏng và chưa lên cổng. Giá trị pháp lý của tờ đơn đó là Q3; chờ ký số và gửi cổng khi mất mạng là T-OFF-2 (M1, S5), phụ thuộc T-SIGN.
- (i) **Gói JS tăng 312 → 512 KB (nén 96,7 → 164 KB) trong M0-S3**, trong đó Dexie khoảng 104 KB (nén 35 KB). Thay bằng `idb` (khoảng 1 KB) là khả năng đã nêu ở lát 2, khi kho chỉ đọc và ghi theo khóa. Từ lát 3b kho còn dùng chỉ mục phụ (`seq`, `status`, `day`), truy vấn theo khoảng, giao dịch nhiều bảng và nâng version [Đã đọc mã: `local/store.ts`]; `idb` làm được các việc này nhưng phải viết lại lớp kho và chạy lại toàn bộ đột biến của kho. Chỉ nên làm nếu số đo trên máy tính bảng thật cho thấy cần.
- (j) **Chưa thử ngoài Chromium không giao diện [Chưa kiểm chứng]:** F12 trên trình duyệt có giao diện, máy tính bảng thật, Safari (IndexedDB, Web Locks, service worker, hộp thoại in). Phiên thử với bác sĩ là lần đầu ngoại tuyến chạy trên thiết bị thật.
- (k) **Rủi ro còn lại của "lưu bền rồi mới in":** trình duyệt sập giữa lúc lưu mục và lúc in thì lượt khám tự gửi mà không có tờ đơn và không có dấu "chưa in" (OFF-8, rủi ro còn lại 4). Dòng nhật ký in có thể ghi hai lần khi mất phản hồi (đã chấp nhận ở OFF-1).
- (l) **Tin Zalo, kể cả khi không có thuốc hay chẩn đoán, có thể vẫn là dữ liệu sức khỏe [Phân tích, cần pháp chế].** Tên bệnh nhân, tên phòng khám (thường có chuyên khoa, ví dụ "Nhi") và mã đơn đủ cho biết người đó đã đi khám và được kê đơn, và gửi qua Zalo là chuyển dữ liệu cho bên thứ ba. Trước T-ZALO và T-CONSENT (M1), pháp chế cần trả lời: tin tối thiểu được gồm những trường nào; có cần đồng ý riêng cho kênh Zalo không; tin này có thuộc diện dữ liệu nhạy cảm của Q8 không. Không chặn M0, vì bản xem trước không gửi gì.
- (m) **Ghi cùng lúc: phần còn lại sau PR #14.** (1) Mới đo trên một máy dev và một bản BFF; nhiều bản BFF song song, CSDL lớn thật và tải của một ngày khám [Chưa đo]. (2) 429 do hết hạn mức FHIR vẫn thành 500 (T-QUOTA). (3) Câu "Mất mạng: …" hiện cả khi máy chủ trả 5xx lúc đang có mạng. (4) Lượt khám đã đóng thiếu bản ghi do lỗi cũ không được quét và sửa lại; hiện chỉ có dữ liệu giả, nhưng nếu đã có dữ liệu thật thì cần một bộ quét (cùng loại với bộ quét đối soát của A2). (5) Hơn 5 lời cấp số tới cùng một lúc thì một số lời nhận 503 `busy` và phải gửi lại; cách cấp số chưa đổi. (6) Dòng log "thử lại vì xung đột giao dịch" ghép ở `server.ts` chưa có kiểm thử tự động.

---

## 6. Giai đoạn 1 — MVP pilot, M1 (11/2026 – 03/2027)

Quyết định 02/10/2026: **làm sớm và cắt phạm vi** (mục 5.1). Mục tiêu thoát giai đoạn theo TL34: ≥ 80% phiên khám thường quy dưới 90 giây, NPS bác sĩ ≥ 40,
≥ 98% đơn gửi cổng trong 5 phút và 0 đơn mất, 0 lỗi bảo mật mức cao, kiểm thử cách ly đạt, DPIA và DPA ký với 100% phòng khám pilot, uptime luồng lõi ≥ 99,5% trong 2 tháng pilot.

### 6.1 Phép tính lịch sau khi bắt đầu xây từ 05/10 [Phân tích]

- Từ 05/10/2026 đến 31/03/2027 là khoảng 25,4 tuần. Trừ Tết (giả định nghỉ 06–14/02/2027, khoảng 1,3 tuần) còn khoảng 24,1 tuần, tức khoảng 12 sprint lịch: **vừa bằng 12 sprint của TL34** (mục 3.3 dòng 1), thay vì thiếu 3–4 sprint như khi chỉ bắt đầu từ 12/2026.
- Nhưng 6 tuần đầu đội chỉ dành khoảng một nửa năng lực cho xây dựng (nửa kia làm PoC, nghiên cứu, pháp lý; mục 5.3). Ba sprint M0 tương đương khoảng 1,5 sprint của đội đầy đủ. Tổng năng lực ≈ 1,5 + 9 = **10,5 sprint** so với 12 cần: thiếu khoảng 1,5 sprint (≈ 12%).
- Tỷ lệ "một nửa" là giả định của tôi; PO điều chỉnh khi chốt phân công. Phần thiếu được bù bằng danh sách cắt ở 6.2.

### 6.2 Danh sách cắt

Giữ nguyên các mục bắt buộc: tiếp đón, khám, kê đơn, ký số, gửi cổng, in, nhập Excel (thị trường thay thế cần), ngoại tuyến mức tối thiểu, cách ly phòng khám, DPIA/DPA, nhật ký truy cập.

| Hoãn sang Giai đoạn 2 | Giữ lại ở M1 |
|---|---|
| Nhắc lịch, hẹn tái khám qua ZNS | ZNS gửi đơn thuốc |
| Báo cáo doanh thu | Sổ thu ngày |
| Onboarding tự phục vụ dưới 30 phút | Onboarding trực tiếp cho 15–20 phòng pilot |
| Diễn tập DR đầy đủ (vùng thứ hai vốn thuộc Giai đoạn 2 theo TL34) | Kiểm thử khôi phục sao lưu hàng tháng |

Các mục trên cộng lại khoảng 1,5–2 sprint theo ước lượng thô của tôi; PO ước lượng lại khi chia nhỏ backlog ở M0-S1. Nếu M0-S2 trượt, cắt thêm theo thứ tự: ảnh đính kèm, ký phiếu khám, chuyên khoa thứ hai.

### 6.3 Lịch 9 sprint M1

Bắt đầu 16/11, **chỉ khi quyết định "đi" ngày 13/11**. M1 dùng lại ứng dụng M0, nên nền móng, tiếp đón, khám và kê đơn online đã có; thời gian dồn vào kết nối thật, ngoại tuyến đầy đủ, thu tiền và cứng hóa.
Giả định nghỉ Tết **06–14/02/2027** (xác nhận lịch nghỉ chính thức).

| Sprint | Thời gian | Nội dung | Công việc |
|---|---|---|---|
| S1 | 16–29/11 | Từ M0 sang sản phẩm | Sửa theo phản hồi nhà đầu tư và bác sĩ; cấp phòng khám thật (T-TEN); hạ tầng dạng mã trên nhà cung cấp đã chọn (T-IAC); T-SEC0 hoàn chỉnh; đồng ý điện tử (T-CONSENT); bắt đầu nhập Excel (T-MIG) |
| S2 | 30/11–13/12 | Cổng và ký số 1 | Bộ nối cổng trên sandbox thật thay cổng mô phỏng, nếu có tài liệu (TL34 Q1) (T-RX); ký số tích hợp nhà cung cấp 1 (T-SIGN); outbox và bộ quét đối soát (T-OUTBOX) |
| S3 | 14–27/12 | Cổng và ký số 2 | Vòng ký → gửi → trạng thái đầy đủ; hàng đợi lỗi, thử lại; đo T1 trên dữ liệu thật |
| S4 | 28/12–10/01 | Khám đầy đủ | Mẫu khám theo chuyên khoa, ảnh đính kèm, ký phiếu khám; danh mục ICD-10 và thuốc từ nguồn chính thức đã xác nhận giấy phép (T-CAT); quy tắc kê đơn theo TT 26/2025 (T-RULE) |
| S5 | 11–24/01 | Ngoại tuyến và dữ liệu | Ngoại tuyến mức tối thiểu hoàn chỉnh: chờ ký, ký hàng loạt khi có mạng (T-OFF-2); nhập Excel xong (T-MIG); nhật ký bất biến ngoài Medplum (T-AUD) |
| S6 | 25/01–05/02 | Thu tiền và Zalo | QR động tự xác nhận, sổ thu ngày (T-PAY); ZNS gửi đơn (T-ZALO) |
| — | 06–14/02 | Nghỉ Tết | Kiểm thử nội bộ nhẹ nếu cần |
| S7 | 15–28/02 | Cứng hóa | Kiểm thử bảo mật nội bộ, cách ly, tải; DPIA/DPA; rời tenant (T-OFFB); tài liệu cài đặt |
| S8 | 01–14/03 | Pilot đợt 1 | 5 phòng mạch; sửa lỗi; KPI |
| S9 | 15–31/03 | Pilot đợt 2 | 15–20 phòng, chạy song song hai tuần với phần mềm cũ; báo cáo pilot; quyết định ra mắt thương mại |

Ánh xạ với TL34 E.3: S1–S2 (nền móng) ≈ M0-S1; S3–S6 (tiếp đón, khám) ≈ M0-S2, M0-S3 và M1 S4; S7–S8 (kê đơn, ký số, cổng) ≈ M0-S2 (online, mô phỏng) và M1 S2–S3; S9 (thu phí) ≈ M1 S6; S10 (cứng hóa) ≈ M1 S7; S11–S12 (pilot) ≈ M1 S8–S9.

Điểm phụ thuộc quan trọng nhất: **tài liệu API và sandbox của cổng đơn thuốc (TL34 Q1, hạn tuần 3)**. Nếu chưa có khi S2 bắt đầu, giữ cổng mô phỏng sau cùng giao diện và dời bộ nối thật; đây là rủi ro lịch lớn nhất của M1.

---

## 7. Giai đoạn 2 và 3

Ở mức đầu việc theo TL34 (E.4, E.5), chi tiết hóa lại ở cuối giai đoạn trước:

- **Giai đoạn 2 (04–07/2027)**: bệnh án điện tử đầy đủ theo TT 13/2025 và TT 32/2023, khóa sau ký (T-EMR); hóa đơn điện tử (T-INV); đặt lịch Zalo, nhắc lịch, kịch bản chăm sóc; nhiều cơ sở và phân quyền chi tiết; ngoại tuyến hoàn chỉnh (T-OFF-3, ký lô, ứng dụng ký USB cho máy bàn, tablet đóng gói); vùng thứ hai và diễn tập DR (T-DR); kiểm tra bảo mật độc lập; onboarding tự phục vụ; hoàn tất các việc đã hoãn ở mục 6; ra mắt thương mại 05–06/2027. Thoát: 100 tenant trả phí, churn < 3%/tháng, SLO 99,9% hai tháng liên tiếp, 100% gói Chuyên nghiệp có bệnh án điện tử hợp lệ.
- **Giai đoạn 3 (08–12/2027)**: Sổ sức khỏe điện tử/VNeID (phụ thuộc hướng dẫn kỹ thuật, TL34 Q5); nhà thuốc trực thuộc; chuyên khoa sâu; khám từ xa; trợ lý AI; tương tác thuốc (nguồn dữ liệu có bản quyền); ISO 27001; API mở. Thoát: 300 tenant trả phí, NPS ≥ 50, hai đối tác tích hợp hoạt động.

---

## 8. Danh mục công việc kỹ thuật

Cỡ: S ≤ 1 tuần-người, M 1–3, L 3–8, XL > 8 (ước lượng thô, chuẩn hóa sau Giai đoạn 0). Cột GĐ: M0 = MVP trình nhà đầu tư (mục 5), 0 = kiểm chứng, 1 = M1 (mục 6), 2 = Giai đoạn 2.
Mục "Mới" là việc phát sinh từ thử nghiệm hoặc từ quyết định MVP-first; các việc xây sản phẩm (T-APP, T-BFF, …) trước đây chưa có dòng riêng.

| Mã | Công việc | Chi tiết | Cỡ | GĐ | Mới |
|---|---|---|---|---|---|
| T-APP | Ứng dụng phòng khám (PWA) | Tiếp đón, hàng chờ, màn hình chờ, khám một trang, kê đơn, in; React + TypeScript + Vite; ngoại tuyến theo T-OFF | XL | M0, 1 | ✓ |
| T-BFF | BFF / Domain API | Lớp duy nhất gọi Medplum; ngữ cảnh tenant; ghi idempotent (T-IDEM); nhật ký truy cập; gom patient-summary | L | M0, 1 | ✓ |
| T-RULE | Quy tắc kê đơn | Trùng hoạt chất, dị ứng, số ngày tối đa (30 ngày, bệnh mạn tính 90 ngày), trường bắt buộc (CCCD, chẩn đoán); cấu hình được, không lập trình cứng | M | M0, 1 | ✓ |
| T-CAT | Danh mục và đơn mẫu | ICD-10, thuốc, đơn mẫu. M0 dùng tập con minh họa; M1 dùng nguồn chính thức đã xác nhận giấy phép | M | M0, 1 | ✓ |
| T-PRINT | In đơn thuốc A5/A4 + QR | Mẫu in theo TT 26/2025; in nhanh từ trình duyệt | S | M0, 1 | ✓ |
| T-TELE | Đo thời gian phiên khám | Đồng hồ từ mở hồ sơ đến in đơn, theo bác sĩ và phòng khám; KPI số 1 của sản phẩm | S | M0, 1 | ✓ |
| T-SIM | Cổng đơn thuốc mô phỏng | Bộ nối giả lập có nút chèn lỗi, cùng giao diện với bộ nối thật (T-RX) để thay không đổi ứng dụng | S | M0 | ✓ |
| T-DEMO | Dữ liệu và kịch bản trình diễn | Dữ liệu giả hoàn toàn, hai phòng khám, kịch bản 10 phút, bản dự phòng, nhãn "mô phỏng" | S | M0 | ✓ |
| T-SEC0 | Vô hiệu tài khoản mặc định, quản lý bí mật | Xóa/đổi `admin@example.com`; đổi mật khẩu qua API cần egress HIBP (F2) nên cần quy trình thay thế được duyệt; khóa ký trong kho bí mật; tắt tự đăng ký | M | 0, 1 | |
| T-IDP | Xác thực nhân viên | Người dùng Medplum (TOTP, dính F2) hay IdP riêng; xác thực hai lớp cho người ký | M | 0 | |
| T-EGR | Kiểm soát egress | Danh sách host được phép, chặn mặc định; xác định host của kiểm tra phiên bản (F7); proxy hay thay thế cho HIBP | S | 0, 1 | |
| T-TEN | Cấp phòng khám | Dịch vụ tạo `Project`, `ClientApplication`, `AccessPolicy`, hạn mức, `Project.link` tới danh mục; tạo/tạm khóa/xóa; không dùng quyền siêu quản trị cho vận hành thường xuyên. M0: mức tối thiểu cho hai phòng khám demo | L | M0, 1 | |
| T-QUOTA | Hạn mức | `userFhirQuota`/`totalFhirQuota` từng project; tài khoản nhập dữ liệu hạn mức cao; proxy chuyển IP thật để hạn mức đăng nhập không gộp phòng khám | S | 1 | |
| T-AUD | Nhật ký truy cập | Kiến trúc hai tầng (A3); nhật ký BFF cho mở hồ sơ/tìm kiếm/xuất; kho bất biến; phân vùng và lưu giữ AuditEvent; cảnh báo truy cập bất thường. M0: nhật ký ở BFF và màn hình xem | L | M0, 1 | |
| T-NAME | Tìm tên không dấu | Hai hướng ở A7; gồm xếp hạng kết quả theo 4 số cuối. Sau đo M0-3 (mục 2): khóa chính xác cho 4 số cuối, xếp người khớp đúng từng từ trước người khớp đầu từ, báo khi còn người trùng tên | M | M0, 1 | |
| T-FHIR | Hồ sơ FHIR và định danh | `StructureDefinition` cho CCCD, mã đơn, ICD-10; định danh chuẩn thay URN tạm | M | 1 | |
| T-IDEM | Ghi lặp lại được | A1: identifier + `If-None-Exist`, kiểm thử gửi lại. Từ PR #14: không dùng `urn:uuid:` giữa các mục của một gói; ghi theo bước, trỏ id thật; thử lại khi Medplum báo xung đột giao dịch (F11, F13) | M | M0, 1 | ✓ |
| T-OUTBOX | Gửi cổng không mất đơn | A2: outbox ý định, đối soát, gửi idempotent theo mã đơn; gộp với T-RX khi thiết kế | L | 1 | ✓ |
| T-ENC | Mã hóa cấp trường | A6: trường nào, khóa theo tenant (KMS/Vault), chỉ số mù cho CCCD | L | 0 (spike), 1 | ✓ |
| T-OFFB | Rời tenant | A4: export tự viết, lưu nhật ký ngoài, xóa Binary + file, `$expunge`, quyền | M | 0 (spike), 1 | ✓ |
| T-MIG | Công cụ chuyển dữ liệu | Excel và phần mềm cũ; kiểm tra từng phần tử `batch`, tự giảm tốc theo hạn mức, chạy lại được, báo cáo từng dòng | L | 1 | |
| T-CONSENT | Đồng ý xử lý dữ liệu | Thu thập, bằng chứng, rút lại; xuất/xóa theo yêu cầu bệnh nhân (dùng lại T-OFFB cho Binary) | M | 1 | |
| T-RX | Bộ nối Cổng Đơn thuốc QG | Sinh mã đơn, gửi, thử lại, theo dõi; bộ nối thay được (QĐ 1867/QĐ-BYT). M0 dùng cổng mô phỏng (T-SIM) | XL | 0 (spike), 1 | |
| T-SIGN | Ký số từ xa | Ký 1 đơn và ký lô; USB cho máy bàn; đo thời gian | L | 0 (spike), 1 | |
| T-OFF | Ngoại tuyến | T-OFF-0: spike; T-OFF-1: khung + outbox + idempotency + thử ngắt mạng tự động (M0, phạm vi mục 5.2); T-OFF-2: mức tối thiểu hoàn chỉnh gồm chờ ký (M1); T-OFF-3: đầy đủ (Giai đoạn 2) | XL | 0 (spike), M0, 1–2 | |
| T-PAY | Thanh toán QR | payOS/Casso hoặc tương đương; tự xác nhận; sổ thu | M | 1 | |
| T-ZALO | Zalo ZNS | Gửi đơn; (GĐ2) nhắc lịch; theo dõi chi phí tin | M | 1 | |
| T-INV | Hóa đơn điện tử | Theo NĐ 70/2025; bảng kê cho kế toán | L | 2 | |
| T-EMR | Bệnh án điện tử + khóa sau ký | Mới có lịch sử phiên bản [Đã đo]; "khóa sau ký" phải thiết kế (chính sách truy cập + bằng chứng ký) | L | 1 (tinh gọn), 2 | |
| T-CAP | Công suất và nhiều node | Nhiều bản Medplum sau cân bằng tải, S3/MinIO (F10), DB riêng; mô hình tải theo mục 3.3 dòng 3 | L | 0 (T2), 2 | ✓ |
| T-HA | Chạy nhiều bản Medplum | Kiểm chứng migration lúc khởi động (F9), lưu trữ tệp | M | 2 | |
| T-DR | Sao lưu liên tục và dự phòng | WAL/PITR, vùng thứ hai; mất ≤ 15 phút, khôi phục ≤ 1 giờ; diễn tập | L | 0 (T3), 2 | |
| T-UPG | Nâng cấp và chính sách phiên bản | Chốt "LTS" (Q12); ghim; staging bắt buộc; theo dõi phát hành hàng tuần; 20% thời gian đội cho bảo trì | M | 0, liên tục | |
| T-OBS | Quan sát | OpenTelemetry (đã có móc), thời gian từng thao tác theo phòng khám, cảnh báo | M | 1 | |
| T-IAC | Hạ tầng dạng mã | Dựng lại trong < 1 giờ (cam kết báo cáo). M0: staging | L | M0, 1 | |
| T-COST | Mô hình chi phí | Một mô hình duy nhất, từ số đo; giải quyết 15/25/60 triệu | S | 0 | |
| T-LEGAL | Hồ sơ mẫu cho phòng khám | DPIA, quy chế, hợp đồng, DPA; bảo hiểm trách nhiệm; quy trình sự cố 72 giờ | L | 0–2 | |

### 6 trụ cột: cam kết và nơi kiểm chứng

| Trụ cột | Cam kết (TL34 / báo cáo) | Công việc / bằng chứng |
|---|---|---|
| An toàn | Ngăn dữ liệu riêng; MFA; ghi mọi lần xem; dữ liệu trong nước | Cách ly [Đã đo] (F6); T-IDP, T-AUD (có điều kiện), T-EGR, T-ENC |
| Tin cậy | 99,9%; RPO 15 phút, RTO 1 giờ; không mất đơn | T-DR (T3), T-OUTBOX |
| Luôn sẵn sàng | Đa vùng, nhiều bản, ngoại tuyến | T-HA, T-DR, T-OFF (T6) |
| Mở rộng | 20 → 5.000 tenant; thử tải 3× | T2, T-CAP, T-QUOTA |
| Nhanh | 0,2 / 0,4 / 2 giây | T2, T8 (số sơ bộ ở mục 2 đạt ở quy mô nhỏ) |
| Bền vững | Không fork; 20% bảo trì; dựng lại < 1 giờ | T-UPG, T-IAC, T-COST |

---

## 9. Quyết định cần chốt

| # | Câu hỏi | Vì sao quan trọng |
|---|---|---|
| Q1 | Nhà đầu tư chấp thuận T1–T10 và ngày bắt đầu 05/10/2026? Con số chi phí nào đúng (15/25/60 triệu)? **Đội Giai đoạn 0 (TL34 E.6) có sẵn từ thứ Hai tới?** | TL34 chỉ có 5 tiêu chí, bổ sung của tôi là đề xuất. Tiêu chí chi phí của TL34 thấp hơn ngân sách của chính nó |
| Q2 | Ước lượng lại phương án B, giả định lớp tích hợp là dịch vụ REST độc lập? | "+6 tuần" của TL34 có thể lạc quan (mục 3.3 dòng 4) |
| Q3 | Đơn kê khi mất mạng có hợp lệ không, và nhà thuốc có bán được thuốc trước khi đơn lên cổng không? Cổng có cho cấp trước mã đơn? | Ký số và gửi cổng đều cần mạng; nếu nhà thuốc tra mã trên cổng thì bệnh nhân chưa mua được thuốc cho đến khi đồng bộ. Cần trước khi bán lời hứa "không dừng buổi khám khi mất mạng" |
| Q4 | Hạn bệnh án điện tử 31/12/2026 nằm trước pilot (03/2027). Chấp nhận mốc trôi qua, hay đưa bệnh án tối thiểu hợp lệ vào bản có thể dùng sớm hơn? Gói Khởi đầu không có bệnh án điện tử có đủ pháp lý? | Mục 3.3 dòng 6 |
| Q5 | Chữ ký số cho bệnh án điện tử: từng phiên khám hay theo lô? | Quyết định T1 và T-EMR |
| Q6 | Mã hóa cấp trường: trường nào, và chấp nhận mất tìm kiếm phía server cho các trường đó? | Mục 3.2 dòng 10 |
| Q7 | Xác thực nhân viên: người dùng Medplum hay IdP riêng? | F2 |
| Q8 | Ngân sách Giai đoạn 0: "12% (khoảng 0,8–1,1 tỷ)" hay "dưới 1 tỷ"? | 12% × 9,0 tỷ = 1,08 tỷ; hai chỗ trong báo cáo không khớp ở cận trên |
| Q9 | Tên miền/định danh chuẩn cho hồ sơ FHIR của UNIGIS? | Đang dùng URN tạm (`urn:phongmach:…`); đổi sau khi có dữ liệu thật rất tốn |
| Q10 | Nhà cung cấp cloud nào, có hai trung tâm ở hai thành phố? | T2, T-DR, chi phí; cần tài khoản thử từ tuần 1 |
| Q11 | ~~Phạm vi Giai đoạn 1~~ **Đã chốt 02/10/2026**: làm sớm (xây từ 05/10) và cắt phạm vi (mục 6.2) | Cần 12 sprint so với khoảng 10,5 sprint năng lực; thiếu khoảng 1,5 sprint, bù bằng danh sách cắt |
| Q12 | "Nhánh LTS" là gì: dòng 3.x (npm `backport`, 3.3.1) hay bám 5.x? | Đã cài 5.2.0; không có tag LTS; dữ liệu và migration không hạ cấp được, nên chọn sớm; chạy lại smoke test trên 3.3.1 trước khi quyết |
| Q13 | Mức chi tiết và lưu giữ của nhật ký truy cập (từng lần đọc hay "mở hồ sơ")? | Ước tính 1–13 TB/năm ở 300 tenant nếu lưu mọi thao tác trong Medplum |
| Q14 | Xác nhận định nghĩa MVP trình nhà đầu tư (M0, mục 5): khán giả và ngày (họp đi/không đi 13/11), và chấp nhận cổng đơn thuốc, ký số, Zalo mô phỏng có ghi rõ? | Tôi giả định "thuyết phục nhà đầu tư" là cuộc họp 13/11. Nếu cần demo sớm hơn, hoặc cần tích hợp thật, phạm vi và lịch phải đổi |
| Q15 | Hai chuyên khoa cho M0? Đề xuất nội tổng quát và nhi | Quyết định danh mục ICD-10, đơn mẫu và bác sĩ dùng thử; cần cố vấn y khoa của hai chuyên khoa |
| Q16 | M0 chạy ở đâu khi trình diễn: hạ tầng nhà cung cấp trong nước (đề xuất, nếu có tài khoản thử từ tuần 2) hay máy cục bộ? | Nhà đầu tư thấy "dữ liệu trong nước" chạy thật; gắn với Q10 |

---

## 10. Rủi ro bổ sung so với báo cáo và TL34

| Rủi ro | Mức | Kiểm soát |
|---|---|---|
| Phạm vi vượt năng lực (cần 12 sprint, có ≈ 10,5) dù đã bắt đầu sớm | Trung bình–cao | Danh sách cắt (mục 6.2); theo dõi tốc độ từ M0-S2; cắt thêm theo thứ tự đã định |
| Đơn đã ký nhưng không được gửi do ghi kép Medplum/outbox | Cao | A2, T-OUTBOX, bộ quét đối soát; kiểm thử mất điện giữa hai bước |
| Lời hứa ngoại tuyến vượt thực tế pháp lý/kỹ thuật (Q3) | Cao | Chốt Q3 trước khi đưa vào tài liệu bán hàng |
| Tenant rời đi mà ảnh, PDF vẫn nằm trên hệ thống; export lộ `secret` | Cao | A4, T-OFFB, T7 |
| Nhật ký truy cập phình quá nhanh hoặc bị mất khi DB quá tải | Trung bình–cao | A3, Q13; đo ở T2 |
| Nhập dữ liệu hàng loạt thất bại âm thầm (F5) | Cao | T-MIG kiểm tra từng phần tử; đếm lại số bản ghi |
| Phụ thuộc dịch vụ nước ngoài trên đường xác thực (F2) | Trung bình | A8, T-EGR |
| Nhiều phòng khám sau cùng một IP chạm hạn mức đăng nhập (F5) | Trung bình | T-QUOTA, proxy chuyển IP thật |
| Mã hóa cấp trường làm hỏng tìm kiếm và `If-None-Exist` theo CCCD | Trung bình | A6, T-ENC, T8 |
| Tiêu chí "đi" tự mâu thuẫn (chi phí) khiến quyết định ngày 13/11 bị tranh cãi | Trung bình | Q1 trước tuần 1 |
| Demo bị hiểu là đã tích hợp thật; nhà đầu tư thẩm định phát hiện phần mô phỏng | Cao | Nhãn "mô phỏng" trên màn hình; trang "đã thật / mô phỏng / chưa làm"; tiêu chí M0-5 |
| Chia năng lực giữa M0 và kiểm chứng làm cả hai chậm | Trung bình–cao | Hai luồng phân công riêng (mục 5.3), không rút người của nhau; cắt thêm M0 nếu M0-S2 trượt |
| Tài liệu API cổng quốc gia đến muộn (TL34 Q1, hạn tuần 3) | Cao | Cổng mô phỏng sau giao diện chuẩn (T-SIM); bộ nối thật bắt đầu khi có tài liệu; T1 phản ánh tình trạng này |
| M0 trông hoàn thiện hơn thực tế, kéo kỳ vọng về thời gian ra pilot | Trung bình | Trình bày M0 cùng danh sách cắt và lịch M1 (mục 6) |
