# Kế hoạch triển khai chi tiết — PHONGMACH

Cập nhật 02/10/2026 (lần 2). Dựa trên ba nguồn:

1. Báo cáo "Quản lý Phòng mạch Việt Nam" v2.0 (29/09/2026), viết cho nhà đầu tư.
2. Tài liệu nội bộ "Phân tích – Kế hoạch triển khai SaaS Quản lý Phòng mạch" v1.0 (29/09/2026, 34 trang), viết tắt **TL34**.
3. Kết quả cài và thử backend Medplum 5.2.0 trong `infra/medplum/`.

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

1. **Lịch Giai đoạn 1 không khớp**: TL34 liệt kê 12 sprint (S1–S12) nhưng giai đoạn chỉ dài khoảng 17 tuần, trừ Tết còn khoảng 8 sprint. Phải cắt phạm vi, bắt đầu sớm, hoặc lùi pilot (mục 6).
2. **"Xóa trọn project" không xóa hết**: `$expunge` xóa dữ liệu và cả nhật ký truy cập nhưng **để lại ảnh/PDF (`Binary`)**; export cấp project **không có Binary** và **lộ `secret` của tài khoản máy** (mục 3.2).
3. **Nhật ký truy cập tốn kém hơn dự tính**: một lần đọc = một dòng ≈ 5 KB, tìm kiếm không được lưu, và việc ghi không đợi kết quả. Ở 300 phòng khám có thể là 1–13 TB/năm, lớn hơn cả dữ liệu lâm sàng (mục 3.2).
4. **Idempotency theo "UUID client" phải đổi cách làm**: Medplum không cho `PUT` tạo mới với id do client chọn. Dùng `If-None-Exist` theo identifier (đã thử, hoạt động) (mục 4).
5. **Ba con số chi phí hạ tầng mâu thuẫn nhau** trong TL34 (15, 25 và 60 triệu đ/tháng cho 300 phòng khám), cần một mô hình duy nhất trước khi dùng làm tiêu chí "đi" (mục 3.3).

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

### Chưa thử

Giao diện web Medplum, Bot, Subscription (webhook), xác thực hai lớp, chạy nhiều bản server, nâng cấp phiên bản, PITR, ảnh Docker 3.x, mã hóa cấp trường,
lưu trữ S3/MinIO, mọi bộ nối (Cổng Đơn thuốc, ký số, Zalo, thanh toán, hóa đơn điện tử), ngoại tuyến, phương án B.

