# Kế hoạch triển khai chi tiết — PHONGMACH

Nguồn: báo cáo "Quản lý Phòng mạch Việt Nam" v2.0 (29/09/2026), cập nhật sau khi **cài và thử backend Medplum thật**
(ngày 02/10/2026). Tài liệu nội bộ "Phân tích – Phản biện… theo 6 trụ cột" (34 trang) được báo cáo nhắc tới nhưng
**chưa có trong tay**; kế hoạch này chỉ dựa trên báo cáo v2.0 và kết quả thử nghiệm. Nếu hai bên mâu thuẫn, cần đối chiếu.

Quy ước độ tin cậy trong tài liệu:

- **[Đã đo]** chạy thật trong thư mục `infra/medplum/`, có thể chạy lại.
- **[Đã đọc mã]** thấy trong mã nguồn server Medplum 5.2.0 nhưng chưa tái hiện bằng một thao tác thật.
- **[Đề xuất]** là ý kiến thiết kế của tôi, cần người có thẩm quyền chốt.
- **[Chưa kiểm chứng]** là chưa thử; không được coi là đã biết.

---

## 1. Đã cài gì, kết quả ra sao

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Medplum server | 5.2.0 (image `medplum/medplum-server`, digest `sha256:8b94…9d42`) | Không có `@medplum/server` trên npm; phát hành dạng image Docker. Chạy bằng Node 24.18.1 bên trong image. |
| PostgreSQL | 16 | Bắt buộc. |
| Redis | 7 | Bắt buộc (hàng đợi, hạn mức, cache). |

Chạy lại: `node infra/medplum/setup.mjs && docker compose -f infra/medplum/docker-compose.yml up -d && node infra/medplum/smoke-test.mjs`
(chi tiết trong `infra/medplum/README.md`). Đã chạy từ trạng thái sạch, đủ 3 container, healthy sau khoảng 1 phút.

### Kết quả đo [Đã đo]

Máy 4 vCPU, 15 GB RAM, không tải khác, một người dùng. **Đây là số kiểm tra sơ bộ, không thay cho kiểm tra tải ở Giai đoạn 0.**
Bộ 20.505 bệnh nhân (trong một project), phép đo tìm kiếm và thử sao lưu được thực hiện trên bản cài đầu tiên (cùng image Medplum 5.2.0, PostgreSQL 16 và Redis chạy trực tiếp trên máy, **tắt hạn mức FHIR**), chưa chạy lại trên stack Docker Compose. Smoke test thì chạy trên stack Compose.

| Hạng mục | Kết quả |
|---|---|
| API FHIR | R4 (4.0.1), 146 loại tài nguyên |
| Tạo Patient, Encounter, Condition (ICD-10), MedicationRequest | 12–62 ms mỗi lần ghi |
| Tìm bệnh nhân theo số điện thoại đầy đủ, 20.505 bệnh nhân trong một project | median 5 ms |
| Tìm theo **4 số cuối** (`phone:contains=5678`) | median 6 ms, 15 kết quả (có cả số chứa 5678 ở giữa, lớp ứng dụng phải lọc/xếp hạng) |
| Tìm theo họ tên **có dấu** ("Nguyễn") | median 8 ms |
| Tìm theo tên **không dấu** ("Nguyen") | **0 kết quả** nếu hồ sơ chỉ lưu tên có dấu (xem T-NAME) |
| Mở toàn bộ hồ sơ (`$everything`) của bệnh nhân có 5 tài nguyên | 133–196 ms (ngân sách báo cáo: 400 ms; hồ sơ nhiều năm sẽ lâu hơn, chưa đo) |
| Dung lượng | ≈ 10 KB mỗi bệnh nhân (chỉ Patient + chỉ mục + lịch sử; chưa tính Encounter, đơn, AuditEvent), suy ra từ 157 MB → 362 MB khi thêm 20.000 bệnh nhân |
| Ghi hàng loạt, tắt hạn mức | 20.000 bệnh nhân trong 114 s (~175/s); đã đếm lại trong DB: 20.505 |
| Sao lưu logic (`pg_dump`) → khôi phục | 3,3 s → 5,2 s, 24 MB nén, số bệnh nhân khớp. **Chưa phải sao lưu liên tục (PITR).** |
| Cách ly giữa hai phòng khám (hai `Project`) | đọc, tìm, sửa chéo đều bị chặn (404) |
| Lịch sử phiên bản (`_history`) | có |
| `AuditEvent` | có, **chỉ được lưu khi bật `saveAuditEvents: true`**; đọc và ghi được lưu, **tìm kiếm thì không** |

