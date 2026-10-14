## Tóm tắt

Sửa ba lỗi tiềm ẩn độc lập làm bài `pnpm e2e:cycles` (M0-2 — 20 chu kỳ ngắt/khôi phục mạng) đỏ ngẫu nhiên trên CI. Chạm 12 tệp ở `packages/rules`, `apps/clinic-web`, `packages/trial` và test của BFF. **Không sửa `services/bff/src/**`** — chốt chặn CCCD ở máy chủ đã đúng và vẫn là nơi quyết định.

## Nguyên nhân gốc

Không phải hồi quy. Cả ba đều là **lỗi tiềm ẩn phụ thuộc thời điểm** (race), chỉ lộ ra khi hạt giống ngẫu nhiên xếp đúng thứ tự sự kiện — không có hạt giống nào "xấu" cố định:

- **A. Quy tắc `no-cccd` chặn ký khi hồ sơ mở bằng bản dự phòng** (lần CI đỏ 38252273087, chu kỳ 16). Hai lớp sửa độc lập:
  - `packages/rules`: thêm `cccdKnown` vào `RuleContext` và quy tắc mới `cccd-unknown` ở mức *ack*. `no-cccd` **giữ nguyên** mức *block* cho trường hợp máy có dữ liệu và bệnh nhân thật sự chưa có CCCD. Cùng nguyên tắc khó mà `allergy-unknown` đã áp: không coi "không biết" là "không có".
  - `offlineOpen` không bỏ rơi dữ liệu máy **đang có**: dùng lại bản tóm tắt từ mục "tạo bệnh nhân" còn trong hàng đợi trên máy (`queuedPatient`).
  - BFF không đổi một dòng: nó chạy lại quy tắc bằng bản ghi máy chủ và **không nhận** cờ `cccdKnown` từ client.
- **B. Người vừa tiếp đón khi mất mạng biến mất khỏi ô tìm ngay khi có mạng lại** (`locator.click` timeout ở "cấp số", như lần CI đỏ 37108599406). Reception khi có mạng chỉ gọi máy chủ; thêm `searchOnline()` nối thêm hồ sơ trên máy mà máy chủ chưa nhận, có nhãn "chưa đồng bộ" (N3).
- **C. Dòng hàng chờ bị dựng lại liên tục** làm không bấm được nút mở hồ sơ (element detached 30 giây). Bài test tìm lại nút ở từng lần thử trong đúng hạn 30 giây cũ và **đếm** số lần phải bấm lại. Churn ở gốc (`Queue.tsx`) đề xuất làm việc riêng, không gộp vào đây.

Bài e2e **mạnh thêm, không yếu đi**: khi không ký được, bài nêu tên quy tắc chặn và xác nhận lý do theo từng quy tắc. Vẫn 20 chu kỳ, vẫn 13 bước kiểm, **không ghim hạt giống, không nới ngưỡng**.

## Hạt giống đã chạy

`e2e:cycles` đạt **13/13 và 20/20 chu kỳ** ở 9 lần chạy liên tiếp với 7 hạt giống:

| Hạt giống | Ghi chú |
|---|---|
| `1393699289` | hạt giống của lần CI đỏ — Đạt 13/13, 20/20, 41 giây |
| `1256812025` | ĐỎ 6/13 trước bản sửa (nguyên nhân C) → Đạt 13/13 ×3 lần sau sửa |
| `1962719789` | ĐỎ trước bản sửa (nguyên nhân B) → Đạt 13/13 ×2 lần sau sửa |
| `3021384584`, `293352907`, `2196728713`, `3034364866`, `2327464172` | ngẫu nhiên — Đạt 13/13 |

Chạy lại: `E2E_SEED=<số> CYCLES_WEB_PORT=4184 CYCLES_BFF_PORT=8121 pnpm e2e:cycles`

## Phép thử ngược (mutation)

6 phép thử, mỗi biện pháp an toàn đều **chứng minh đỏ** khi gỡ:

| # | Gỡ gì | Bài đỏ |
|---|---|---|
| 1 | `queuedPatient()` | `client.test.ts` — `expected false to be true` (`cccdKnown`) |
| 2 | `ctx.cccdKnown === false` → `false` | `client.test.ts` — `expected [ 'no-cccd', 'allergy-unknown' ] to include 'cccd-unknown'` |
| 3 | `hasCccd` → `true` ở BFF | bff unit — `expected [ 201, undefined ] to equal [ 422, 'rules-not-satisfied' ]` |
| 4 | phần nối thêm của `searchOnline` | `client.test.ts` — `expected [] to equal [ Array(1) ]` |
| 5 | buộc `offlineOpen` luôn dùng bản dự phòng + `cccdKnown: true` (= hành vi trước khi sửa) | `e2e:cycles` **ĐỎ 7/13**: `không ký được … [block:no-cccd, ack:allergy-unknown]` — đúng hai phát hiện trên ảnh `FAILED-cycles.png` của lần CI đỏ |
| 6 | như 5 nhưng **bật lại** lớp B1 | **XANH 13/13** — chứng minh B1 là cái mở được nút ký |

Phép thử 5 dựng lại **đúng** lần CI đỏ một cách xác định. Mọi đột biến đã hoàn nguyên.

## Kiểm chứng toàn kho

`pnpm typecheck` xanh (9 package) · `pnpm test` xanh (543 bài) · `pnpm build` xanh · `test:integration` 76/76 (Medplum thật) · `e2e` 13/13 · `e2e:visit` 25/25 · `e2e:offline` 15/15 · `e2e:conflict` 13/13.

Ba container `phongmach-medplum` giữ nguyên container id, không recreate.

Chi tiết, hạt giống và hạn chế: `.agents/tasks/fix-m0-2-cycles.md`