### Phát hiện từ việc cài đặt (F1–F10)

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
| 7 | "Transactional outbox": ghi MedicationRequest vào Medplum và outbox "GửiĐơnQuốcGia" **cùng giao dịch** (C.5 bước 4) | Không khả thi như mô tả: ghi vào Medplum đi qua API của nó, ghi outbox nằm ở DB của BFF, **không có giao dịch chung** (ghi kép). Mất điện giữa hai bước làm đơn đã ký mà không được gửi, hoặc ngược lại | [Phân tích] | Ghi ý định gửi trước, ghi FHIR idempotent theo mã đơn, và có bộ quét đối soát định kỳ tìm đơn đã ký chưa có trạng thái liên thông (T-OUTBOX) |
| 8 | Tìm 4 số cuối điện thoại dưới 200 ms (D.5) | 6–7 ms ở 20.000 bệnh nhân/project. Tìm không dấu thì hỏng (F4). TL34 tìm trong cache client trước nên không dấu phải được chuẩn hóa ở client, còn phía server vẫn cần T-NAME | [Đã đo] | Giữ ngân sách; thêm kiểm tra ở quy mô 500 tenant (T2) |
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
| 1 | **12 sprint trong một giai đoạn 4 tháng** (E.3) | S1–S2, S3–S4, S5–S6, S7–S8, S9, S10, S11–S12 = 12 sprint = 24 tuần. Giai đoạn 12/2026–03/2027 dài khoảng 17 tuần, trừ Tết (khoảng 06/02/2027) còn khoảng 8 sprint. Thiếu 3–4 sprint, khoảng một phần tư phạm vi | Mục 6 |
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
| A1 | **Idempotency**: UUID do client sinh lưu thành `identifier` (ví dụ `urn:phongmach:client-uuid`), ghi bằng create có điều kiện (`If-None-Exist`), dùng transaction bundle có `urn:uuid:` để nối tham chiếu giữa các bản ghi tạo khi ngoại tuyến. Không dùng `PUT` theo id | Medplum từ chối `PUT` tạo mới theo id client (404); `If-None-Exist` đã thử, không tạo trùng |
| A2 | **Gửi cổng không dựa vào "cùng giao dịch"**: ghi ý định gửi (outbox) trước → transaction bundle idempotent → worker gửi cổng idempotent theo mã đơn → **bộ quét đối soát** tìm MedicationRequest đã ký chưa có trạng thái liên thông. Subscription của Medplum chỉ là tín hiệu phụ, chưa kiểm chứng | Ghi kép giữa Medplum và DB của BFF |
| A3 | **Nhật ký hai tầng**: (a) nhật ký truy cập ở BFF, ghi đồng bộ, chi tiết theo "mở hồ sơ / tìm kiếm / xuất", lưu ra kho bất biến ngoài Medplum; (b) `saveAuditEvents` của Medplum chỉ cho ghi/sửa/xóa lâm sàng. Quyết định cuối sau khi đo ở T2 | Khối lượng đọc, tìm kiếm không có sự kiện, ghi không đợi, xóa tenant xóa nhật ký |
| A4 | **Quy trình rời tenant** riêng: export tự viết (gồm Binary, loại bỏ `secret`), lưu nhật ký ra ngoài, xóa Binary và file riêng, rồi mới `$expunge`; tenant admin không có quyền `$expunge` | Mục 3.2 dòng 3–4 |
| A5 | **Danh mục dùng chung** (ICD-10, thuốc, dịch vụ mẫu) trong một project riêng, các phòng khám `Project.link` tới | Q7 |
| A6 | **Mã hóa cấp trường + chỉ số mù** cho CCCD và trường nhạy cảm; quyết định trường nào, vì sao các tìm kiếm còn lại không bị ảnh hưởng | Mục 3.2 dòng 10 |
| A7 | **Chuẩn hóa tên không dấu** ở lớp dịch vụ khi ghi (thêm `HumanName` thứ hai) hoặc `SearchParameter` tùy biến; ở client thì chuẩn hóa khi tìm trong cache | F4 |
| A8 | **Xác thực nhân viên**: chốt người dùng Medplum (kèm TOTP, chấp nhận egress HIBP qua proxy) hay IdP riêng của UNIGIS ánh xạ vào Medplum | F2 |
| A9 | **Công suất**: nhiều bản Medplum sau cân bằng tải, object storage S3-compatible, DB riêng khỏi bộ tạo tải; đặt `userFhirQuota`/`totalFhirQuota` theo từng project | Mục 2 (một node bão hòa ≈ 700 req/s), F5, F10 |

---

## 5. Giai đoạn 0 — Kiểm chứng (6 tuần)

Giả định bắt đầu thứ Hai **05/10/2026**, kết thúc **13/11/2026** (TL34 và báo cáo: "10–11/2026, 6 tuần"). Ngân sách ≈ 12% tổng (xem Q8).
Phần đã làm sẵn: môi trường Medplum chạy được, smoke test, bộ số đo cơ sở (mục 2) và các script thử nghiệm.

### 5.1 Tiêu chí "đi / không đi"

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

### 5.2 Kế hoạch từng tuần (hợp nhất TL34 E.2 và các phép thử mới)