### Chưa thử

Giao diện web Medplum, Bot, Subscription (webhook), đăng nhập có xác thực hai lớp, chạy nhiều bản server, chịu tải đồng thời,
nâng cấp phiên bản, PITR, mọi thứ liên quan Cổng Đơn thuốc, ký số, Zalo, thanh toán, hóa đơn điện tử, làm việc ngoại tuyến.

---

## 2. Phát hiện từ việc cài đặt và tác động lên kế hoạch

| # | Phát hiện | Bằng chứng | Tác động | Việc cần làm |
|---|---|---|---|---|
| F1 | Tài khoản siêu quản trị mặc định `admin@example.com` / `medplum_admin` đăng nhập được trên bản cài mới | [Đã đo] | Lỗ hổng nếu server mở ra mạng. Cam kết "an toàn" ở mục 5.2 của báo cáo không thể bán khi chưa xử lý | **T-SEC0** |
| F2 | Medplum luôn gọi `api.pwnedpasswords.com` khi tạo user / đặt / đổi mật khẩu, không thấy công tắc cấu hình; mạng chặn thì thao tác lỗi `fetch failed` | [Đã đo] `newuser` lỗi khi chặn egress; [Đã đọc mã] `newuser`, `setpassword`, `changepassword` | Phụ thuộc dịch vụ nước ngoài trên đường xác thực (chỉ gửi tiền tố băm, không phải dữ liệu bệnh nhân, nhưng vẫn là egress phải mở và là điểm hỏng). Ảnh hưởng cả việc đổi mật khẩu admin | **T-IDP**, **T-SEC0** |
| F3 | Đọc và ghi sinh `AuditEvent` nhưng mặc định chỉ ghi vào log; phải bật `saveAuditEvents`. Tìm kiếm không được lưu | [Đã đo] | Cam kết "mọi lần xem hồ sơ đều được ghi lại" đạt được cho từng hồ sơ nhưng **không** cho danh sách/tìm kiếm. Mỗi lần đọc thành một dòng DB: bảng sẽ phình rất nhanh | **T-AUD** |
| F4 | Tên chỉ lưu có dấu thì không tìm được bằng không dấu | [Đã đo] | Phụ tá gõ "nguyen van an" là cách tìm tự nhiên nhất; không xử lý thì trải nghiệm "tìm trong vài giây" hỏng | **T-NAME** |
| F5 | Hạn mức FHIR theo điểm: đọc 1, lịch sử 10, tìm 20, ghi 100; mặc định 50.000 điểm/phút/người dùng (≈ 500 lần ghi/phút), project gấp 10 lần. Đăng nhập 5 lần/phút, khóa theo IP của client | [Đã đọc mã] cấu hình và cách tính khóa; [Đã đo] 429 khi nhập hàng loạt và khi đăng nhập dồn | `batch` trả HTTP 200 nhưng từng phần tử bên trong có thể là 429: nhập dữ liệu hàng loạt **thất bại âm thầm** nếu không kiểm tra từng phần tử (tôi đã mắc đúng lỗi này khi đo). Công cụ chuyển dữ liệu và đồng bộ ngoại tuyến sau khi có mạng đều chạm hạn mức. Đăng nhập 5 lần/phút theo IP sẽ chạm khi nhiều phòng khám cùng sau một NAT, hoặc khi reverse proxy không chuyển tiếp IP thật của client (khi đó mọi người dùng chung một bộ đếm) | **T-QUOTA**, **T-MIG** |
| F6 | Một `Project` = một phòng khám, kèm `ClientApplication` (tài khoản máy) hoạt động tốt, không cần mật khẩu | [Đã đo] | Đây là mô hình cô lập và là cách lớp Việt Nam hóa gọi Medplum | **T-TEN** |
| F7 | Báo cáo nói mỗi phòng khám có "khóa riêng". Không có bằng chứng Medplum mã hóa theo từng project; dữ liệu nằm chung bảng, cách ly bằng bộ lọc truy cập | [Chưa kiểm chứng] chỉ thấy cách ly hoạt động | Cần làm rõ cam kết nghĩa là gì (khóa ký, khóa mã hóa tệp đính kèm, hay khóa DB) trước khi viết vào hợp đồng | Câu hỏi Q6 |
| F8 | Server tự thực hiện một số kết nối ra ngoài: kiểm tra mật khẩu (F2), kiểm tra phiên bản mới lúc khởi động (log `Failed to check for newer version`), và các tính năng tùy chọn (Google reCAPTCHA, đăng nhập Google, OpenAI) chỉ khi bật | [Đã đo] kiểm tra phiên bản, [Đã đọc mã] phần còn lại; chưa xác định host đích của kiểm tra phiên bản | Với yêu cầu lưu dữ liệu trong nước (NĐ 53/2022) cần danh sách egress được phê duyệt và chặn mặc định | **T-EGR** |
| F9 | Image không có shell; có sẵn móc OpenTelemetry trong lệnh khởi động | [Đã đo] | Quan sát hệ thống được bằng OTel; gỡ lỗi trong container phải dùng công cụ ngoài | **T-OBS** |
| F10 | Migration chạy khi server khởi động (hơn 100 bước tiền triển khai, cộng hàng đợi hậu triển khai) | [Đã đo] qua log | Nâng cấp cuốn chiếu nhiều bản server phải được kiểm chứng; nâng cấp không phải thao tác "đổi tag" | **T-UPG** |

