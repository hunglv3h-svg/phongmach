# Trạng thái chức năng PHONGMACH — đã làm gì, còn phải làm gì

> **Xác minh sâu theo code tại commit `1d2eb63349659a2123b19e81b5667c35c8be3fdd` ngày 2026-10-13.**
> Mỗi ô ✅/🟡/🔧/⬜ dưới đây đã được đối chiếu trực tiếp với mã nguồn (tên file/hàm ghi ở cột Ghi chú),
> không chỉ chép lại từ tài liệu. Bất biến "web không import `@medplum/*`" đã kiểm: 0 import trong `apps/clinic-web/src`.
>
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
| Tìm bệnh nhân: SĐT, 4 số cuối, CCCD, tên không dấu | ✅ | M0 | `services/bff/src/medplum.ts` `searchPatients` (5 nhánh: cccd/phone/phone-fragment/name/name+number) + `packages/fhir-vn-model` `foldName`/`search.ts`. Tốc độ+tính đúng (04/10) |
| Tạo bệnh nhân nhanh (không trùng) | ✅ | M0 | `medplum.ts` `createPatient` dùng `createResourceIfNoneExist` theo `clientUuidQuery`; màn `components/Reception.tsx`, `PatientForm.tsx` |
| Cấp số thứ tự | ✅ | M0 | `packages/clinical/src/queue.ts` `nextNumber`/`buildCheckIn`; `medplum.ts` `checkIn` tạo có điều kiện theo mã lượt |
| Màn hình chờ (gọi số, chỉ số + chữ cái đầu) | ✅ | M0 | `queue.ts` `toDisplayBoard`/`initialsOf`; `components/Display.tsx` |
| Ưu tiên cấp cứu/đã hẹn/thường (quy tắc cơ bản) | ✅ | M0 | `queue.ts` `sortQueue` (`PRIORITY_RANK` urgent/appointment/normal). Ưu tiên theo giờ hẹn: M1 |
| Hủy lượt chờ (chỉ khi đang chờ) | ✅ | M0 | `medplum.ts` `cancelVisit` (chặn nếu không ở trạng thái `arrived`); `components/Queue.tsx` |
| Báo "còn người trùng tên" khi >20 kết quả | ✅ | M0 | `medplum.ts` `searchPatients` trả `hasMore`; UI nhắc khi tràn. (Trước ghi ⬜/M1 — đã làm, nâng ✅) |
| Gõ lẫn tên và số trong một lần tìm ("an 5678") | ✅ | M0 | `packages/fhir-vn-model/src/search.ts` `classifyQuery` nhánh `name+number`; `medplum.ts` tìm tên AND đuôi số. (Trước ghi ⬜/M1 — đã làm, nâng ✅; `ke-hoach` dòng 186 "chưa gõ lẫn" đã cũ) |
| Đặt lịch qua Zalo, check-in QR, nhập Excel | ⬜ | M1 (Excel), GĐ2 (lịch) | mục 5.2 "Không làm ở M0"; T-MIG, T-ZALO |

## 2. Khám

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Màn hình khám một trang (sinh hiệu, lý do, triệu chứng) | ✅ | M0 | `apps/clinic-web/src/visit/{Visit,ExamForm,PatientSide}.tsx`; `packages/clinical/src/vitals.ts`; BFF `routes/clinical.ts` `completeBody` |
| Chẩn đoán ICD-10 gõ tắt | ✅ | M0 | `packages/catalogs/src/icd10.ts` (tập con có nhãn minh họa) + `search.ts`; `components/Typeahead.tsx` |
| Dị ứng, tiền sử, lịch sử khám | ✅ | M0 | `packages/clinical/src/notes.ts` (`buildAllergy`/`buildHistoryItem`/`withdraw*`); `components/Allergies.tsx`; `medplum.ts` `listAllergies`/`listHistory`/`patientVisits` |
| Hai chuyên khoa (nội tổng quát, nhi) | ✅ | M0 | `packages/clinical/src/dto.ts` `SPECIALTIES = [noi, nhi]`; quy tắc nhi theo tuổi/cân nặng ở `rules/check.ts` |
| Đo thời gian phiên khám (đồng hồ mở hồ sơ → in) | ✅ | M0 | `packages/clinical/src/{time,clientTime}.ts` (`measureVisit`, `percentile`); `components/Metrics.tsx`; `medplum.ts` `finishedVisits`. Mất mạng: đo bằng đồng hồ máy khách (OFF-3) |
| Mẫu khám tự thiết kế, ảnh đính kèm, ký phiếu khám | ⬜ | M1 (S4) | mục 5.2 "Không làm ở M0"; lịch 6.3 |
| Chuyên khoa khác (ngoài 2 khoa) | ⬜ | M1+ | mục 5.2 |
| Bệnh án điện tử đầy đủ + khóa sau ký | ⬜ | GĐ2 | mục 7; T-EMR |

