# Kế hoạch sửa M0-2: chu kỳ 16 không ký được (`no-cccd` chặn hồ sơ mở bằng bản dự phòng)

Chẩn đoán đầy đủ: `.agents/tasks/fix-m0-2-cycles.md`. Tóm lại:

- Quy tắc chặn: **`no-cccd`** mức `block` (`packages/rules/src/check.ts:103`,
  `types.ts:76-77`) — bằng chứng là ảnh `FAILED-cycles.png` của chính lần CI đỏ (run 38252273087).
- Vì lượt khám mở bằng **bản dự phòng** `{id, fullName, birthDate}` (`apps/clinic-web/src/local/client.ts:359`)
  do `cachedPatient()` trượt, nên `cccdMasked` rỗng → `hasCccd = false` (`src/visit/draft.ts:161`).
  Cảnh báo thứ hai trên ảnh (`allergy-unknown`, `check.ts:89`) xác nhận đúng nhánh này
  (`client.ts:367`).
- Nguyên nhân thuộc **(b) mã sản phẩm**, hai khuyết điểm nối nhau:
  **B1** quy tắc coi "máy không biết CCCD" là "bệnh nhân không có CCCD" (chặn cứng, bác sĩ không
  chữa được khi mất mạng), trái nguyên tắc mà kho mã đã áp cho dị ứng;
  **B2** lần tra bộ đệm bệnh nhân trượt sau khi tải lại trang khi mất mạng rồi có mạng lại, dù hồ
  sơ (kèm CCCD, dị ứng) do chính máy đó vừa tạo.
- Bộ sinh dữ liệu của bài test KHÔNG sai (đơn hợp lệ: hai hoạt chất khác nhau, 5 và 10 ngày, có
  CCCD) ⇒ không sửa bộ sinh. Giả định của bài test KHÔNG sai ⇒ không nới bài test.

## Ràng buộc bắt buộc (vi phạm là coi như chưa sửa)

- KHÔNG giảm số chu kỳ (giữ 20), KHÔNG xoá/ghép bước nào trong 13 bước kiểm, KHÔNG ghim hạt giống
  cố định, KHÔNG nới ngưỡng thời gian, KHÔNG `sleep`, KHÔNG coi "không ký được" là kết quả chấp
  nhận được, KHÔNG bỏ qua chu kỳ hỏng.
- KHÔNG `window.print()` thẳng; mọi lần in qua `printHtml`/`whileLocalStoreQuiet` (F12).
- KHÔNG `page.waitForFunction` với hàm `async`; kiểm thử hẹn giờ dùng thời gian ảo.
- KHÔNG đụng stack `phongmach-medplum` (chỉ `docker ps`); KHÔNG thử nghiệm trên phòng khám demo.
- KHÔNG merge, KHÔNG `--force`, KHÔNG `reset --hard`. Được commit trên `fix/m0-2-cycles-sign-blocked`,
  được push và mở PR; CI xanh thì BÁO LẠI rồi dừng — chủ dự án là người duy nhất merge.

---

# Implementation Plan

- [ ] 0. Cập nhật nền của nhánh: nhánh này dựng từ `56a5207` (commit của lần CI đỏ), nhưng `main` đã
      đi tới `02c6fc8` (merge PR #19 — ba commit chỉ chạm `services/bff/scripts/seed-demo.ts` và
      `infra/demo/docker-compose.yml`, không liên quan `e2e:cycles`). Rebase nhánh lên `origin/main`
      rồi `pnpm install` lại trước khi sửa, để CI của PR chạy trên nền hiện tại.
      Files: không có (chỉ thao tác git)
      Verify: `git -C <worktree> log --oneline -1` trùng đỉnh `origin/main` + `pnpm typecheck` xanh.

- [ ] 1. Tái hiện B2 một cách XÁC ĐỊNH ở mức kiểm thử đơn vị (trước khi sửa bất cứ dòng mã sản phẩm nào).
      Thêm một bài trong `client.test.ts` dựng lại đúng chuỗi của chu kỳ 16 bằng `FakeBff`/`FakeClock`:
      (1) `bff.fault(/POST \/api\/patients$/, 'lost')` rồi `client.createPatient({…, cccd: '000123456789'})`
      lúc còn mạng (máy chủ ghi, trình duyệt thấy lỗi mạng); (2) `goOffline()`; (3) `client.checkIn(...)`;
      (4) `client.openVisit(item)`; (5) **giả lập tải lại trang**: `engine.stop()`, mở lại kho bằng
      `openEncryptedStore({tenant:'noi',userId:'doc'})` rồi dựng `SyncEngine` + `OfflineClient` mới trên
      cùng kho; (6) `await goOnline()`; (7) `client.openVisit(item)` lần nữa.
      Khẳng định: `opened.context.patient.cccdMasked` có giá trị, `opened.allergiesKnown === true`,
      và `evaluate(signedDraft(...), {patient: opened.context.patient, …}).verdict.blocking` rỗng.
      Files: `apps/clinic-web/src/local/client.test.ts`
      Verify: `pnpm --filter @phongmach/clinic-web test` — bài mới phải **ĐỎ** và ghi rõ nó trượt ở
      đâu (nếu XANH: B2 không tái hiện được ở mức đơn vị ⇒ làm bước 1b trước khi đi tiếp).