---

## 3. Kiến trúc đề xuất [Đề xuất]

```
Ứng dụng phòng khám (PWA, ưu tiên ngoại tuyến)     Bệnh nhân (Zalo)
        │  outbox + bộ nhớ cục bộ                          │
        ▼                                                  ▼
┌─────────────────── Lớp Việt Nam hóa (UNIGIS sở hữu, tách khỏi lõi) ───────────────────┐
│ Cổng API · cung cấp phòng khám (T-TEN) · xác thực · quy tắc kê đơn · chuẩn hóa tên     │
│ Bộ nối: Cổng Đơn thuốc QG │ Ký số từ xa │ Hóa đơn điện tử │ Zalo ZNS │ QR thanh toán   │
│ Ghi nhật ký truy cập danh sách · hàng đợi gửi lại (không bao giờ mất đơn)              │
└───────────────────────────────────────┬────────────────────────────────────────────────┘
                                         ▼  FHIR R4 (tài khoản máy theo từng phòng khám)
                  Medplum 5.2.0 (không sửa mã) — nhiều bản sau cân bằng tải
                              │                         │
                       PostgreSQL 16 (HA + PITR)      Redis 7
                       trung tâm dữ liệu chính  ──► trung tâm dự phòng ở thành phố khác
```

Nguyên tắc:

1. **Không sửa mã nguồn Medplum** (đúng báo cáo, trụ cột Bền vững). Mọi thứ đặc thù Việt Nam nằm trong lớp riêng; nếu phải thay lõi, phạm vi ảnh hưởng là dữ liệu FHIR và các lời gọi.
2. **Lớp Việt Nam hóa là một dịch vụ độc lập, không dùng Medplum Bot** [Đề xuất]. Bot chạy bên trong Medplum, đi ngược nguyên tắc tách lớp. Việc gửi đơn lên cổng quốc gia đi qua dịch vụ này (mẫu cổng API), không phụ thuộc Subscription của Medplum (chưa kiểm chứng).
3. **Một phòng khám = một `Project` + một `ClientApplication` + một `AccessPolicy`.** Đã kiểm chứng cô lập cho đọc/tìm/sửa.
4. **Ghi ID do phía client sinh (UUID)** và ghi theo kiểu lặp lại được (idempotent) để đồng bộ ngoại tuyến không tạo bản ghi trùng.
5. Phiên bản Medplum và image được **ghim**; nâng cấp là quyết định có kiểm soát qua môi trường staging.

Ánh xạ dữ liệu sơ bộ: bệnh nhân → `Patient` (CCCD trong `identifier`); lượt khám → `Encounter`; chẩn đoán → `Condition` (ICD-10);
đơn thuốc → `MedicationRequest`; đồng ý xử lý dữ liệu → `Consent`; ký số → `Provenance` (+ chữ ký); mẫu khám → `Questionnaire`;
nhật ký → `AuditEvent`. Định danh dùng URN tạm (`urn:phongmach:…`) cho đến khi chốt tên miền chuẩn (T-FHIR).

---

## 4. Giai đoạn 0 — Kiểm chứng (6 tuần)

Giả định bắt đầu thứ Hai **05/10/2026**, kết thúc **13/11/2026** (báo cáo ghi "10–11/2026, 6 tuần"). Ngân sách ≈ 12% tổng, tức 0,78–1,08 tỷ
(xem Q8: báo cáo ghi "dưới 1 tỷ" nhưng 12% của 9,0 tỷ là 1,08 tỷ).

### 4.1 Tiêu chí "đi / không đi" [Đề xuất ngưỡng, cần nhà đầu tư chốt trước ngày bắt đầu]

Báo cáo nói tiêu chí "đo được" nhưng chưa có con số. Đề xuất:

