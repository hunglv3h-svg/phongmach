# Xác minh — T-OUTBOX (đối soát hộp thư đi idempotent theo mã đơn)

Nhánh: `feat/t-outbox-reconcile`. Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\t-outbox-reconcile`.
Môi trường: Windows, Node 22, pnpm 12.8.1. Stack Medplum 5.2.0 chạy sẵn trong Docker (`phongmach-medplum-*`, cổng 8103).

## Lệnh đã chạy và kết quả

### `pnpm typecheck` — ✅ ĐẠT
Toàn bộ 9 workspace project biên dịch sạch (fhir-vn-model, catalogs, rules, clinical, trial, print, bff, clinic-web), Exit Code 0, không lỗi.

### `pnpm test` (unit, không cần Medplum) — ✅ ĐẠT
Mọi package xanh. BFF: 11 file / 131 test. clinical: 14 file / 230 test. Tổng tất cả project xanh, Exit Code 0.
Trong đó file mới `services/bff/test/unit/reconcile.test.ts` (2 test) xanh.

### `pnpm --filter @phongmach/bff test:integration` (Medplum thật) — ✅ ĐẠT
Chạy với stack Medplum thật đang chạy (Docker, cổng 8103). Kết quả: **77 test xanh** (3 test file), Exit Code 0.
Bao gồm `describe('đối soát: đơn đã ký thiếu trạng thái gửi (A2, F11)')` mới thêm trong
`services/bff/test/integration/clinical.test.ts`.

Lưu ý: Medplum giới hạn đăng nhập 5 lần/phút/IP (F5). Lần chạy integration ngay sau một lần khác cần chờ ~60s
để tránh 429 ở khâu `beforeAll` (dựng tenant tạm). Đây là hạn mức hạ tầng, không phải lỗi mã.

## Kiểm thử đột biến (BẮT BUỘC) — ĐÃ QUAN SÁT ĐỎ

File: `services/bff/test/unit/reconcile.test.ts`.

Trạng thái dựng: một đơn ĐÃ KÝ (visit `done`, có `prescription`) nhưng Task gửi bị gỡ
(mô phỏng ở `FakeStore` bằng cách xóa `prescription.gateway`) ⇒ đại diện "signed nhưng KHÔNG có send-status",
và `pendingPrescriptions` không trả nó về (đúng mô hình: không có Task thì không có dòng pending).

**Bước quan sát ĐỎ:** tạm vô hiệu hóa đối soát bằng cách cho `FakeStore.reconcilePrescriptions`
`return { scanned: 0, requeued: [] }` (không làm gì), rồi chạy `vitest run test/unit/reconcile.test.ts`.
Kết quả: test chính **ĐỎ** tại khẳng định (b):

```
AssertionError: expected [] to include 'PM-261020-8SQ8GT'
  expect(res.json().requeued).toContain(code);
```

(và kéo theo (c) pending không có đơn, (d) idempotent — đều phụ thuộc đối soát). Test phân quyền 403 vẫn xanh
vì không phụ thuộc logic đối soát.

**Khôi phục** cài đặt đúng của `reconcilePrescriptions` ⇒ chạy lại: **2/2 test XANH**.

Khẳng định của test (sau khi khôi phục):
- (a) TRƯỚC khi quét: `GET /api/prescriptions/pending` KHÔNG chứa đơn bị kẹt.
- (b) `POST /api/prescriptions/reconcile` → `requeued` chứa mã đơn; ghi đúng 1 dòng nhật ký `prescription-reconcile`
  (`outcome: ok`, `resultCount: 1`), KHÔNG chứa PII (kiểm không khớp tên/CCCD/thuốc/chẩn đoán).
- (c) SAU khi quét: `pending` chứa đơn ở trạng thái `signed`.
- (d) Gọi `reconcile` lần hai: `requeued` rỗng (idempotent theo mã đơn).
- Phân quyền: phụ tá (`a-assistant`) → 403, có nhật ký `denied`.

Test tích hợp A2 (Medplum thật) chứng minh thêm ở tầng dữ liệu thật: ký một đơn → xóa Task `send-prescription`
qua admin → `pending` mất đơn → `store.reconcilePrescriptions` tạo lại Task (`count(Task)` = 1) → worker gửi được
(`status: sent`, mã `SIM-`) → gọi `reconcile` lần hai KHÔNG tạo Task thứ hai (`count(Task)` vẫn = 1).

## Bất biến đã giữ
- Web vẫn 0 import `@medplum/*`: `api.reconcile` chỉ gọi `/api/...`, `Gateway.tsx` chỉ dùng *type*.
- Tenant từ phiên (route dùng `ctx.store(req)`), không từ tham số.
- Nhật ký `prescription-reconcile` ghi TRƯỚC khi trả, không PII (chỉ `resultCount`).
- Idempotent qua `createResourceIfNoneExist(buildSendTask(...), 'identifier=...')` — không đụng `clientUuid`/gói hoàn tất/điểm chốt F11.
- Cổng vẫn MÔ PHỎNG, giữ nguyên nhãn "CỔNG QUỐC GIA: MÔ PHỎNG"; không đổi hành vi gửi.
