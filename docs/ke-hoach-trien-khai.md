# Kế hoạch triển khai chi tiết — PHONGMACH

Cập nhật 02/10/2026 (lần 3). Dựa trên ba nguồn:

1. Báo cáo "Quản lý Phòng mạch Việt Nam" v2.0 (29/09/2026), viết cho nhà đầu tư.
2. Tài liệu nội bộ "Phân tích – Kế hoạch triển khai SaaS Quản lý Phòng mạch" v1.0 (29/09/2026, 34 trang), viết tắt **TL34**.
3. Kết quả cài và thử backend Medplum 5.2.0 trong `infra/medplum/`.

**Quyết định của chủ dự án (02/10/2026):** làm sớm và cắt phạm vi; nhiệm vụ là ra MVP nhanh để nhà đầu tư được thuyết phục hơn.
Hệ quả: mục 5 và 6 được viết lại quanh hai cột mốc MVP, **M0 (13/11/2026, trình nhà đầu tư)** và **M1 (31/03/2027, pilot)**.
Đội có sẵn từ 05/10 (xác nhận 02/10); **M0-S1 đã bắt đầu**, trạng thái ở mục 5.6.

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

### Chưa thử

Giao diện web Medplum, Bot, Subscription (webhook), xác thực hai lớp, chạy nhiều bản server, nâng cấp phiên bản, PITR, ảnh Docker 3.x, mã hóa cấp trường,
lưu trữ S3/MinIO, mọi bộ nối (Cổng Đơn thuốc, ký số, Zalo, thanh toán, hóa đơn điện tử), ngoại tuyến, phương án B.

### Phát hiện từ việc cài đặt và xây dựng (F1–F11)

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
| F11 | `Bundle` loại `transaction` của Medplum 5.2.0 **không nguyên tử**: một mục lỗi (412 do `If-Match` cũ, 400, 404) được báo riêng trong phản hồi **HTTP 200**, còn các mục khác vẫn được ghi. Tạo có điều kiện (`ifNoneExist`) trong gói hoạt động: mục đã có trả 200 và tham chiếu `urn:uuid:` nối vào bản ghi đã có | [Đã đo] 5 ca trên server thật: `PUT` id lạ (201,400), `GET` id lạ (201,404), `If-Match` cũ (201,201,412 và 2 bản ghi vẫn được tạo), tạo có điều kiện trùng (201,200); chạy lại cùng gói sau lỗi 412 cho toàn 200, không bản ghi trùng, mọi tham chiếu đúng | Không được dựa vào hoàn tác hay vào `If-Match` trong gói để chặn ghi đồng thời. Mọi gói ghi nhiều bản ghi phải **chạy lại được** (định danh xác định + `ifNoneExist`), có một mục "điểm chốt" đứng cuối, và người gọi phải kiểm tra từng mục của phản hồi | T-IDEM, T-OUTBOX |

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
| A2 | **Gửi cổng không dựa vào "cùng giao dịch"**: ghi ý định gửi (outbox) trước → transaction bundle idempotent → worker gửi cổng idempotent theo mã đơn → **bộ quét đối soát** tìm MedicationRequest đã ký chưa có trạng thái liên thông. Subscription của Medplum chỉ là tín hiệu phụ, chưa kiểm chứng | Ghi kép giữa Medplum và DB của BFF. **Đã làm ở M0-S2**: outbox là `Task` `send-prescription` nằm trong Medplum, ghi cùng gói với đơn (nên không còn ghi kép giữa hai kho). Vì gói không nguyên tử (F11): mọi mục có định danh xác định theo `clientUuid` (chạy lại hội tụ), mục đóng lượt khám đứng cuối làm điểm chốt, worker chỉ gửi đơn của lượt khám đã đóng, gửi idempotent theo mã đơn. Bộ quét đối soát vẫn là việc của M1 |
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
| Ngoại tuyến | Tiếp đón, khám, kê đơn, in khi mất mạng; đồng bộ khi có mạng; 0 mất, 0 trùng; kịch bản ngắt mạng ngay trên sân khấu | | Chờ ký và gửi khi mất mạng ở mức đầy đủ, xung đột sửa đồng thời, cache toàn bộ 20.000 bệnh nhân |
| Zalo | | Nút "gửi đơn qua Zalo" hiện bản xem trước tin nhắn, không gửi | ZNS thật, nhắc lịch |
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
4. Ngắt mạng giữa buổi khám: tiếp đón, khám, kê đơn, in vẫn chạy; bật lại, đồng bộ, không trùng (2 phút).
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
| Ngoại tuyến | Chưa (M0-S3) | |