| # | Tiêu chí | Ngưỡng để "đi" | Cách đo |
|---|---|---|---|
| G1 | Cổng Đơn thuốc Quốc gia | Có tài liệu kỹ thuật chính thức và môi trường thử; gửi 100 đơn thử, **≥ 98%** thành công; đơn lỗi luôn được giữ lại và gửi lại được | Kịch bản tự động trên môi trường thử |
| G2 | Ký số từ xa | p95 ký 1 đơn **≤ 5 s**; ký lô 20 đơn **≤ 20 s**; có phương án USB cho máy bàn | Đo với ít nhất 2 nhà cung cấp |
| G3 | Hiệu năng Medplum trên hạ tầng trong nước | Dữ liệu giả lập 200 phòng khám × 10.000 bệnh nhân; tải hỗn hợp **3× đỉnh dự kiến** (xem 4.3); p95: tìm bệnh nhân ≤ 200 ms, mở hồ sơ ≤ 400 ms, lưu và in đơn ≤ 2 s; lỗi < 0,1% | Công cụ tải (k6 hoặc tương đương), chạy giờ vàng giả lập |
| G4 | Ngoại tuyến | 100 chu kỳ ngắt/khôi phục mạng ngẫu nhiên giữa buổi khám giả lập: **0 bản ghi mất, 0 trùng**; đồng bộ 40 ca trong ≤ 60 s sau khi có mạng | Bộ kiểm thử tự động |
| G5 | Vận hành | Nâng cấp Medplum một phiên bản trên bản sao dữ liệu thử: 0 mất dữ liệu, ngừng ≤ 15 phút. Khôi phục về thời điểm bất kỳ trong 24 giờ qua: ≤ 60 phút, mất ≤ 15 phút dữ liệu (đúng cam kết báo cáo) | Diễn tập, có biên bản |
| G6 | Chi phí | Mô hình chi phí hạ tầng/phòng khám ≤ 40.000 đ/tháng ở 1.000 khách, dựa trên số đo thật (dung lượng, CPU) | Bảng tính + số đo G3 |
| G7 | Thị trường | ≥ 8 buổi quan sát; **≥ 5 phòng mạch cam kết dùng thử bằng văn bản**; đo thời gian thao tác hiện tại của họ làm mốc | Phiếu quan sát, thư cam kết |
| G8 | Pháp lý | Có văn bản trả lời hoặc căn cứ rõ cho Q3, Q4, Q5 dưới đây | Thư của cơ quan hoặc ý kiến luật sư |

Quyết định: **Đi** khi G1–G5 đạt và G6–G8 đạt hoặc có kế hoạch khắc phục được nhà đầu tư chấp thuận.
**Không đi / chuyển phương án dự phòng** khi G3 hoặc G5 trượt vì lý do riêng của Medplum, dù các tiêu chí còn lại đạt.
G1, G2, G8 trượt là rủi ro của thị trường chứ không phải của Medplum, và đổi phương án dự phòng không giải quyết được.

### 4.2 Kế hoạch từng tuần

| Tuần | Công việc | Sản phẩm bàn giao |
|---|---|---|
| 1 (05–09/10) | Họp khởi động; chốt ngưỡng G1–G8 (Q1); gửi thư xin tài liệu kỹ thuật tới Cục Quản lý Khám chữa bệnh; liên hệ 2–3 nhà cung cấp chữ ký số từ xa xin môi trường thử; lên lịch 8–10 buổi quan sát; chọn 2 nhà cung cấp hạ tầng trong nước để thử; xử lý **T-SEC0** cho môi trường thử | Thư đã gửi; lịch quan sát; môi trường staging 1 (từ `infra/medplum/`) |
| 2 (12–16/10) | Quan sát phòng mạch #1–4; **T-IDP** (phương án xác thực nhân viên); dựng bộ dữ liệu giả lập 200 × 10.000 (bằng cách ghi hàng loạt **có kiểm tra từng phần tử** và xử lý hạn mức, F5); khung đo tải | Ghi chép quan sát; bộ dữ liệu giả lập; kịch bản tải v1 |
| 3 (19–23/10) | Quan sát #5–8; spike **T-OFF-0** (ngoại tuyến: bộ nhớ cục bộ, outbox, đồng bộ idempotent); chạy G3 vòng 1 trên nhà cung cấp hạ tầng A | Prototype ngoại tuyến; số đo G3 vòng 1 |
| 4 (26–30/10) | Spike bộ nối Cổng Đơn thuốc (G1) nếu đã có tài liệu; spike ký số (G2) với nhà cung cấp 1; chạy G3 vòng 1 trên nhà cung cấp B; spike **T-NAME** | Số đo G1/G2 sơ bộ; so sánh A/B |
| 5 (02–06/11) | Spike ký số với nhà cung cấp 2; **G5**: PITR (WAL archive tới trung tâm thứ hai) và nâng cấp Medplum trên bản sao; **G4** chạy 100 chu kỳ; giao diện thử với 3 bác sĩ | Biên bản diễn tập G5; kết quả G4; phản hồi giao diện |
| 6 (09–13/11) | Tổng hợp; mô hình chi phí (G6); đối chiếu pháp lý (G8); chốt ngân sách lại (±30% → ±15%); **họp quyết định đi/không đi 13/11** | Báo cáo quyết định; ngân sách cập nhật; phương án dự phòng nếu cần |

