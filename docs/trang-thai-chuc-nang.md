# Trạng thái chức năng PHONGMACH — đã làm gì, còn phải làm gì

> Cập nhật: 13/10/2026. Bảng này **tổng hợp** trạng thái chức năng của toàn bộ phần mềm,
> gom từ các chỗ rải rác trong `docs/ke-hoach-trien-khai.md` (mục 5.2, 5.6–5.9, 6, 7, 8),
> `README.md` và trang "Phạm vi" trong ứng dụng, thành một chỗ dễ liếc. Mỗi dòng dẫn nguồn
> về tài liệu gốc; khi có mâu thuẫn, **tài liệu gốc là đúng**, hãy sửa bảng này cho khớp.
>
> Đây là bảng **chức năng** (phần mềm làm được gì), KHÁC với **tiêu chí nghiệm thu**
> (M0-1…M0-6, đo chất lượng/hiệu năng — xem `ke-hoach-trien-khai.md` mục 5.3). Theo quyết
> định của chủ dự án: **hoàn chỉnh đầy đủ chức năng trước, rồi mới làm phần tiêu chí nghiệm thu.**

## Ký hiệu trạng thái

| Ký hiệu | Nghĩa |
|---|---|
| ✅ | **Đã làm thật** — chạy thật trên Medplum, có kiểm thử |
| 🟡 | **Mô phỏng (có nhãn trên màn hình)** — demo được nhưng chưa nối hệ thật |
| 🔧 | **Làm một phần** — có phần lõi, còn thiếu một số nhánh (ghi rõ ở cột Ghi chú) |
| ⬜ | **Chưa làm** |

Cột **Mốc**: M0 = MVP trình nhà đầu tư (hạn 13/11/2026); M1 = pilot (đến 03/2027);
GĐ2 = 04–07/2027; GĐ3 = 08–12/2027. Nguồn mốc: `ke-hoach-trien-khai.md` mục 5–8.

---

## 1. Tiếp đón & hàng chờ

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Tìm bệnh nhân: SĐT, 4 số cuối, CCCD, tên không dấu | ✅ | M0 | Đạt tiêu chí tính đúng + tốc độ (04/10). `ke-hoach` mục 2 "Tìm bệnh nhân qua BFF" |
| Tạo bệnh nhân nhanh | ✅ | M0 | `apps/clinic-web` màn Tiếp đón |
| Cấp số thứ tự | ✅ | M0 | `packages/clinical/queue.ts`; mục 5.2 |
| Màn hình chờ (gọi số) | ✅ | M0 | mục 5.2 |
| Ưu tiên người đã hẹn (quy tắc cơ bản) | ✅ | M0 | mục 5.2 |
| Báo "còn người trùng tên" khi >20 kết quả | ⬜ | M1 | `README` mục Giới hạn; `ke-hoach` T-NAME |
| Gõ lẫn tên và số trong một lần tìm | ⬜ | M1 | T-NAME |
| Đặt lịch qua Zalo, check-in QR, nhập Excel | ⬜ | M1 (Excel), GĐ2 (lịch) | mục 5.2 "Không làm ở M0"; T-MIG, T-ZALO |

## 2. Khám

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Màn hình khám một trang (sinh hiệu, lý do, triệu chứng) | ✅ | M0 | `apps/clinic-web/src/visit/*`; mục 5.2 |
| Chẩn đoán ICD-10 gõ tắt | ✅ | M0 | `packages/catalogs` |
| Dị ứng, tiền sử, lịch sử khám | ✅ | M0 | `packages/clinical/notes.ts` |
| Hai chuyên khoa (nội tổng quát, nhi) | ✅ | M0 | mục 5.2 (Q15) |
| Đo thời gian phiên khám (đồng hồ mở hồ sơ → in) | ✅ | M0 | `packages/clinical/time.ts`, màn "Thời gian khám"; T-TELE |
| Mẫu khám tự thiết kế, ảnh đính kèm, ký phiếu khám | ⬜ | M1 (S4) | mục 5.2 "Không làm ở M0"; lịch 6.3 |
| Chuyên khoa khác (ngoài 2 khoa) | ⬜ | M1+ | mục 5.2 |
| Bệnh án điện tử đầy đủ + khóa sau ký | ⬜ | GĐ2 | mục 7; T-EMR |