- [ ] 1b. (Chỉ khi bước 1 xanh) Tái hiện B2 bằng e2e có dụng cụ đo.
      Trong một bản sao tạm của `offline-cycles.mjs` (KHÔNG sửa bài gốc), tại chỗ mở hồ sơ, đọc
      IndexedDB qua `rawLocalDump` + `page.evaluate` để in ra: các id trong bảng `patients`, bảng `ids`,
      trạng thái từng mục `ops`, và `item.patientId` của dòng hàng chờ đã bấm; chạy lặp hình dạng chu kỳ
      16 (`E2E_SEED=8 E2E_CYCLES=1`) tới khi trúng.
      Files: `apps/clinic-web/e2e/_probe-cycle16.mjs` (tạm, xoá trước khi commit)
      Verify: log in ra đúng lúc dùng bản dự phòng, nêu được id nào tra trượt. Ghi kết quả vào
      `.agents/tasks/fix-m0-2-cycles.md`.

- [ ] 2. Sửa B2 theo đúng chỗ bước 1/1b chỉ ra, giữ bài test bước 1 làm phép kiểm.
      Ứng viên theo thứ tự khả năng (chỉ sửa cái mà bước 1 chứng minh): (a) `aliases()`/`cachedPatient()`
      bỏ sót một hướng ánh xạ id (tạm → máy chủ hoặc ngược lại) sau khi `effectsOf('patient')` chuyển
      hàng bộ đệm sang id máy chủ (`apps/clinic-web/src/local/ops.ts:136-142`); (b) `offlineOpen` không
      dùng tới hàng `patients` còn lại (ví dụ tra thêm theo `searchCache`/`cccd` khi tra theo id trượt);
      (c) `LocalStoreError('unreadable')` bị nuốt ở đâu đó làm bộ đệm coi như rỗng.
      Nếu nguyên nhân là (a)/(c) thì sửa đúng nó; nếu không thể bảo đảm luôn tra được, thêm đường
      dự phòng ở `offlineOpen` **cộng** bước 3 (hai lớp độc lập).
      Files: `apps/clinic-web/src/local/{client.ts,ops.ts}` (chỉ tệp liên quan)
      Verify: `pnpm --filter @phongmach/clinic-web test` — bài bước 1 chuyển XANH, các bài cũ vẫn xanh.

- [ ] 3. B1 trong `packages/rules`: tách "không biết CCCD" khỏi "không có CCCD".
      Thêm `cccdKnown?: boolean` vào `RuleContext` (mặc định `true`) và quy tắc mới `cccd-unknown`
      mức `ack` với thông điệp kiểu "Máy chưa có dữ liệu CCCD của bệnh nhân này (mở hồ sơ khi mất
      mạng): xác nhận đã đối chiếu CCCD trước khi ký."; khi `cccdKnown === false` thì KHÔNG phát
      `no-cccd`. Giữ nguyên `no-cccd` mức `block` cho trường hợp máy có dữ liệu và bệnh nhân thật sự
      chưa có CCCD. Thêm `'cccd-unknown'` vào `RuleId`.
      Files: `packages/rules/src/{types.ts,check.ts}`, `packages/rules/test/rules.test.ts`
      Verify: `pnpm --filter @phongmach/rules test` — bài mới xanh: `cccdKnown: false` ⇒ đúng một
      phát hiện `cccd-unknown` mức `ack`, `judge(f, [])` cho `canSign === false`, có lý do ⇒ ký được;
      `cccdKnown` mặc định ⇒ hành vi `no-cccd` cũ không đổi.

- [ ] 4. Dẫn cờ "không biết CCCD" từ chỗ mở hồ sơ tới quy tắc ở giao diện.
      `Opened` thêm `cccdKnown: boolean` (`false` đúng khi `offlineOpen` phải dùng bản dự phòng, tức
      `cached?.patient` không có); `openVisit` online trả `true`. `evaluate` nhận `cccdKnown` và truyền
      vào `checkPrescription`; `Visit.tsx` truyền `opened.cccdKnown`. Sửa luôn gợi ý trên màn hình
      ("Thiếu CCCD? Bổ sung ở màn hình Tiếp đón…") để không hiện câu sai khi chỉ là chưa có dữ liệu.
      Files: `apps/clinic-web/src/local/client.ts`, `apps/clinic-web/src/visit/{draft.ts,Visit.tsx}`
      Verify: `pnpm typecheck && pnpm --filter @phongmach/clinic-web test`; thêm một bài đơn vị:
      hồ sơ mở bằng bản dự phòng ⇒ `verdict.blocking` rỗng, `verdict.unacknowledged` chứa
      `cccd-unknown`.