Kiểm thử đã chạy: 16 (danh mục) + 25 (quy tắc) + 34 (mô hình) + 30 (clinical) + 76 (BFF đơn vị) + 36 (web) kiểm thử đơn vị; 35 kiểm thử tích hợp với Medplum thật (gồm 21 mới về luồng khám); 13 + 21 bước đầu-cuối trên Chromium thật, cũng chạy được trên bản build production. Các kiểm thử an toàn quan trọng (phân quyền, quy tắc kê đơn ở server, thoát ký tự HTML) đã được xác nhận thất bại khi gỡ biện pháp tương ứng. CI có thêm job e2e (Chromium trên Medplum thật); cả ba job (kiểu + đơn vị + build, tích hợp, e2e) đã đạt trên GitHub ở commit `7a8c626`. Lần đầu job tích hợp đỏ vì một bài thử lại dựa vào thời gian thật (hạn 40 ms) trên runner chậm và để cổng mô phỏng ở trạng thái lỗi cho các bài sau; đã đổi sang thời gian ảo và đặt lại cổng trước mỗi bài.

Bài học từ M0-S2:

1. **Medplum không hoàn tác `transaction` (F11).** Phát hiện khi kiểm tra `If-Match`: lần ghi bị 412 vẫn để lại các bản ghi khác. Thiết kế "đóng lượt khám + đơn + outbox trong một giao dịch" phải đổi thành gói chạy lại được với điểm chốt đứng cuối (xem A2). Có kiểm thử tích hợp tạo đúng tình huống này (chèn một lần sửa vào giữa), xác nhận đơn **không** được gửi khi lượt khám chưa đóng, rồi chạy lại cùng `clientUuid` hội tụ không trùng.
2. **Thiếu ngày sinh làm quy tắc theo tuổi im lặng bỏ qua** (trẻ em, CCCD). Đã thêm quy tắc "chưa có ngày sinh" buộc bác sĩ xác nhận, và cho phụ tá bổ sung CCCD và ngày sinh ngay ở màn hình tiếp đón.
3. **Chạy lại sau khi đã ký không được bị quy tắc từ chối.** Nếu phụ tá thêm dị ứng sau khi đơn đã ký, bấm lại "Ký" (mất mạng, bấm đúp) phải trả lại đơn cũ chứ không báo lỗi quy tắc. Có kiểm thử.
4. **Dữ liệu thăm dò làm bẩn dữ liệu demo**: các lần thử ban đầu tạo lượt khám số 7xx–9xx trong phòng khám demo làm sai số thứ tự và lịch sử. Đã dọn; bài e2e nay tự dọn hàng chờ ở đầu và cuối để chạy lại được kể cả sau lần hỏng.
5. **Giới hạn đã biết, cần quyết định cho M1**: (a) hộp thư đi hỏi Medplum theo chu kỳ, mỗi phòng khám mỗi lần 20 điểm hạn mức; đủ cho M0, nhưng 300 phòng khám mỗi 2 giây là 3.000 lần tìm mỗi phút nên M1 phải chuyển sang Subscription hoặc hàng đợi; (b) bản nháp lượt khám tạm lưu ở `sessionStorage` (có dữ liệu lâm sàng, xóa khi đăng xuất, chưa mã hóa), M0-S3 chuyển sang kho cục bộ có mã hóa cùng với ngoại tuyến; (c) màn hình chờ dùng chung phiên của máy lễ tân, M1 cần thiết bị màn hình có mã ghép riêng; (d) mã đơn nội bộ (`PM-YYMMDD-XXXXXX`, sinh xác định từ `clientUuid`) là giả định tạm cho đến khi có tài liệu cổng (TL34 Q1); (e) giới hạn 30/90 ngày và danh sách bệnh mạn tính là dữ liệu minh họa, cần cố vấn y khoa và pháp chế xác nhận trước M1.

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
- **Hạn mức đăng nhập 5 lần/phút theo IP (F5).** Mỗi file kiểm thử tích hợp đăng nhập quản trị một lần, nên chạy bộ tích hợp ba lần liền sẽ gặp 429 ở khâu dựng dữ liệu; đó không phải lỗi mã. Thêm file kiểm thử mới thì tính lại. Nếu gặp, chờ một phút.
- **Kiểm thử hẹn giờ phải dùng thời gian ảo, không `sleep`**: CI chậm hơn máy dev (một bài thử lại hạn 40 ms đã làm đỏ CI). Bài hỏng giữa chừng không được để lại trạng thái chung cho các bài sau (đặt lại trong `beforeEach`).
- **Không thăm dò trên phòng khám demo**: các lần thử ban đầu đã làm sai số thứ tự và lịch sử. Tạo phòng khám tạm như các kiểm thử tích hợp (`createTenantProject`). Bài e2e `visit.mjs` tự dọn hàng chờ ở đầu và cuối để chạy lại được kể cả sau lần hỏng.
- **Không dùng `pkill -f` theo mẫu chữ** (đã từng giết chính shell đang chạy lệnh); `infra/dev-up.sh` dùng file PID và nhóm tiến trình. Tiến trình nền phải bỏ stdout của lệnh gọi, nếu không nó giữ đầu ống và lệnh không bao giờ kết thúc.
- **Quy tắc đã thành nếp, giữ cho mọi tính năng mới**: log không chứa chuỗi truy vấn; nhật ký truy cập không chứa dữ liệu bệnh nhân; ghi nhật ký trước khi trả dữ liệu; tenant lấy từ phiên, không từ tham số; mọi phần mô phỏng có nhãn. Kiểm thử an toàn phải được xác nhận **thất bại khi gỡ biện pháp** tương ứng.
- **Khi xong M0-S3, cập nhật chỗ nói "ngoại tuyến chưa có"**: `components/Scope.tsx`, `components/DemoBanner.tsx`, `README.md` (mục "Giới hạn"), mục 5.2 và 5.7 của kế hoạch, và bước kiểm tra trang Phạm vi trong `e2e/visit.mjs`.

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
- Bài này chạy trong job e2e của CI (thêm vài phút [Chưa đo]).

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