| Tuần | Công việc | Sản phẩm bàn giao |
|---|---|---|
| 1 (05–09/10) | Khởi động; chốt tiêu chí T1–T10 và giải quyết con số chi phí (Q1); gửi thư xin tài liệu API cổng đơn thuốc + sandbox (TL34 Q1) và hỏi Cục QLKCB về độ trễ khi mất mạng và mã đơn cấp trước (Q4); xin tài khoản thử của 2–3 nhà cung cấp cloud trong nước và 2–3 nhà cung cấp ký số; lên lịch phỏng vấn, quan sát; xử lý T-SEC0 cho staging | Thư đã gửi; lịch phỏng vấn; tài khoản thử; staging 1 |
| 2 (12–16/10) | Phỏng vấn/quan sát; đọc toàn văn NĐ 90/2026 (TL34 Q2); PoC Medplum trên K8s nhà cung cấp A; khung BFF; bộ sinh dữ liệu 500 × 5.000 (kiểm tra từng phần tử, F5); thiết kế T-IDP; bắt đầu ADR | Ghi chép quan sát; PoC v0; dữ liệu giả lập |
| 3 (19–23/10) | Hạn Q1, Q7, Q8; spike ngoại tuyến (T-OFF-0) và idempotency (A1); quyết định T-NAME; tải vòng 1 (T2) trên nhà cung cấp A | Prototype ngoại tuyến; số đo T2 vòng 1 |
| 4 (26–30/10) | Hạn Q3, Q4, Q6, Q9; spike bộ nối cổng đơn thuốc (T1) và ký số nhà cung cấp 1; tải trên nhà cung cấp B; spike mã hóa cấp trường + chỉ số mù (A6); kiểm tra khối lượng nhật ký (A3) | Số đo T1 sơ bộ; so sánh A/B |
| 5 (02–06/11) | Hạn Q5; ký số nhà cung cấp 2; diễn tập nâng cấp + PITR (T3); 100 chu kỳ ngoại tuyến (T6); quy trình rời tenant (T7); prototype giao diện thử với 5 bác sĩ | Biên bản T3; kết quả T6, T7; phản hồi giao diện |
| 6 (09–13/11) | Tổng hợp; mô hình chi phí (T5); báo cáo T4; hạn Q10; backlog MVP, tuyển dụng bổ sung, repo/CI/IaC; **họp quyết định đi/không đi 13/11** | Biên bản quyết định; ngân sách chốt lại (±30% → ±15%) |

Suốt giai đoạn: theo dõi văn bản pháp luật hàng tuần (rủi ro số một của cả hai tài liệu).

---

## 6. Giai đoạn 1 — Sản phẩm đầu tiên (12/2026 – 03/2027)

Mục tiêu thoát giai đoạn theo TL34: ≥ 80% phiên khám thường quy dưới 90 giây, NPS bác sĩ ≥ 40, ≥ 98% đơn gửi cổng trong 5 phút và 0 đơn mất,
0 lỗi bảo mật mức cao, kiểm thử cách ly đạt, DPIA và DPA ký với 100% phòng khám pilot, uptime luồng lõi ≥ 99,5% trong 2 tháng pilot.

**Vấn đề**: TL34 có 12 sprint (24 tuần) cho khoảng 17 tuần, trừ Tết còn khoảng 16 tuần, tức khoảng 8 sprint (mục 3.3 dòng 1). Hai cách xử lý, có thể kết hợp:

| Cách | Hệ quả |
|---|---|
| **A. Bắt đầu sớm 2 tuần (16/11), chỉ khi quyết định "đi" ngày 13/11** | Được khoảng 9 sprint; việc dựng repo/CI/IaC của tuần 5–6 giai đoạn 0 (TL34) tạo đà. Vẫn thiếu 3 sprint |
| **B. Cắt phạm vi khoảng một phần tư** | Xem danh sách đề xuất bên dưới; PO và nhà đầu tư chốt |
| C. Lùi thoát pilot đến khoảng 05/2027 | Giữ phạm vi; kéo theo ra mắt thương mại (05–06/2027) và mốc 100 tenant |

Đề xuất [Đề xuất]: **A + B**. Giữ nguyên các mục bắt buộc: tiếp đón, khám, kê đơn, ký số, gửi cổng, in, nhập Excel (thị trường thay thế cần), ngoại tuyến mức tối thiểu,
cách ly tenant, DPIA/DPA, nhật ký truy cập. Hoãn sang Giai đoạn 2:

- nhắc lịch/hẹn tái khám qua ZNS (giữ ZNS gửi đơn thuốc);
- báo cáo doanh thu (giữ sổ thu ngày);
- onboarding tự phục vụ dưới 30 phút (pilot 15–20 phòng được hỗ trợ trực tiếp);
- diễn tập DR đầy đủ (vùng 2 vốn thuộc Giai đoạn 2 theo TL34; Giai đoạn 1 chỉ kiểm thử khôi phục sao lưu hàng tháng).

Lịch 9 sprint, giả định nghỉ Tết **06–14/02/2027** (xác nhận lịch nghỉ chính thức):

| Sprint | Thời gian | Nội dung | Công việc |
|---|---|---|---|
| S1 | 16–29/11 | Nền móng | Repo, CI/CD, IaC, staging (T-IAC); cấp phòng khám tự động (T-TEN); hồ sơ FHIR (T-FHIR); hạn mức (T-QUOTA); T-SEC0 |
| S2 | 30/11–13/12 | Tiếp đón 1 | Tìm/tạo bệnh nhân + chuẩn hóa tên (T-NAME); đồng ý điện tử (T-CONSENT); khung PWA, outbox ngoại tuyến (T-OFF-1); idempotency (T-IDEM); nhật ký ở BFF (T-AUD) |
| S3 | 14–27/12 | Tiếp đón 2 + khám 1 | Hàng chờ, màn hình chờ, quy tắc ưu tiên; nhập Excel (T-MIG); màn hình khám một trang |
| S4 | 28/12–10/01 | Khám 2 | Mẫu khám theo chuyên khoa, ICD-10, ảnh đính kèm, ký phiếu khám; danh mục thuốc và đơn mẫu (A5) |
| S5 | 11–24/01 | Kê đơn | Kê lại một nút; kiểm tra trùng thuốc/dị ứng/số ngày; in A5/A4; bộ nối cổng trên sandbox (T-RX) |
| S6 | 25/01–05/02 | Ký số và gửi | Ký số tích hợp (T-SIGN); outbox, thử lại, hàng đợi lỗi, bộ quét đối soát (T-OUTBOX); màn hình "đơn chưa gửi được" |
| — | 06–14/02 | Nghỉ Tết | Kiểm thử nội bộ nhẹ nếu cần |
| S7 | 15–28/02 | Thu tiền và Zalo | QR động tự xác nhận, sổ thu ngày (T-PAY); ZNS gửi đơn (T-ZALO); ngoại tuyến mức tối thiểu hoàn chỉnh (T-OFF-2) |
| S8 | 01–14/03 | Cứng hóa | Kiểm thử bảo mật nội bộ, cách ly tenant, tải; kiểm thử ngoại tuyến tự động; DPIA/DPA; quy trình rời tenant (T-OFFB); bộ tài liệu cài đặt; pilot đợt 1 (5 phòng) |
| S9 | 15–31/03 | Pilot | 15–20 phòng, chạy song song hai tuần với phần mềm cũ; đo KPI; sửa lỗi; báo cáo pilot, quyết định ra mắt thương mại |

---

## 7. Giai đoạn 2 và 3

Ở mức đầu việc theo TL34 (E.4, E.5), chi tiết hóa lại ở cuối giai đoạn trước:

- **Giai đoạn 2 (04–07/2027)**: bệnh án điện tử đầy đủ theo TT 13/2025 và TT 32/2023, khóa sau ký (T-EMR); hóa đơn điện tử (T-INV); đặt lịch Zalo, nhắc lịch, kịch bản chăm sóc; nhiều cơ sở và phân quyền chi tiết; ngoại tuyến hoàn chỉnh (T-OFF-3, ký lô, ứng dụng ký USB cho máy bàn, tablet đóng gói); vùng thứ hai và diễn tập DR (T-DR); kiểm tra bảo mật độc lập; onboarding tự phục vụ; hoàn tất các việc đã hoãn ở mục 6; ra mắt thương mại 05–06/2027. Thoát: 100 tenant trả phí, churn < 3%/tháng, SLO 99,9% hai tháng liên tiếp, 100% gói Chuyên nghiệp có bệnh án điện tử hợp lệ.
- **Giai đoạn 3 (08–12/2027)**: Sổ sức khỏe điện tử/VNeID (phụ thuộc hướng dẫn kỹ thuật, TL34 Q5); nhà thuốc trực thuộc; chuyên khoa sâu; khám từ xa; trợ lý AI; tương tác thuốc (nguồn dữ liệu có bản quyền); ISO 27001; API mở. Thoát: 300 tenant trả phí, NPS ≥ 50, hai đối tác tích hợp hoạt động.

---

## 8. Danh mục công việc kỹ thuật

Cỡ: S ≤ 1 tuần-người, M 1–3, L 3–8, XL > 8 (ước lượng thô, chuẩn hóa sau Giai đoạn 0). Mục "Mới" là việc phát sinh từ thử nghiệm.