Việc cần làm song song suốt giai đoạn: theo dõi văn bản pháp luật hàng tuần (báo cáo coi thay đổi hệ thống quốc gia là rủi ro số một).
Khoảng 16–30/11 làm đệm: chốt hợp đồng, hoàn thiện đội, thiết lập repo và CI.

### 4.3 Mô hình tải để đo G3 [Đề xuất]

Phòng mạch điển hình: 40 bệnh nhân/buổi trong 4 giờ (17–21h), khoảng 15 lời gọi API mỗi bệnh nhân.
300 phòng khám ≈ 180.000 lời gọi/buổi ≈ 12 lời gọi/giây trung bình; đỉnh giả định gấp 3 ≈ 36/giây; kiểm tra gấp 3 nữa ≈ **110 lời gọi/giây**
(đúng yêu cầu "gấp ba lần nhu cầu dự kiến" của báo cáo). Hỗn hợp: tìm bệnh nhân, mở hồ sơ, ghi Encounter/Condition/đơn, đọc hàng chờ.
Đây là giả định để bắt đầu, phải thay bằng số quan sát thật ở các buổi tuần 2–3.

---

## 5. Giai đoạn 1 — Sản phẩm đầu tiên (12/2026 – 03/2027)

Mục tiêu theo báo cáo: bản dùng thử tại 15–20 phòng mạch thay hoàn toàn phần mềm cũ; 80% ca khám dưới 90 giây;
trên 98% đơn gửi cổng thành công. Kế hoạch theo sprint 2 tuần. **Tết Nguyên đán 2027 rơi khoảng 06/02/2027** (xác nhận lịch nghỉ chính thức),
nên thực tế mất khoảng 1–1,5 tuần làm việc và việc nghiên cứu người dùng quanh thời điểm đó khó thực hiện.

| Sprint | Thời gian | Nội dung chính | Công việc |
|---|---|---|---|
| S1 | 01–14/12 | Nền móng | Repo, CI/CD, hạ tầng dạng mã (T-IAC), staging; dịch vụ cung cấp phòng khám (T-TEN); hồ sơ FHIR (T-FHIR); cấu hình hạn mức (T-QUOTA); loại bỏ tài khoản mặc định ở mọi môi trường (T-SEC0) |
| S2 | 15–28/12 | Tiếp đón | Tìm/tạo bệnh nhân với chuẩn hóa tên (T-NAME); đồng ý điện tử (T-CONSENT); hàng chờ và màn hình chờ; khung ứng dụng PWA với outbox (T-OFF-1); nhật ký truy cập (T-AUD) |
| S3 | 29/12–11/01 | Khám | Màn hình khám một trang; mẫu khám theo chuyên khoa (`Questionnaire`); danh mục ICD-10; ảnh đính kèm; danh mục thuốc và đơn mẫu |
| S4 | 12–25/01 | Kê đơn | Kê lại một nút; kiểm tra trùng thuốc/dị ứng/số ngày; in đơn; bộ nối Cổng Đơn thuốc (T-RX) trên môi trường thử |
| S5 | 26/01–05/02, rồi nghỉ Tết | Ký số và gửi | Ký số tích hợp (T-SIGN); hàng đợi gửi lại và màn hình "đơn chưa gửi được"; kiểm thử nội bộ trong tuần Tết |
| S6 | 15–28/02 | Thu tiền và Zalo | QR động tự xác nhận và sổ thu (T-PAY); Zalo gửi đơn, nhắc lịch (T-ZALO); nhập danh sách từ Excel và công cụ chuyển dữ liệu (T-MIG) |
| S7 | 01–14/03 | Ngoại tuyến và độ cứng | Ngoại tuyến mức tối thiểu hoàn chỉnh (T-OFF-2); đo thời gian thao tác từng ca; kiểm tra bảo mật nội bộ; bộ tài liệu cài đặt cho phòng thử |
| S8 | 15–31/03 | Đưa vào phòng thử | Triển khai theo đợt 5 → 10 → 15–20 phòng; chạy song song hai tuần với phần mềm cũ; sửa lỗi; đo KPI |