**Quyết định của chủ dự án (02/10/2026):**

1. **Không dùng mã PIN cho kho cục bộ ở M0** (lý do ở OFF-5).
2. **Chấp nhận giới hạn N5 cho M0.** Kịch bản 4 trên sân khấu làm đoạn ngắt mạng trên một máy (bác sĩ tự tiếp đón người mới đến). Để hai máy thấy nhau khi mất Internet cần một trạm đồng bộ trong mạng LAN của phòng khám: ngoài M0, thuộc T-OFF-3.

Các điểm mặc định đã nêu và được duyệt cùng thiết kế: số tạm được ưu tiên giữ (OFF-2); giờ không hợp lý thì vẫn lưu, chỉ không tính số đo (OFF-3); đơn ngoại tuyến bị quy tắc chặn khi đồng bộ thì chờ bác sĩ xác nhận (OFF-7); đăng xuất khi còn mục chờ thì giữ dữ liệu đã mã hóa thay vì xóa (OFF-6).

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
| T-NAME | Tìm tên không dấu | Hai hướng ở A7; gồm xếp hạng kết quả theo 4 số cuối | M | M0, 1 | |
| T-FHIR | Hồ sơ FHIR và định danh | `StructureDefinition` cho CCCD, mã đơn, ICD-10; định danh chuẩn thay URN tạm | M | 1 | |
| T-IDEM | Ghi lặp lại được | A1: identifier + `If-None-Exist`, `urn:uuid:` trong transaction, kiểm thử gửi lại | M | M0, 1 | ✓ |
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