| Mã | Công việc | Chi tiết | Cỡ | GĐ | Mới |
|---|---|---|---|---|---|
| T-SEC0 | Vô hiệu tài khoản mặc định, quản lý bí mật | Xóa/đổi `admin@example.com`; đổi mật khẩu qua API cần egress HIBP (F2) nên cần quy trình thay thế được duyệt; khóa ký trong kho bí mật; tắt tự đăng ký | M | 0, 1 | |
| T-IDP | Xác thực nhân viên | Người dùng Medplum (TOTP, dính F2) hay IdP riêng; xác thực hai lớp cho người ký | M | 0 | |
| T-EGR | Kiểm soát egress | Danh sách host được phép, chặn mặc định; xác định host của kiểm tra phiên bản (F7); proxy hay thay thế cho HIBP | S | 0, 1 | |
| T-TEN | Cấp phòng khám | Dịch vụ tạo `Project`, `ClientApplication`, `AccessPolicy`, hạn mức, `Project.link` tới danh mục; tạo/tạm khóa/xóa; không dùng quyền siêu quản trị cho vận hành thường xuyên | L | 1 | |
| T-QUOTA | Hạn mức | `userFhirQuota`/`totalFhirQuota` từng project; tài khoản nhập dữ liệu hạn mức cao; proxy chuyển IP thật để hạn mức đăng nhập không gộp phòng khám | S | 1 | |
| T-AUD | Nhật ký truy cập | Kiến trúc hai tầng (A3); nhật ký BFF cho mở hồ sơ/tìm kiếm/xuất; kho bất biến; phân vùng và lưu giữ AuditEvent; cảnh báo truy cập bất thường | L | 0, 1 | |
| T-NAME | Tìm tên không dấu | Hai hướng ở A7; gồm xếp hạng kết quả theo 4 số cuối | M | 0, 1 | |
| T-FHIR | Hồ sơ FHIR và định danh | `StructureDefinition` cho CCCD, mã đơn, ICD-10; định danh chuẩn thay URN tạm | M | 1 | |
| T-IDEM | Ghi lặp lại được | A1: identifier + `If-None-Exist`, `urn:uuid:` trong transaction, kiểm thử gửi lại | M | 1 | ✓ |
| T-OUTBOX | Gửi cổng không mất đơn | A2: outbox ý định, đối soát, gửi idempotent theo mã đơn; gộp với T-RX khi thiết kế | L | 1 | ✓ |
| T-ENC | Mã hóa cấp trường | A6: trường nào, khóa theo tenant (KMS/Vault), chỉ số mù cho CCCD | L | 0 (spike), 1 | ✓ |
| T-OFFB | Rời tenant | A4: export tự viết, lưu nhật ký ngoài, xóa Binary + file, `$expunge`, quyền | M | 0 (spike), 1 | ✓ |
| T-MIG | Công cụ chuyển dữ liệu | Excel và phần mềm cũ; kiểm tra từng phần tử `batch`, tự giảm tốc theo hạn mức, chạy lại được, báo cáo từng dòng | L | 1 | |
| T-CONSENT | Đồng ý xử lý dữ liệu | Thu thập, bằng chứng, rút lại; xuất/xóa theo yêu cầu bệnh nhân (dùng lại T-OFFB cho Binary) | M | 1 | |
| T-RX | Bộ nối Cổng Đơn thuốc QG | Sinh mã đơn, gửi, thử lại, theo dõi; bộ nối thay được (QĐ 1867/QĐ-BYT) | XL | 0 (spike), 1 | |
| T-SIGN | Ký số từ xa | Ký 1 đơn và ký lô; USB cho máy bàn; đo thời gian | L | 0 (spike), 1 | |
| T-OFF | Ngoại tuyến | 0: spike; 1: khung + outbox + idempotency + thử ngắt mạng tự động; 2: tối thiểu hoàn chỉnh; 3: đầy đủ | XL | 0–2 | |
| T-PAY | Thanh toán QR | payOS/Casso hoặc tương đương; tự xác nhận; sổ thu | M | 1 | |
| T-ZALO | Zalo ZNS | Gửi đơn; (GĐ2) nhắc lịch; theo dõi chi phí tin | M | 1 | |
| T-INV | Hóa đơn điện tử | Theo NĐ 70/2025; bảng kê cho kế toán | L | 2 | |
| T-EMR | Bệnh án điện tử + khóa sau ký | Mới có lịch sử phiên bản [Đã đo]; "khóa sau ký" phải thiết kế (chính sách truy cập + bằng chứng ký) | L | 1 (tinh gọn), 2 | |
| T-CAP | Công suất và nhiều node | Nhiều bản Medplum sau cân bằng tải, S3/MinIO (F10), DB riêng; mô hình tải theo mục 3.3 dòng 3 | L | 0 (T2), 2 | ✓ |
| T-HA | Chạy nhiều bản Medplum | Kiểm chứng migration lúc khởi động (F9), lưu trữ tệp | M | 2 | |
| T-DR | Sao lưu liên tục và dự phòng | WAL/PITR, vùng thứ hai; mất ≤ 15 phút, khôi phục ≤ 1 giờ; diễn tập | L | 0 (T3), 2 | |
| T-UPG | Nâng cấp và chính sách phiên bản | Chốt "LTS" (Q12); ghim; staging bắt buộc; theo dõi phát hành hàng tuần; 20% thời gian đội cho bảo trì | M | 0, liên tục | |
| T-OBS | Quan sát | OpenTelemetry (đã có móc), thời gian từng thao tác theo phòng khám, cảnh báo | M | 1 | |
| T-IAC | Hạ tầng dạng mã | Dựng lại trong < 1 giờ (cam kết báo cáo) | L | 1 | |
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
| Q1 | Nhà đầu tư chấp thuận T1–T10 và ngày bắt đầu 05/10/2026? Con số chi phí nào đúng (15/25/60 triệu)? | TL34 chỉ có 5 tiêu chí, bổ sung của tôi là đề xuất. Tiêu chí chi phí của TL34 thấp hơn ngân sách của chính nó |
| Q2 | Ước lượng lại phương án B, giả định lớp tích hợp là dịch vụ REST độc lập? | "+6 tuần" của TL34 có thể lạc quan (mục 3.3 dòng 4) |
| Q3 | Đơn kê khi mất mạng có hợp lệ không, và nhà thuốc có bán được thuốc trước khi đơn lên cổng không? Cổng có cho cấp trước mã đơn? | Ký số và gửi cổng đều cần mạng; nếu nhà thuốc tra mã trên cổng thì bệnh nhân chưa mua được thuốc cho đến khi đồng bộ. Cần trước khi bán lời hứa "không dừng buổi khám khi mất mạng" |
| Q4 | Hạn bệnh án điện tử 31/12/2026 nằm trước pilot (03/2027). Chấp nhận mốc trôi qua, hay đưa bệnh án tối thiểu hợp lệ vào bản có thể dùng sớm hơn? Gói Khởi đầu không có bệnh án điện tử có đủ pháp lý? | Mục 3.3 dòng 6 |
| Q5 | Chữ ký số cho bệnh án điện tử: từng phiên khám hay theo lô? | Quyết định T1 và T-EMR |
| Q6 | Mã hóa cấp trường: trường nào, và chấp nhận mất tìm kiếm phía server cho các trường đó? | Mục 3.2 dòng 10 |
| Q7 | Xác thực nhân viên: người dùng Medplum hay IdP riêng? | F2 |
| Q8 | Ngân sách Giai đoạn 0: "12% (khoảng 0,8–1,1 tỷ)" hay "dưới 1 tỷ"? | 12% × 9,0 tỷ = 1,08 tỷ; hai chỗ trong báo cáo không khớp ở cận trên |
| Q9 | Tên miền/định danh chuẩn cho hồ sơ FHIR của UNIGIS? | Đang dùng URN tạm (`urn:phongmach:…`); đổi sau khi có dữ liệu thật rất tốn |
| Q10 | Nhà cung cấp cloud nào, có hai trung tâm ở hai thành phố? | T2, T-DR, chi phí; cần tài khoản thử từ tuần 1 |
| Q11 | **Phạm vi Giai đoạn 1**: A + B (bắt đầu sớm, cắt các mục ở mục 6), hay lùi pilot (C)? | 12 sprint không vừa khoảng 8–9 sprint |
| Q12 | "Nhánh LTS" là gì: dòng 3.x (npm `backport`, 3.3.1) hay bám 5.x? | Đã cài 5.2.0; không có tag LTS; dữ liệu và migration không hạ cấp được, nên chọn sớm; chạy lại smoke test trên 3.3.1 trước khi quyết |
| Q13 | Mức chi tiết và lưu giữ của nhật ký truy cập (từng lần đọc hay "mở hồ sơ")? | Ước tính 1–13 TB/năm ở 300 tenant nếu lưu mọi thao tác trong Medplum |