**Rủi ro lịch lớn nhất của giai đoạn này là ngoại tuyến.** Báo cáo yêu cầu có "từ bản đầu", trong khi bộ nhớ cục bộ + outbox + đồng bộ không trùng + xử lý xung đột là phần việc thường tốn nhiều tháng.
Để giữ lịch: dựng khung ngoại tuyến từ S2, kiểm thử ngắt mạng tự động từ S3, và mức "tối thiểu" của Giai đoạn 1 là:
tiếp đón, khám, kê đơn và in được khi mất mạng; ký và gửi cổng khi có mạng lại (xem Q3 về giá trị pháp lý). Phần còn lại hoàn thiện ở Giai đoạn 2.

### Giai đoạn 2 và 3

Ở mức đầu việc, vì phụ thuộc kết quả Giai đoạn 0 và 1 (chi tiết hóa lại tại cuối mỗi giai đoạn trước):

- **Giai đoạn 2 (04–07/2027):** bệnh án điện tử đầy đủ + khóa sau ký (T-EMR); hóa đơn điện tử (T-INV); đặt lịch Zalo; nhiều cơ sở/bác sĩ và phân quyền; ngoại tuyến hoàn chỉnh (T-OFF-3); trung tâm dự phòng và diễn tập chuyển đổi (T-DR); kiểm tra bảo mật độc lập; bán rộng rãi 05–06/2027.
- **Giai đoạn 3 (08–12/2027):** kết nối Sổ sức khỏe điện tử/VNeID (phụ thuộc hướng dẫn Bộ Y tế); nhà thuốc trực thuộc; chuyên khoa sâu; tái khám từ xa; trợ lý AI; ISO 27001.

---

## 6. Danh mục công việc kỹ thuật

Cỡ: S ≤ 1 tuần-người, M 1–3, L 3–8, XL > 8 (ước lượng thô, sẽ chuẩn hóa sau Giai đoạn 0).