## 3. Kê đơn

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Đơn mẫu, kê lại một nút | ✅ | M0 | `packages/catalogs/src/templates.ts` (13 đơn mẫu minh họa); `visit/PrescriptionEditor.tsx` |
| Quy tắc: trùng hoạt chất, dị ứng, số ngày tối đa (30/90) | ✅ | M0 | `packages/rules/src/check.ts` (`duplicate-ingredient`, `allergy`, `max-days` 30/mạn tính 90); chạy ở client (`visit/RulesPanel.tsx`) và chạy lại ở BFF `routes/clinical.ts` khi ký |
| Quy tắc trường bắt buộc (CCCD, chẩn đoán) | ✅ | M0 | `check.ts` `no-diagnosis`/`no-cccd`; gồm `cccd-unknown` + `allergy-unknown` cho ca mở offline (PR #20); `judge` buộc xác nhận kèm lý do ≥5 ký tự |
| In đơn A5 có mã QR | ✅ | M0 | `packages/print/src/prescription.ts` `renderPrescriptionHtml` (QR SVG, CSP `default-src 'none'`, thoát HTML `esc`) |
| Ký số | 🟡 | M0 → M1 | "Ký số MÔ PHỎNG" (băm nội dung), nhãn ở `print` (`.sim`), `visit/SignResult.tsx`, `Scope.tsx`, `DemoBanner.tsx`; T-SIGN (M1 nối nhà cung cấp thật) |
| Tương tác thuốc đầy đủ, đơn thuốc cổ truyền | ⬜ | GĐ3 | mục 5.2; GĐ3 cần nguồn dữ liệu có bản quyền |
| Quy tắc kê đơn theo TT 26/2025 (đầy đủ) | 🔧 | M1 (S4) | M0 có tập quy tắc lõi; đầy đủ theo thông tư ở M1 — T-RULE |

## 4. Liên thông cổng đơn thuốc quốc gia

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Bộ nối (giao diện chuẩn `Gateway`), hàng đợi gửi, trạng thái từng đơn | ✅ | M0 | `services/bff/src/gateway.ts` (interface `Gateway`), `outbox.ts`; `medplum.ts` `dueSends`/`claim`/`complete`/`fail`; trạng thái signed/sending/retry/sent/failed (`GATEWAY_LABEL`) |
| Thử lại (tự động + thủ công), màn hình "đơn chưa gửi được" | ✅ | M0 | `medplum.ts` `pendingPrescriptions`/`retryPrescription`; `components/Gateway.tsx`; outbox có backoff (`isDue`) |
| Cổng quốc gia (gửi thật) | 🟡 | M0 → M1 | `SimulatedGateway` (gateway.ts): có nút bật/tắt (`mode up/down`) và chèn lỗi (`failNext`), mã quốc gia tiền tố `SIM-`, idempotent theo `localCode`; nhãn ở `SignResult.tsx`/`Scope.tsx`. Gửi thật = T-RX (chờ tài liệu API + sandbox, TL34 Q1) |
| Outbox đối soát idempotent theo mã đơn (đầy đủ) | ✅ | M0 | `medplum.ts` `reconcilePrescriptions` quét List `prescription` thiếu Task `send-prescription` (khoảng trống ghi kép A2/F11) rồi tạo lại Task qua `createResourceIfNoneExist` theo mã đơn (idempotent); route `POST /api/prescriptions/reconcile` (`routes/clinical.ts`, CLINICAL_ROLES, nhật ký `prescription-reconcile` không PII); nút "Quét đối soát" ở `components/Gateway.tsx`; test đột biến `test/unit/reconcile.test.ts` (đã quan sát ĐỎ) + tích hợp `test/integration/clinical.test.ts` (A2) |

## 5. Ngoại tuyến (offline)

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Tiếp đón/khám/kê đơn/ký/in khi mất mạng (theo từng máy) | ✅ | M0 | `apps/clinic-web/src/local/*` (`store.ts` IndexedDB + `crypto.ts` AES-GCM-256 `extractable:false`, IV mới mỗi lần, AAD=bảng+id); in qua `whileLocalStoreQuiet` (F12) |
| Đồng bộ khi có mạng, 0 mất / 0 trùng | ✅ | M0 | `local/sync.ts` `SyncEngine`; `clientUuid` + `createResourceIfNoneExist` ở BFF; `infra/e2e-cycles.mjs` 20 chu kỳ (M0-2) |
| Tạo bệnh nhân / cấp số tạm / in lại khi mất mạng | ✅ | M0 | `local/client.ts`, `visit/OfflineSignResult.tsx` (`recordLocalPrint`); cấp số tạm `medplum.ts` `checkIn` (`proposedNumber`/`arrivedAt`) |
| Tự thoát "Mất mạng" khi máy chủ hồi (thăm dò /api/health) | ✅ | M0 | `local/OfflineProvider.tsx` (`probe: api.health`, đọc lại `navigator.onLine`); PR #22; `.agents/tasks/fix-offline-stuck.md` |
| Phát hiện, báo & xử lý tay xung đột sửa đồng thời + chạy lại quy tắc khi đồng bộ | 🔧 | M0 (phát hiện + xử lý tay) → GĐ2 (hợp nhất tự động) | `local/deps.ts` `needsAttention` (conflict/rules/error → held, không tự bỏ/ghi đè, N3). Xử lý tay (M0): 422 xác nhận lý do gửi lại (`syncActions.ts` `acknowledge`); xung đột 409/lỗi dữ liệu xem chi tiết lý do, in lại đơn đã lưu (`reprint` qua `whileLocalStoreQuiet`), và **đánh dấu "đã xử lý"** để mục rời danh sách (`syncActions.ts` `markHandled` → `sync.ts` `resolveByUser` → trạng thái `resolved`, có xác nhận hai nhịp ở `SyncPanel.tsx`, KHÔNG gửi/ghi đè máy chủ). GĐ2: hợp nhất/đưa bản khám lên máy chủ tự động |
| Chờ ký & gửi cổng khi mất mạng ở mức đầy đủ | ⬜ | M1 (T-OFF-2) | mục 5.2 "Không làm ở M0" |
| Cache toàn bộ 20.000 bệnh nhân khi offline | ⬜ | GĐ2 (T-OFF-3) | M0 chỉ cache vài chục hồ sơ |
| Hai máy thấy nhau khi phòng khám mất Internet | ⬜ | GĐ2 (T-OFF-3) | N5: offline là của từng máy |
| Mã PIN cho kho trên máy | ⬜ | M1 | quyết định 02/10; `README` mục Giới hạn (OFF-5) |

## 6. Zalo

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Nút "Gửi đơn qua Zalo" (bản xem trước tin nhắn) | 🟡 | M0 → M1 | Chỉ hiện bản xem trước, **không gửi**, không gọi mạng, không ghi nhật ký. Nhãn `MÔ PHỎNG` (`ZALO_SIMULATED_LABEL`). `packages/clinical/src/zalo.ts` (`zaloPrescriptionMessage`, không có thuốc/chẩn đoán), `visit/ZaloPreview.tsx` |
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
| Cách ly đa tenant (mỗi phòng khám một Project) | ✅ | M0 | Tenant lấy từ phiên JWT đã ký (`services/bff/src/session.ts`), KHÔNG từ tham số request; 2 phòng khám demo; `infra/medplum/smoke-test`; tiêu chí M0-4 |
| Nhật ký truy cập (fail-closed, không PII) + màn hình xem | ✅ | M0 | `services/bff/src/audit.ts` (`NdjsonAuditSink`, `h.sync()` trước khi trả; `AuditEntry` không chứa nội dung truy vấn/tên/token); ghi trước khi trả dữ liệu ở `routes/context.ts`; `components/AuditLog.tsx` |
| Trang "Phạm vi" (đã thật / mô phỏng / chưa làm) | ✅ | M0 | `components/Scope.tsx` (3 nhóm REAL/SIMULATED/MISSING) + `DemoBanner.tsx`; tiêu chí M0-5 |
| Xác thực nhân viên thật (đăng nhập, MFA) | ⬜ | M1 | **Hiện chỉ `DEMO_AUTH=1`, localhost, dữ liệu giả.** Đăng nhập demo chọn người dùng, chưa có mật khẩu/MFA (`components/Login.tsx`, có nhãn ở `Scope.tsx` nhóm "mô phỏng"). Xác thực thật = T-IDP |
| Nhật ký bất biến ngoài Medplum | ⬜ | M1 (S5) | M0 ghi file cục bộ; T-AUD |
| Đồng ý điện tử đầy đủ, xuất/xóa theo yêu cầu, DPIA | ⬜ | M1 | T-CONSENT, T-OFFB, T-LEGAL |
| Mã hóa cấp trường (CCCD, chỉ số mù) | ⬜ | M1 | T-ENC |
| Phân quyền chi tiết (nhiều cơ sở) | ⬜ | GĐ2 | mục 7 |

## 9. Hạ tầng & vận hành

| Chức năng | Trạng thái | Mốc | Ghi chú / nguồn |
|---|---|---|---|
| Medplum 5.2.0 + PostgreSQL 16 + Redis (Docker Compose) | ✅ | M0 | `infra/medplum/` (Compose, smoke-test) |
| BFF là lớp duy nhất gọi Medplum | ✅ | M0 | **Đã kiểm**: `apps/clinic-web/src` 0 import `@medplum/*`, web chỉ gọi `/api` qua `api.ts`. Lời gọi Medplum thật nằm ở `services/bff/src/medplum.ts`; `@phongmach/{clinical,fhir-vn-model}` chỉ dùng *kiểu* FHIR của `@medplum/*` để dựng tài nguyên |
| Ghi nhiều bản ghi chạy lại được (idempotent, chốt cuối) + chịu xung đột giao dịch | ✅ | M0 | `medplum.ts` `completeVisit`/`writeAll` (kiểm `failedEntries` từng mục dù HTTP 200, chốt đóng lượt khám cuối cùng — F11); `conflict.ts` `retryOnConflict` cho 40001 (`05af7cb`) |
| Cấp phòng khám tự động (Project/Client/AccessPolicy) | 🔧 | M0 (tối thiểu) → M1 | `services/bff/src/tenants.ts`; M0 đủ cho 2 demo; đầy đủ ở T-TEN |
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