---

## 10. Rủi ro bổ sung so với báo cáo và TL34

| Rủi ro | Mức | Kiểm soát |
|---|---|---|
| Phạm vi Giai đoạn 1 vượt thời gian khả dụng (12 sprint vs ≈ 8–9) | Cao | Q11; theo dõi tốc độ từ S3; giữ danh sách "hoãn" sẵn sàng |
| Đơn đã ký nhưng không được gửi do ghi kép Medplum/outbox | Cao | A2, T-OUTBOX, bộ quét đối soát; kiểm thử mất điện giữa hai bước |
| Lời hứa ngoại tuyến vượt thực tế pháp lý/kỹ thuật (Q3) | Cao | Chốt Q3 trước khi đưa vào tài liệu bán hàng |
| Tenant rời đi mà ảnh, PDF vẫn nằm trên hệ thống; export lộ `secret` | Cao | A4, T-OFFB, T7 |
| Nhật ký truy cập phình quá nhanh hoặc bị mất khi DB quá tải | Trung bình–cao | A3, Q13; đo ở T2 |
| Nhập dữ liệu hàng loạt thất bại âm thầm (F5) | Cao | T-MIG kiểm tra từng phần tử; đếm lại số bản ghi |
| Phụ thuộc dịch vụ nước ngoài trên đường xác thực (F2) | Trung bình | A8, T-EGR |
| Nhiều phòng khám sau cùng một IP chạm hạn mức đăng nhập (F5) | Trung bình | T-QUOTA, proxy chuyển IP thật |
| Mã hóa cấp trường làm hỏng tìm kiếm và `If-None-Exist` theo CCCD | Trung bình | A6, T-ENC, T8 |
| Tiêu chí "đi" tự mâu thuẫn (chi phí) khiến quyết định ngày 13/11 bị tranh cãi | Trung bình | Q1 trước tuần 1 |