- [ ] 5. BFF: chứng minh máy chủ vẫn là chốt chặn thật cho CCCD.
      `services/bff/src/routes/clinical.ts:202-213` đã chạy lại quy tắc bằng `context.patient.cccdMasked`
      của máy chủ; thêm (nếu thiếu) để yêu cầu ký kèm `cccdUnknown` không làm máy chủ bỏ qua `no-cccd`,
      và thêm bài kiểm thử: ký đơn cho bệnh nhân **máy chủ không có CCCD** ⇒ bị từ chối 422 `rules`
      dù client gửi xác nhận `cccd-unknown`; bệnh nhân **có CCCD** ⇒ ký được.
      Files: `services/bff/src/routes/clinical.ts`, `services/bff/test/*` (theo mẫu bài quy tắc đang có)
      Verify: `pnpm --filter @phongmach/bff test`, và `pnpm --filter @phongmach/bff test:integration`
      (cần stack Medplum đang chạy).

- [ ] 6. Làm bài e2e nói rõ quy tắc nào chặn (mạnh thêm, không yếu đi).
      Trong `sign()` của `offline-cycles.mjs`, khi `sign` bị khóa thì đọc thêm
      `[data-testid="rule"]` (`data-rule`, `data-severity`) và chèn vào thông điệp lỗi, ví dụ
      `không ký được: Chưa thể ký: 1 lỗi không thể ký. [block:no-cccd, ack:allergy-unknown]`.
      Giữ nguyên mọi phép kiểm, không thêm đường "bỏ qua".
      Files: `apps/clinic-web/e2e/offline-cycles.mjs`
      Verify: phép thử ngược — tạm đổi `DEFAULT_RULES_CONFIG.requireCccd` thành `'block'` cho
      `cccdKnown === false` (tức gỡ bản sửa bước 3) rồi chạy `E2E_SEED=8 E2E_CYCLES=1 pnpm e2e:cycles`:
      bài phải ĐỎ **và** thông điệp phải nêu tên `no-cccd`. Hoàn nguyên sau khi thấy đỏ.

- [ ] 7. Chạy lại toàn bộ bài M0-2 với hạt giống của lần đỏ và các hạt giống khác.
      Thứ tự: `E2E_SEED=1393699289 pnpm e2e:cycles` (kỳ vọng **13/13, 20/20**), rồi
      `E2E_SEED=4015508734`, rồi **≥3 hạt giống ngẫu nhiên mới** (chạy `pnpm e2e:cycles` không đặt
      `E2E_SEED`, ghi lại số hạt giống bài in ra ở dòng đầu). Dùng bản build; cổng bận thì đặt
      `CYCLES_WEB_PORT`/`CYCLES_BFF_PORT`, không dừng tiến trình lạ. Gặp 429 thì chờ 1 phút.
      Files: `.agents/tasks/fix-m0-2-cycles.md` (bảng hạt giống + kết quả từng lần)
      Verify: mọi lần chạy đều `Đạt 13/13` và `20/20 chu kỳ`; dán nguyên dòng kết luận của từng lần.

- [ ] 8. Phép thử đột biến (chứng minh các biện pháp còn hiệu lực).
      (i) Gỡ yêu cầu lý do cho `cccd-unknown` (biến nó thành không cần xác nhận) ⇒ bài
      `packages/rules` phải ĐỎ. (ii) Gỡ dòng chạy lại quy tắc ở BFF (`routes/clinical.ts:202`) ⇒ bài
      bước 5 phải ĐỎ. (iii) Hoàn nguyên bản sửa bước 2 ⇒ bài đơn vị bước 1 phải ĐỎ. (iv) Buộc
      `offlineOpen` luôn dùng bản dự phòng ⇒ `E2E_SEED=8 E2E_CYCLES=1 pnpm e2e:cycles` phải ĐỎ.
      Hoàn nguyên từng đột biến ngay sau khi thấy đỏ.
      Files: không commit (chỉ sửa tạm rồi hoàn nguyên)
      Verify: ghi vào báo cáo từng đột biến + dòng lỗi quan sát được.

- [ ] 9. Kiểm thử toàn kho và e2e còn lại.
      Verify: `pnpm typecheck`, `pnpm test`, `pnpm e2e` (cần stack + seed + BFF + web), tất cả xanh.

- [ ] 10. Commit trên `fix/m0-2-cycles-sign-blocked`, push, mở PR, rồi DỪNG.
      Mô tả PR nêu: quy tắc `no-cccd` chặn vì hồ sơ mở bằng bản dự phòng (kèm ảnh CI), hai bản sửa
      B1/B2, danh sách hạt giống đã chạy (gồm `1393699289`), các phép thử đột biến, và đề xuất nói
      lại câu "M0-2 đạt" trong `docs/ke-hoach-trien-khai.md` (KHÔNG tự sửa tài liệu kế hoạch).
      Verify: CI của PR xanh cả 3 job (check, integration, e2e) — xanh thì báo lại cho chủ dự án,
      KHÔNG merge.

## Dọn dẹp

Xoá worktree thăm dò khi không cần nữa:
`git -C "d:\My Documents D\UNIGIS\PM\phongmach" worktree remove .worktrees/probe-4013df1 --force`
và kết thúc các tiến trình do mình tạo theo PID (không dùng `pkill -f` theo mẫu chữ).