## 3. Kê đơn

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Đơn mẫu, kê lại một nút | ✅ | M0 | `packages/catalogs/templates.ts` |
| Quy tắc: trùng hoạt chất, dị ứng, số ngày tối đa (30/90) | ✅ | M0 | `packages/rules`; chạy ở client và chạy lại ở BFF khi ký |
| Quy tắc trường bắt buộc (CCCD, chẩn đoán) | ✅ | M0 | `packages/rules/check.ts`; gồm `cccd-unknown` cho ca mở offline (PR #20) |
| In đơn A5 có mã QR | ✅ | M0 | `packages/print`; T-PRINT |
| Ký số | 🟡 | M0 → M1 | "Ký mô phỏng" (băm nội dung), có nhãn; `README` mục Giới hạn; T-SIGN (M1 nối nhà cung cấp thật) |
| Tương tác thuốc đầy đủ, đơn thuốc cổ truyền | ⬜ | GĐ3 | mục 5.2; GĐ3 cần nguồn dữ liệu có bản quyền |
| Quy tắc kê đơn theo TT 26/2025 (đầy đủ) | 🔧 | M1 (S4) | M0 có tập quy tắc lõi; đầy đủ theo thông tư ở M1 — T-RULE |

## 4. Liên thông cổng đơn thuốc quốc gia

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Bộ nối (giao diện chuẩn), hàng đợi gửi, trạng thái từng đơn | ✅ | M0 | `services/bff/gateway.ts`, `outbox.ts`; trạng thái đã ký/chờ/đã gửi/lỗi |
| Thử lại, màn hình "đơn chưa gửi được" | ✅ | M0 | `services/bff/outbox.ts` |
| Cổng quốc gia (gửi thật) | 🟡 | M0 → M1 | **Cổng mô phỏng** có nút chèn lỗi, có nhãn; T-SIM. Gửi thật = T-RX (chờ tài liệu API + sandbox, TL34 Q1) |
| Outbox đối soát idempotent theo mã đơn (đầy đủ) | 🔧 | M1 (S2) | M0 có outbox + thử lại; đối soát đầy đủ ở T-OUTBOX |

## 5. Ngoại tuyến (offline)

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Tiếp đón/khám/kê đơn/ký/in khi mất mạng (theo từng máy) | ✅ | M0 | mục 5.9; kho IndexedDB mã hóa AES-GCM |
| Đồng bộ khi có mạng, 0 mất / 0 trùng | ✅ | M0 | Tiêu chí M0-2 đạt trên các hạt giống đã chạy; `offline-cycles.mjs` |
| Tạo bệnh nhân / cấp số tạm / in lại khi mất mạng | ✅ | M0 | mục 5.9 |
| Tự thoát "Mất mạng" khi máy chủ hồi (thăm dò /api/health) | ✅ | M0 | PR #22; `.agents/tasks/fix-offline-stuck.md` |
| Phát hiện & báo xung đột sửa đồng thời | 🔧 | M0 (phát hiện) → GĐ2 (giải quyết) | M0 chỉ **phát hiện và báo**, chưa có cách đưa bản khám lên máy chủ. mục 5.2, 5.9 |
| Chờ ký & gửi cổng khi mất mạng ở mức đầy đủ | ⬜ | M1 (T-OFF-2) | mục 5.2 "Không làm ở M0" |
| Cache toàn bộ 20.000 bệnh nhân khi offline | ⬜ | GĐ2 (T-OFF-3) | M0 chỉ cache vài chục hồ sơ |
| Hai máy thấy nhau khi phòng khám mất Internet | ⬜ | GĐ2 (T-OFF-3) | N5: offline là của từng máy |
| Mã PIN cho kho trên máy | ⬜ | M1 | quyết định 02/10; `README` mục Giới hạn (OFF-5) |

## 6. Zalo

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Nút "Gửi đơn qua Zalo" (bản xem trước tin nhắn) | 🟡 | M0 → M1 | Chỉ hiện bản xem trước, **không gửi**, không gọi mạng, có nhãn. `packages/clinical/zalo.ts`, `apps/clinic-web/src/visit/ZaloPreview.tsx` |
| Gửi ZNS thật (đơn thuốc) | ⬜ | M1 (S6) | Cần bệnh nhân đồng ý + mẫu ZNS duyệt + pháp chế; T-ZALO, T-CONSENT |
| Nhắc lịch, hẹn tái khám qua ZNS | ⬜ | GĐ2 | mục 6.2 danh sách cắt |

## 7. Thu tiền

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Thanh toán QR, tự xác nhận, sổ thu ngày | ⬜ | M1 (S6) | T-PAY (payOS/Casso) |
| Hóa đơn điện tử (NĐ 70/2025) | ⬜ | GĐ2 | T-INV |
| Báo cáo doanh thu | ⬜ | GĐ2 | mục 6.2 danh sách cắt |

## 8. Tuân thủ & bảo mật

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Cách ly đa tenant (mỗi phòng khám một Project) | ✅ | M0 | 2 phòng khám demo; tiêu chí M0-4; `infra/medplum/smoke-test` |
| Nhật ký truy cập (fail-closed, không PII) + màn hình xem | ✅ | M0 | `services/bff/audit.ts`, `components/AuditLog.tsx` |
| Trang "Phạm vi" (đã thật / mô phỏng / chưa làm) | ✅ | M0 | `components/Scope.tsx`; tiêu chí M0-5 |
| Xác thực nhân viên thật (đăng nhập, MFA) | ⬜ | M1 | **Hiện chỉ `DEMO_AUTH=1`, localhost, dữ liệu giả.** T-IDP |
| Nhật ký bất biến ngoài Medplum | ⬜ | M1 (S5) | M0 ghi file cục bộ; T-AUD |
| Đồng ý điện tử đầy đủ, xuất/xóa theo yêu cầu, DPIA | ⬜ | M1 | T-CONSENT, T-OFFB, T-LEGAL |
| Mã hóa cấp trường (CCCD, chỉ số mù) | ⬜ | M1 | T-ENC |
| Phân quyền chi tiết (nhiều cơ sở) | ⬜ | GĐ2 | mục 7 |

## 9. Hạ tầng & vận hành

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Medplum 5.2.0 + PostgreSQL 16 + Redis (Docker Compose) | ✅ | M0 | `infra/medplum` |
| BFF là lớp duy nhất gọi Medplum | ✅ | M0 | bất biến kiến trúc; web 0 import `@medplum/*` |
| Cấp phòng khám tự động (Project/Client/AccessPolicy) | 🔧 | M0 (tối thiểu) → M1 | M0 đủ cho 2 demo; đầy đủ ở T-TEN |
| Hạ tầng dạng mã (dựng lại < 1 giờ) | 🔧 | M0 (staging) → M1 | T-IAC |
| Hạn mức FHIR theo project (nâng cho nhập liệu) | ⬜ | M1 | T-QUOTA (cần trước T6 100 chu kỳ) |
| Chạy nhiều bản Medplum (HA) | ⬜ | GĐ2 | T-HA |
| Sao lưu liên tục + vùng dự phòng (PITR, DR) | ⬜ | GĐ2 | T-DR (RPO 15 phút, RTO 1 giờ) |
| Quan sát (OpenTelemetry, cảnh báo) | ⬜ | M1 | T-OBS (đã có móc) |

## 10. Giai đoạn 3 (đầu việc, chưa chi tiết)

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Sổ sức khỏe điện tử / VNeID | ⬜ | GĐ3 | mục 7; phụ thuộc hướng dẫn kỹ thuật (TL34 Q5) |
| Nhà thuốc trực thuộc | ⬜ | GĐ3 | mục 7 |
| Khám từ xa, trợ lý AI | ⬜ | GĐ3 | mục 7 |
| ISO 27001, API mở | ⬜ | GĐ3 | mục 7 |

---

## Tóm tắt một dòng

- **M0 (demo nhà đầu tư):** luồng lõi tiếp đón → hàng chờ → khám → kê đơn → in A5/QR → liên thông,
  cộng ngoại tuyến từng máy và cách ly tenant, **đã chạy thật**. Ba thứ còn **mô phỏng có nhãn**:
  ký số, cổng đơn thuốc quốc gia, Zalo.
- **Còn phải làm để thành sản phẩm thật (M1 trở đi):** xác thực thật (bỏ `DEMO_AUTH`), nối thật cổng
  đơn thuốc + ký số + Zalo + thanh toán, ngoại tuyến đầy đủ (chờ ký, hai máy thấy nhau), bệnh án
  điện tử đầy đủ, hóa đơn điện tử, HA/DR.
- Chi tiết lịch và công việc kỹ thuật: `ke-hoach-trien-khai.md` mục 6 (M1), 7 (GĐ2/3), 8 (danh mục T-*).