| Mã | Công việc | Chi tiết | Cỡ | Giai đoạn | Phụ thuộc |
|---|---|---|---|---|---|
| T-SEC0 | Vô hiệu tài khoản mặc định, quản lý bí mật | Đổi hoặc xóa `admin@example.com`; mật khẩu admin đổi qua API cần egress HIBP (F2), nên cần quy trình thay thế được duyệt (đặt băm trực tiếp trong DB, có biên bản). Khóa ký không để trong file; bí mật qua kho bí mật. Tắt tự đăng ký (đã làm trong cấu hình dev) | M | 0, 1 | |
| T-IDP | Xác thực nhân viên | Chọn: người dùng Medplum (mật khẩu + TOTP, dính F2) hay IdP riêng của UNIGIS ánh xạ sang Medplum. Báo cáo yêu cầu xác thực hai lớp cho người ký đơn | M | 0 | T-EGR |
| T-EGR | Kiểm soát egress | Danh sách host được phép; chặn mặc định; xác định host đích của kiểm tra phiên bản (F8); quyết định chuyển tiếp qua proxy cho HIBP hay thay thế | S | 0, 1 | |
| T-TEN | Cung cấp phòng khám | Dịch vụ tạo `Project`, `ClientApplication`, `AccessPolicy`, thông số hạn mức; tạo/hủy/tạm khóa; không dùng quyền siêu quản trị trong vận hành thường xuyên | L | 1 | T-SEC0 |
| T-QUOTA | Hạn mức | Đặt `userFhirQuota`/`totalFhirQuota` theo từng project; tài khoản nhập dữ liệu riêng hạn mức cao; reverse proxy chuyển tiếp IP thật của client để hạn mức đăng nhập không gộp các phòng khám | S | 1 | |
| T-AUD | Nhật ký truy cập | Bật `saveAuditEvents` (đã có trong cấu hình dev); ghi thêm nhật ký tìm kiếm/danh sách ở lớp dịch vụ; **chính sách phân vùng và lưu giữ bảng AuditEvent** (mỗi lần đọc = 1 dòng); không cho sửa/xóa; chuyển bản sao ra kho bất biến | M | 1 | |
| T-NAME | Tìm tên không dấu | Hai hướng: (a) lớp dịch vụ thêm `HumanName` thứ hai không dấu (đã kiểm chứng tìm được, không cần tùy biến server), (b) `SearchParameter` tùy biến trên trường chuẩn hóa. Chọn bằng đo ở Giai đoạn 0. Gồm cả xếp hạng kết quả tìm theo 4 số cuối điện thoại | M | 0, 1 | |
| T-FHIR | Hồ sơ FHIR và định danh | `StructureDefinition`/IG cho CCCD, mã đơn quốc gia, ICD-10; tên miền chuẩn thay URN tạm | M | 1 | Q9 |
| T-MIG | Công cụ chuyển dữ liệu | Nhập từ Excel và từ phần mềm cũ; **kiểm tra từng phần tử của `batch`**, tự giảm tốc theo hạn mức, chạy lại được (idempotent), báo cáo kết quả từng dòng | L | 1 | T-QUOTA |
| T-CONSENT | Đồng ý xử lý dữ liệu | Thu thập, lưu bằng chứng, rút lại; xuất/xóa theo yêu cầu bệnh nhân | M | 1 | tư vấn pháp lý |
| T-RX | Bộ nối Cổng Đơn thuốc QG | Sinh mã đơn, gửi, hàng đợi gửi lại, theo dõi đơn chưa gửi; tách thành bộ nối thay được (vì Quyết định 1867/QĐ-BYT có thể đổi cách kết nối) | XL | 0 (spike), 1 | Tài liệu từ Cục QLKCB |
| T-SIGN | Ký số từ xa | Ký 1 đơn và ký lô; USB cho máy bàn; đo thời gian | L | 0 (spike), 1 | |
| T-OFF | Ngoại tuyến | 0: spike; 1: khung + outbox + ID client + thử ngắt mạng tự động; 2: tối thiểu hoàn chỉnh; 3: đầy đủ | XL | 0–2 | Q3 |
| T-PAY | Thanh toán QR | payOS/Casso hoặc tương đương; tự xác nhận khi tiền vào; sổ thu | M | 1 | |
| T-ZALO | Zalo ZNS | Gửi đơn, nhắc lịch; theo dõi chi phí tin | M | 1 | |
| T-INV | Hóa đơn điện tử | Theo Nghị định 70/2025; bảng kê cho kế toán | L | 2 | |
| T-EMR | Bệnh án điện tử + khóa sau ký | Chỉ có lịch sử phiên bản [Đã đo]; "khóa sau ký" phải thiết kế (chính sách truy cập + bằng chứng ký) | L | 2 (xem Q4) | |
| T-HA | Chạy nhiều bản Medplum | Nhiều bản sau cân bằng tải; kiểm chứng migration lúc khởi động (F10) | M | 2 | T-UPG |
| T-DR | Sao lưu liên tục và dự phòng | WAL archive/PITR; bản sao ở trung tâm thứ hai; mục tiêu mất ≤ 15 phút, khôi phục ≤ 1 giờ; diễn tập định kỳ | L | 0 (G5), 2 | |
| T-UPG | Quy trình nâng cấp | Ghim phiên bản, staging bắt buộc, theo dõi phát hành Medplum hàng tuần; 20% thời gian đội cho bảo trì (báo cáo) | M | 0, liên tục | |
| T-OBS | Quan sát | OpenTelemetry (đã có móc sẵn), chỉ số thời gian từng thao tác theo phòng khám, cảnh báo | M | 1 | |
| T-IAC | Hạ tầng dạng mã | Dựng lại toàn bộ trong < 1 giờ (cam kết báo cáo) | L | 1 | |
| T-COST | Mô hình chi phí | Theo từng phòng khám, từ số đo thật | S | 0 | G3 |
| T-LEGAL | Hồ sơ mẫu cho phòng khám | Đánh giá tác động dữ liệu, quy chế, hợp đồng; bảo hiểm trách nhiệm; quy trình sự cố 72 giờ | L | 0–2 | luật sư |

### Cam kết "6 nguyên tắc" và nơi kiểm chứng

| Trụ cột | Cam kết trong báo cáo | Công việc / kiểm chứng |
|---|---|---|
| An toàn | Ngăn dữ liệu riêng; xác thực hai lớp; ghi mọi lần xem; dữ liệu trong nước | T-TEN [cách ly đã đo], T-IDP, T-AUD [có điều kiện], T-EGR; "khóa riêng" cần làm rõ (Q6) |
| Tin cậy | 99,9%; khôi phục 1 giờ, mất tối đa 15 phút; không mất đơn | T-DR (G5), T-RX hàng đợi |
| Luôn sẵn sàng | Nhiều máy chủ, trung tâm dự phòng, ngoại tuyến | T-HA, T-DR, T-OFF (G4) |
| Mở rộng | 20 → 5.000 phòng khám; thử tải 3× | G3, T-QUOTA |
| Nhanh | 0,2 / 0,4 / 2 giây | G3 (số sơ bộ ở mục 1 đạt trên dữ liệu nhỏ, một người dùng) |
| Bền vững | Không sửa mã; 20% bảo trì; dựng lại < 1 giờ | T-UPG, T-IAC, T-COST |

---

## 7. Câu hỏi cần quyết định

| # | Câu hỏi | Vì sao quan trọng |
|---|---|---|
| Q1 | Ngày bắt đầu thực tế và ngưỡng G1–G8 có được nhà đầu tư chấp thuận không? | Báo cáo hứa tiêu chí "đo được" nhưng chưa có con số. Mục 4.1 chỉ là đề xuất |
| Q2 | "Phương án dự phòng, tự xây trên công nghệ đội ngũ đã thành thạo" cụ thể là gì? | Tôi không biết công nghệ đó nên chưa thể chi tiết hóa phương án dự phòng, trong khi nó là nửa còn lại của quyết định đi/không đi |
| Q3 | Đơn thuốc kê khi mất mạng có giá trị pháp lý thế nào, và nhà thuốc có bán được thuốc trước khi đơn lên cổng không? | Báo cáo hứa "không dừng buổi khám khi mất mạng", nhưng ký số từ xa và gửi cổng đều cần mạng; nếu nhà thuốc tra mã đơn trên cổng thì bệnh nhân chưa mua được thuốc cho đến khi đồng bộ. Cần câu trả lời trước khi bán lời hứa này |
| Q4 | Hạn bệnh án điện tử **31/12/2026** nằm trước bản dùng thử (03/2027) và bản bệnh án đầy đủ (04–07/2027). Có đưa một bản bệnh án điện tử tối thiểu hợp lệ lên Giai đoạn 1, hay chấp nhận mốc này trôi qua? | Báo cáo dùng mốc này làm lý do thuyết phục chính, nhưng sản phẩm chưa có tại thời điểm đó. Cần xác nhận hạn có bị thực thi hoặc gia hạn |
| Q5 | Chữ ký số cho bệnh án điện tử (không chỉ đơn thuốc): quy định yêu cầu ký từng phiên khám hay theo lô? | Quyết định G2 và T-EMR |
| Q6 | "Mỗi phòng khám có khóa riêng" nghĩa là khóa nào? | Medplum cách ly bằng bộ lọc, không thấy mã hóa theo từng project (F7); câu chữ trong hợp đồng phải khớp với thực tế |
| Q7 | Xác thực nhân viên bằng người dùng Medplum hay IdP riêng? | Người dùng Medplum phụ thuộc HIBP (F2) |
| Q8 | Ngân sách Giai đoạn 0: "12% (khoảng 0,8–1,1 tỷ)" hay "dưới 1 tỷ"? | 12% × 9,0 tỷ = 1,08 tỷ; hai chỗ trong báo cáo không khớp ở cận trên |
| Q9 | Tên miền/định danh chuẩn cho hồ sơ FHIR của UNIGIS? | Tôi dùng URN tạm; đổi sau khi tạo dữ liệu thật rất tốn |
| Q10 | Nhà cung cấp hạ tầng trong nước nào, và có cung cấp được hai trung tâm ở hai thành phố khác nhau không? | Quyết định G3, T-DR và chi phí |

---

## 8. Rủi ro bổ sung so với báo cáo

| Rủi ro | Mức | Kiểm soát |
|---|---|---|
| Nhập dữ liệu hàng loạt thất bại âm thầm (F5) | Cao | T-MIG kiểm tra từng phần tử; kiểm thử có đếm lại số bản ghi |
| Bảng AuditEvent phình nhanh khi bật lưu (F3) | Trung bình | Phân vùng, lưu giữ theo tuổi, đo ở G3 |
| Nhiều phòng khám sau cùng một IP chạm hạn mức đăng nhập (F5) | Trung bình | T-QUOTA, `trust proxy` |
| Điểm hỏng ngoài tầm kiểm soát trên đường xác thực (F2) | Trung bình | T-IDP, T-EGR |
| Lịch Giai đoạn 1 quá chặt do Tết và ngoại tuyến | Cao | Mức "tối thiểu" đã định ở mục 5; theo dõi tốc độ từ S3 |
| Lời hứa ngoại tuyến vượt quá thực tế pháp lý và kỹ thuật (Q3) | Cao | Chốt Q3 trước khi đưa lời hứa vào tài liệu bán hàng |
