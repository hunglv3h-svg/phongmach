# T-IDP — Thiết kế xác thực nhân viên THẬT cho PHONGMACH

> Trạng thái: **BẢN THIẾT KẾ — CHỜ CHỦ DỰ ÁN CHỐT A/B** trước khi code.
> Phạm vi tài liệu này: chỉ thiết kế. Không sửa mã nguồn package nào trong vòng chạy này.
> Nhánh làm việc: `t-idp-design` (worktree `.worktrees/t-idp-design`, base `main`).

---

## 1. Bối cảnh và vấn đề

Hiện tại BFF **chưa có xác thực thật**. Đường chạy thực tế dựa vào `DEMO_AUTH=1`:

- `services/bff/src/server.ts` **thoát ngay** (`process.exit(1)`) nếu `DEMO_AUTH!=1`, và chỉ cho bind `127.0.0.1`/`localhost`. Đây là chốt an toàn: không có auth thật thì BFF không được mở ra mạng.
- `POST /api/session` (trong `app.ts`) nhận `{ tenant, userId }` **không mật khẩu**, tra trong `.demo-tenants.json` (schema `tenants.ts`), rồi ký một JWT phiên bằng `SessionService` (`session.ts`). Màn `Login.tsx` liệt kê thẳng danh sách user demo lấy từ `GET /api/session/demo-users`.
- Trang "Phạm vi" (`Scope.tsx`) xếp *"Đăng nhập: chọn người dùng demo, chưa có mật khẩu (T-IDP)"* vào nhóm **mô phỏng**; `DemoBanner.tsx` ghi *"Chưa có xác thực thật"*.

Các bất biến an toàn **đã có và phải giữ nguyên** sau T-IDP:

1. **Tenant đến từ phiên (JWT đã ký trên BFF), không bao giờ từ tham số request.** Mọi route lấy tenant qua `req.session!.tenant` (xem `app.ts`: `store: (req) => deps.stores(req.session!.tenant)`), không có route nào đọc tenant từ body/query/header do client gửi. `SessionService.verify` là nơi duy nhất biến token → `{ userId, userName, role, tenant }`.
2. **Ghi nhật ký truy cập TRƯỚC khi trả dữ liệu (fail-closed), không PII.** `record()` được `await` trước mỗi `return` dữ liệu; `audit.ts` `NdjsonAuditSink.record` fsync xuống đĩa và trả promise — ghi lỗi ⇒ route ném ⇒ 500, dữ liệu không rời BFF. Log Fastify đã bỏ query string và redact `authorization`.
3. **BFF là lớp duy nhất gọi Medplum.** Chỉ `medplum.ts` import `@medplum/*`; web **0 import** `@medplum/*` (chỉ `api.ts` gọi `/api/...` và import *type*). Đăng nhập máy vào Medplum là **client-credentials theo tenant** (`medplum.ts`: `startClientLogin(clientId, secret)`), hoàn toàn tách khỏi danh tính nhân viên.

Mục tiêu T-IDP: thay danh tính nhân viên demo bằng xác thực thật (mật khẩu + MFA + vòng đời token cấp/refresh/thu hồi), bỏ `DEMO_AUTH=1` khỏi đường chạy thật nhưng vẫn giữ **một chế độ demo riêng, có nhãn, cho diễn tập** — mà không phá ba bất biến trên.

Điểm mấu chốt cần hiểu: **danh tính nhân viên và danh tính máy-gọi-Medplum là hai lớp khác nhau và vẫn tách sau T-IDP.** Nhân viên xác thực để lấy *phiên BFF*; BFF vẫn tự giữ secret ClientApplication của từng tenant để nói chuyện với Medplum. T-IDP **không** làm web hay nhân viên có token Medplum. Bất biến #3 nhờ vậy không bị đụng tới dù chọn A hay B.

---

## 2. Quyết định lõi: Phương án A (user Medplum làm IdP) vs B (IdP riêng UNIGIS)

### 2.1 Phương án A — dùng người dùng Medplum làm IdP (kèm TOTP)

Mỗi nhân viên là một Medplum `User` + `ProjectMembership` trong Project của phòng khám; đăng nhập mật khẩu + TOTP qua luồng auth của Medplum; BFF nhận lại danh tính rồi tự ký JWT phiên như hiện nay (hoặc dùng token Medplum, xem bên dưới).

**Ưu:**
- Ít thành phần mới: Medplum đã có `User`/password/TOTP sẵn, có `ProjectMembership` ánh xạ user → Project (hợp với mô hình "một Project + một ClientApplication mỗi phòng khám", F6/T-TEN).
- Chính sách mật khẩu, băm, khóa tài khoản đã có người viết và kiểm thử.

**Nhược (nặng, bám F2/F5/row12):**
- **F2 — egress HIBP bắt buộc.** Medplum **luôn gọi `api.pwnedpasswords.com`** khi *tạo user / đặt / đổi mật khẩu*, không có công tắc tắt; mạng chặn → `fetch failed`, **không tạo/đổi được mật khẩu**. Chỉ gửi tiền tố băm (không phải dữ liệu bệnh nhân), nhưng đây là **egress nước ngoài trên đường xác thực** ⇒ cần proxy egress được duyệt theo NĐ 53/2022 (T-EGR). Chọn A = **phải chấp nhận và vận hành proxy egress HIBP**; đây là một quyết định tuân thủ, không chỉ kỹ thuật.
- **F5 — hạn mức đăng nhập 5 lần/phút/IP, dùng chung sau NAT.** Nhiều phòng khám sau cùng NAT (hoặc proxy không chuyển IP thật) chia nhau một bộ đếm ⇒ **đăng nhập hàng loạt thất bại âm thầm**. Trên đường thật của người dùng cuối, đây là rủi ro vận hành thực sự, không chỉ là bẫy test.
- **Row 12 — SĐT + OTP + thiết bị tin cậy không có sẵn** trong Medplum mặc định; MFA của Medplum là TOTP, vẫn "dính F2" cho khâu đặt mật khẩu. OTP qua SĐT (kênh tự nhiên cho phòng khám VN) sẽ phải tự dựng *ngoài* Medplum dù chọn A ⇒ A không tránh được việc tự làm phần OTP.
- Ánh xạ nhiều phòng khám: nhân viên làm ở nhiều phòng khám cần nhiều membership; luồng "chọn phòng khám sau khi đăng nhập" phải tự dựng trên BFF.

### 2.2 Phương án B — IdP riêng của UNIGIS (OIDC) ánh xạ vào Medplum

UNIGIS tự vận hành một IdP (OIDC): tự giữ mật khẩu nhân viên (băm nội địa), TOTP và/hoặc OTP SĐT, thiết bị tin cậy, chính sách khóa/giới hạn tốc độ. BFF là OIDC Relying Party: nhận `id_token` của IdP, ánh xạ `sub` + claim phòng khám → tenant nội bộ, rồi ký JWT phiên BFF như hiện nay. Medplum **vẫn chỉ nhận client-credentials theo tenant** từ BFF; danh tính nhân viên **không** đi vào Medplum.

**Ưu:**
- **Kiểm soát hoàn toàn** mật khẩu/MFA/OTP SĐT/thiết bị tin cậy — làm đúng row 12 (SĐT + OTP + thiết bị tin cậy; MFA cho vai trò ký/quản trị).
- **Tránh egress HIBP bắt buộc trên đường xác thực** — không phải mở `pwnedpasswords.com` qua proxy để nhân viên đổi mật khẩu (vẫn *có thể* chủ động dùng danh sách mật khẩu lộ, nhưng theo điều kiện của ta, offline, qua T-EGR nếu muốn). Giảm một phụ thuộc nước ngoài trên đường xác thực (phù hợp định hướng NĐ 53/2022).
- **Tách hạn mức đăng nhập khỏi Medplum (F5):** rate-limit đăng nhập do IdP của ta đặt, theo tài khoản/thiết bị chứ không theo IP dùng chung sau NAT.
- Dễ áp **chính sách mật khẩu nội địa** và yêu cầu MFA theo vai trò.
- Giữ nguyên mô hình phiên BFF hiện có (JWT nội bộ, tenant trong JWT) — thay đổi tập trung ở *nguồn danh tính*, không lan ra mọi route.

**Nhược:**
- **Thêm một hệ thống phải tự vận hành/bảo mật** (lưu băm mật khẩu, bí mật TOTP, kênh gửi OTP SĐT, chống nhồi mật khẩu). Đây là bề mặt tấn công mới, cần T-SEC riêng.
- Phải thiết kế **ánh xạ OIDC → tenant** và quy ước claim (phòng khám, vai trò) rõ ràng; nhân viên nhiều phòng khám cần claim nhiều tenant hoặc chọn tenant sau đăng nhập.
- **Nhiều việc hơn cho M0** nếu dựng IdP đầy đủ ngay.

### 2.3 ĐỀ XUẤT: **Phương án B (IdP riêng UNIGIS, OIDC) — nhưng M0 dùng một "IdP tối giản nhúng trong BFF" theo đúng giao diện OIDC/claim của B, chưa dựng IdP tách rời.**

Lý do:

1. **F2 là lý do quyết định.** Đặt một dịch vụ egress nước ngoài **bắt buộc trên đường đăng nhập/đổi mật khẩu của mọi nhân viên** là rủi ro tuân thủ (NĐ 53/2022) và rủi ro sẵn-sàng (mất mạng ra quốc tế = không ai đổi được mật khẩu). B loại rủi ro này khỏi đường thật.
2. **F5 là lý do vận hành.** Phòng khám VN thường sau NAT; để Medplum đếm 5 lần/phút/IP làm bộ đếm đăng nhập của người dùng cuối sẽ gây lỗi khó hiểu tại hiện trường. B tự kiểm soát rate-limit.
3. **Row 12 đằng nào cũng phải tự làm.** SĐT + OTP + thiết bị tin cậy không có trong Medplum; chọn A vẫn phải tự dựng phần này *rồi* chịu thêm F2/F5. B gộp mọi thứ về một chỗ ta kiểm soát.
4. **Bất biến #3 không bị đụng dù A hay B.** Vì BFF vẫn gọi Medplum bằng client-credentials theo tenant. Dùng Medplum làm IdP (A) **không** mang lại lợi ích "đơn giản hóa đường Medplum" nào — danh tính nhân viên và danh tính máy vẫn là hai lớp. Cho nên "ưu điểm ít thành phần" của A phần lớn chỉ đúng với *lưu trữ mật khẩu*, mà cái giá là F2+F5.
5. **Rủi ro "thêm hệ thống" của B được cắt cho M0** bằng cách **không dựng IdP tách rời ngay**. M0 làm một "IdP tối giản" **nhúng trong BFF** nhưng **thiết kế đúng theo ranh giới OIDC của B**: một module `identity` tự giữ bản ghi nhân viên (mật khẩu băm bằng Argon2id, bí mật TOTP, thiết bị tin cậy) và phát ra cùng loại claim mà một IdP OIDC thật sẽ phát. Phiên BFF, tenant-trong-JWT, và cách mọi route đọc `req.session` **giữ nguyên**. Sang M1, module này được tách thành IdP OIDC độc lập mà *không* phải sửa lớp route — chỉ đổi nguồn phát claim. Như vậy M0 không gánh chi phí vận hành một IdP riêng, nhưng cũng không khóa mình vào A.

> **Hệ quả cho chủ dự án:** nếu chọn A, phải **chấp nhận egress HIBP qua proxy** (T-EGR) như một điều kiện tuân thủ, và chấp nhận rủi ro F5 sau NAT. Đề xuất là B để tránh cả hai. Xem §9 cho các giả định cần chốt.

Phần còn lại của thiết kế viết theo **B (IdP tối giản nhúng ở M0, giao diện OIDC-ready cho M1)**. Nếu chủ dự án chốt A, các mục §4–§8 vẫn áp dụng gần như nguyên vẹn (phiên, tenant, token, offline, test) — chỉ *nguồn xác thực mật khẩu/MFA* đổi sang luồng Medplum và phải thêm proxy egress HIBP; mục §3.3 ghi rõ phần khác biệt.

---

## 3. Kiến trúc sau thay đổi

### 3.1 Hai lớp danh tính (giữ nguyên nguyên tắc, làm rõ)

```
Nhân viên ──(mật khẩu + MFA)──▶ Lớp Identity (M0: nhúng BFF; M1: IdP OIDC)
                                      │ phát claim { sub, name, role, tenant(s) }
                                      ▼
                              BFF SessionService ──(ký JWT phiên nội bộ, HS256)──▶ cookie/token phiên
                                      │ tenant LẤY TỪ claim đã xác thực, KHÔNG từ request
                                      ▼
                              Route BFF ──(client-credentials theo tenant)──▶ Medplum
```

Lớp Identity là **thành phần mới duy nhất**. `SessionService`, cách route đọc `req.session`, `MedplumTenants` giữ nguyên.

### 3.2 Luồng token: access ngắn + refresh dài + thu hồi

Hiện `SessionService` ký một JWT 480 phút, không refresh, không thu hồi (`session.ts`). Thay bằng mô hình hai token:

- **Access token (JWT phiên BFF, HS256, ngắn hạn ~15 phút).** Mang `{ sub, name, role, tenant, sid }`. `sid` = id phiên (session id) để tra bảng thu hồi. Mọi route verify access token y như `requireSession` hiện nay. **Tenant vẫn nằm trong token đã ký** — bất biến #1 không đổi.
- **Refresh token (opaque, dài hạn, chỉ dùng một lần — rotating).** Lưu *băm* refresh token ở server (bảng `sessions` trong kho phiên BFF; cấu hình qua `SESSION_STORE_URL`). Gửi về client trong **cookie HttpOnly, Secure, SameSite=Strict**, path giới hạn `/api/session/refresh`. `POST /api/session/refresh` đổi refresh cũ lấy cặp access+refresh mới, **xoay** refresh; refresh đã dùng lại (replay) → **thu hồi cả `sid`**.

  **Kho phiên M0 và tính nguyên tử của xoay refresh (sửa theo review MEDIUM-2):** xoay refresh đòi **đọc-kiểm-xoay nguyên tử** để phát hiện replay (một refresh dùng hai lần phải thu hồi cả `sid`). Một file JSON append/ghi-đè ngây thơ dính đúng lớp lỗi mà dự án đã học với giao dịch Medplum (F11 không nguyên tử): hai lần refresh song song có thể cùng kiểm hợp lệ *trước khi* bên nào kịp xoay, làm hỏng phát hiện replay. Vì vậy kho phiên M0 **không** được là file JSON ghi ngây thơ. Chọn một trong hai (ghi rõ trong hợp đồng `SESSION_STORE_URL`):
  - **(khuyến nghị M0) SQLite cạnh BFF** với **ràng buộc UNIQUE trên băm refresh hiện hành** + "consume" bằng một câu `UPDATE … WHERE refresh_hash = ? AND state='current'` rồi kiểm **số dòng bị ảnh hưởng = 1** (compare-and-set nguyên tử). Dòng = 0 ⇒ refresh đã bị tiêu thụ (replay) ⇒ **thu hồi `sid`**.
  - **(M1) Redis** với `GETDEL`/script Lua để "consume" nguyên tử.
  - Nếu buộc dùng kho trong tiến trình: **tuần tự hóa refresh theo từng `sid`** bằng một chuỗi async khóa-theo-sid (giống `NdjsonAuditSink.chain` / `EncryptedStore.serial` đã có trong mã) để hai refresh cùng `sid` không chạy chồng. Vẫn phải "consume một lần"; consume thất bại ⇒ thu hồi `sid`.
  
  Bất biến: **refresh là một-lần (single-use) qua một thao tác consume nguyên tử; consume thất bại ⇒ thu hồi `sid`.** Thêm case replay song song vào B5.
- **Thu hồi — kiểm `sid` trên MỌI route `requireSession` (sửa theo review HIGH-3).** `POST /api/session/logout` và `DELETE /api/sessions/:sid` xóa bản ghi phiên theo `sid`. `requireSession` sau khi `verify` chữ ký access token **tra `sid` trong kho phiên và từ chối (401) nếu `sid` đã bị thu hồi** — áp dụng cho **cả route đọc lẫn route ghi/ký**, không miễn trừ route đọc. 

  **Vì sao kiểm cả route đọc:** cả hệ thống xoay quanh truy cập dữ liệu bệnh nhân có kiểm toán; để một phiên bị thu hồi vẫn **đọc được PHI tới 15 phút** là một quyết định bảo mật thực sự, không nên để thành chú thích bên lề. Kho phiên là cục bộ (M0: SQLite cạnh BFF; M1: Redis), tra `sid` là một phép tra khóa cục bộ rẻ hơn nhiều so với mọi route đọc vốn đã phải gọi Medplum ⇒ chi phí không đáng kể. Vì vậy **thu hồi có hiệu lực tức thì cho mọi route**, không còn cửa sổ 15 phút cho đọc.

  Access token ngắn (15 phút) vẫn hữu ích để **giới hạn thiệt hại khi token bị lộ mà kho phiên tạm không truy được** (ví dụ sự cố kho), nhưng không còn là cơ chế thu hồi chính.

**Vì sao đổi 480 phút → 15 phút + refresh:** bài học M0-S2 dòng 6 — token 480 phút *không gia hạn khi mất mạng*. Access ngắn + refresh dài cho phép **gia hạn im lặng khi online** mà vẫn **thu hồi được**; đồng thời quy ước offline (dưới đây) bảo đảm hàng đợi đồng bộ sống sót qua cả lúc refresh token hết hạn.

### 3.3 Khác biệt nếu chủ dự án chốt A thay vì B

Nếu A: Lớp Identity được thay bằng **cầu nối tới luồng auth Medplum** — BFF chuyển mật khẩu + mã TOTP tới Medplum (`/auth/login` + bước MFA), nhận xác nhận danh tính + `ProjectMembership`, rồi **vẫn tự ký JWT phiên BFF** như §3.2 (không dùng trực tiếp token Medplum của *user* để tránh web/route phụ thuộc token Medplum — giữ bất biến #3). Phải thêm: (a) **proxy egress HIBP** cho khâu tạo/đặt/đổi mật khẩu (F2, T-EGR); (b) xử lý **F5** (hạn mức 5 lần/phút/IP) ở tầng BFF, ví dụ hàng đợi/đệm đăng nhập theo tenant để không vượt bộ đếm IP dùng chung; (c) phần **OTP SĐT** vẫn phải tự dựng vì Medplum không có. Các mục §4 (vòng đời), §5 (demo), §6 (offline), §7–§8 (test) **không đổi**.

---

## 4. Luồng đăng nhập / MFA / refresh / thu hồi (phương án B)

### 4.1 Đăng nhập mật khẩu

1. Web `POST /api/session` với `{ loginId, password }` (`loginId` = SĐT hoặc mã nhân viên; **không gửi tenant** — tenant suy ra từ hồ sơ nhân viên sau khi xác thực, không tin client).
2. BFF **ghi audit `login` với `outcome` dự kiến trước khi trả** (xem §4.5 về fail-closed cho login). Lớp Identity tra nhân viên theo `loginId`, so mật khẩu (Argon2id). Sai → `401 invalid-login` (ghi `login`/`denied`), kèm rate-limit nội bộ (§4.6).
3. **Quy tắc MFA M0 (chốt rõ, sửa theo review MEDIUM-4): TOTP là BẮT BUỘC cho vai trò `owner` và `doctor`** ("vai trò ký/quản trị", row 12), không để ngỏ. Hệ quả cụ thể:
   - Nếu `owner`/`doctor` **đã đăng ký TOTP:** sau mật khẩu đúng, trả `200 { mfaRequired: true, mfaToken }` — `mfaToken` là JWT ngắn (~5 phút, `typ:'mfa'`) *chỉ* chứng minh "đã qua mật khẩu", **chưa phải phiên**, không mở được route dữ liệu.
   - Nếu `owner`/`doctor` **chưa đăng ký TOTP:** trả `200 { enrollMfa: true, mfaToken }`; nhân viên **bị buộc qua luồng đăng ký TOTP** (§4.2) ngay lần đăng nhập đó và **không thể chạm route dữ liệu** cho tới khi đăng ký xong và xác minh một mã. Đây là "forced enrollment gate" — không có đường vòng.
   - Vai trò `assistant`: MFA **khuyến khích nhưng không bắt buộc** ở M0; nếu chưa bật thì bước 3 cấp luôn access+refresh.
4. Web `POST /api/session/mfa` với `{ mfaToken, code }`. BFF kiểm TOTP (OTP SĐT là kênh mô phỏng-có-nhãn ở M0, §4.3). Đúng → cấp **access + refresh** (§3.2) hoặc pre-tenant token nếu nhiều tenant (§4.1 phần nhiều phòng khám), đặt cookie refresh, trả access + `{ user, tenant }`.

> Ghi rõ ranh giới: **OTP qua SĐT và "thiết bị tin cậy" ở M0 là mô phỏng-có-nhãn** (§4.3); **TOTP là MFA thật, bắt buộc** cho `owner`/`doctor`. §10(2) chỉ còn là điểm *xác nhận-hoặc-ghi-đè* quyết định này, không phải chỗ bỏ ngỏ.

Nhân viên nhiều phòng khám — **token tiền-tenant (sửa theo review MEDIUM-1):** sau khi qua mật khẩu (+MFA), nếu claim mang **danh sách >1 tenant**, BFF **không** cấp access token (access token *phải* có đúng một tenant đã bake vào — bất biến #1). Thay vào đó cấp một **pre-tenant token**: một JWT ngắn (~5 phút, ký bằng `REFRESH_SECRET`, mang `typ:'pretenant'` + `allow: [tenant…]` = danh sách tenant **đã xác thực**), trả `200 { chooseTenant: [...], pretenantToken }`. 

- Pre-tenant token **không được `requireSession` chấp nhận cho route dữ liệu** — cùng cơ chế chặn như `mfaToken` ở §4.1(3): `SessionService.verify` chỉ nhận token `typ:'access'`; token `typ:'pretenant'`/`typ:'mfa'` ⇒ `verify` trả undefined ⇒ 401. Vì vậy không bao giờ có route nào chạy với `req.session.tenant === undefined`.
- Web gọi `POST /api/session/select-tenant { pretenantToken, tenant }`. BFF verify pre-tenant token, kiểm **`tenant ∈ allow`** (danh sách đã ký trong token, **không** phải danh sách client tự khai); hợp lệ → ký access (+refresh) với tenant đó bake vào. Tenant không nằm trong `allow` → 403.

Vẫn là bất biến #1: tenant đến từ danh sách đã-ký trong pre-tenant token, request chỉ *chọn trong tập đã xác thực*, không tự khai tenant mới. **Test (bảng B2b):** (a) pre-tenant token gọi `/api/patients/search` → **401** (không mở route dữ liệu); (b) `select-tenant` với `tenant` **không** thuộc `allow` đã ký → **403**, kể cả khi client còn nhồi thêm `tenant` khác vào body/query. **Mutation:** cho `verify` chấp nhận `typ:'pretenant'` như access ⇒ (a) đỏ; đọc danh sách `allow` từ body thay vì từ token đã ký ⇒ (b) đỏ.

### 4.2 TOTP

Đăng ký TOTP (lúc tạo tài khoản / bật MFA): BFF sinh secret, trả QR `otpauth://`, lưu secret **đã mã hóa** cạnh hồ sơ nhân viên. Xác minh bằng cửa sổ ±1 bước 30s. Mã khôi phục (recovery codes) dùng một lần, lưu dạng băm.

### 4.3 OTP qua SĐT (row 12) — tùy chọn M0, có nhãn

Nếu bật: `POST /api/session/mfa` chấp nhận `channel: 'sms'`; BFF gửi OTP qua **nhà cung cấp SMS** — ở M0 **mô phỏng, có nhãn** như Zalo/cổng đơn thuốc (bộ nối giả cùng giao diện bộ nối thật, mã OTP hiện trên màn/log demo). 

**"Thiết bị tin cậy"** (mô phỏng-có-nhãn ở M0): sau MFA thành công, đặt cookie `trusted-device` để bỏ qua bước MFA lần sau trên đúng máy đó. Thuộc tính cookie (sửa theo review NIT-1): **HttpOnly, Secure, SameSite=Strict, `Path=/api/session`**, hạn 30 ngày, giá trị là token ký (bằng `REFRESH_SECRET`) mang `sub` + một `deviceId` ngẫu nhiên (**không** gắn `sid` để sống qua nhiều phiên). Tương tác vòng đời: **đăng xuất (`logout`) KHÔNG xóa** cookie trusted-device (máy vẫn được tin ở lần đăng nhập sau); nhưng **`DELETE /api/sessions/:sid` (thu hồi bởi quản trị) và đổi/đặt lại mật khẩu thì VÔ HIỆU HÓA mọi ràng buộc trusted-device của người đó** (lần sau buộc MFA lại), bằng cách tăng một `trustedDeviceEpoch` trên hồ sơ nhân viên để mọi cookie cũ hết giá trị.

**Rõ ràng về phạm vi M0:** TOTP là MFA **thật, bắt buộc** cho `owner`/`doctor` (§4.1(3)); OTP-SĐT và thiết-bị-tin-cậy là **mô phỏng-có-nhãn** ở M0, làm thật ở M1 (row 12). Không có phần nào "để ngỏ".

### 4.4 Refresh và thu hồi

- `POST /api/session/refresh` (dùng cookie refresh): kiểm băm refresh trong bảng phiên; hợp lệ và chưa dùng → cấp cặp mới, xoay refresh, cập nhật bảng. Refresh đã dùng lại (replay) → **thu hồi cả `sid`** và trả `401` (phát hiện trộm token).
- `POST /api/session/logout`: xóa `sid` khỏi bảng phiên, xóa cookie refresh. Quản trị thu hồi phiên người khác: `DELETE /api/sessions/:sid` (chỉ `owner`), ghi audit.
- Access token hết hạn khi offline: web **không** tự đăng xuất ngay; xem §6 (hàng đợi sống sót, nhắc đăng nhập lại khi online để tiếp tục đồng bộ — khớp hành vi `expired` hiện có ở `Login.tsx`/OFF-6).

### 4.5 Fail-closed cho chính route đăng nhập — đường audit tiền-phiên (sửa theo review HIGH-2)

**Vấn đề của bản trước:** `record()` hiện đọc `req.session!` (non-null assertion) để lấy `tenant`/`userId`/`role`, và `AuditEntry.tenant` + `AuditEntry.userId` là `string` **bắt buộc**. Khi mật khẩu *sai*, **chưa có phiên** — không `userId`, không `tenant` đã xác thực — nên gọi `record()` hiện tại sẽ **ném vì `req.session` undefined**, và cũng không có giá trị hợp lệ để điền hai trường bắt buộc. Phải định nghĩa rõ đường audit cho login khi chưa có phiên.

**Thiết kế đường audit tiền-phiên:**

1. Thêm một hàm ghi audit **riêng cho login, KHÔNG dùng `req.session!`**: `recordLogin(req, outcome, fields)` với `fields?: { userId?: string; tenant?: string; role?: Role }`. Nó dựng `AuditEntry` trực tiếp từ `fields` + `req.id`, không chạm `req.session`.
2. **Cho phép thiếu danh tính ở entry login/denied:** đổi `AuditEntry` để `userId` và `tenant` **optional** (hoặc giữ bắt buộc nhưng điền sentinel cố định `userId: 'anonymous'`, `tenant: 'unknown'`). Chọn **optional** (sạch hơn, không trộn sentinel vào dữ liệu thật) và `recent()` lọc theo `tenant` chỉ trả entry có `tenant` khớp — entry `tenant` undefined không lọt vào màn audit theo-tenant của phòng khám nào. Ghi rõ: thay đổi này **chỉ** áp cho `action:'login'`; mọi action dữ liệu khác vẫn yêu cầu `tenant`/`userId` qua đường `record()` cũ (có `req.session!`).
3. **Trường theo kết quả:**
   - `login`/`ok`: `userId` + `tenant` + `role` (sau khi đã xác thực xong và đã chọn tenant), `outcome:'ok'`.
   - `login`/`denied` (mật khẩu/MFA sai, tài khoản khóa): **không** `userId`, **không** `tenant`, **không** `loginId` — chỉ `outcome:'denied'` + `requestId` + `ts`. (Không PII, không giúp dò tài khoản tồn tại hay không qua log.)
4. **Fail-closed vẫn giữ trên nhánh từ chối:** `await recordLogin(req,'denied')` **trước** khi trả `401`. Audit sink ném ⇒ route ném ⇒ 500, **không trả `401` cũng không cấp token** — tức là không có phản hồi nào rời BFF trước khi audit được ghi, kể cả phản hồi từ chối.

**Test (vào bảng B3):** (a) sink ném khi ghi `login/denied` ⇒ `POST /api/session` mật khẩu sai trả **500**, không trả `401`; (b) entry `login/denied` **không** chứa `loginId`/mật khẩu/OTP/SĐT/tên (kiểm nội dung audit + `logStream`); (c) entry `login/ok` có `userId`+`tenant` đúng. **Mutation chứng minh đỏ:** bỏ `await` trước `recordLogin` trên nhánh denied (hoặc thêm `loginId` vào entry) ⇒ (a)/(b) đỏ.

### 4.6 Rate-limit đăng nhập (thay vai trò F5 của Medplum)

Lớp Identity tự giới hạn: đếm thất bại theo `loginId` + theo IP (token bucket), khóa mềm tăng dần. Vì B không qua Medplum nên **không dính bộ đếm 5 lần/phút/IP dùng chung sau NAT**. (Nếu A: phải chủ động tránh vượt bộ đếm Medplum — §3.3.)

---

## 5. Tách chế độ demo khỏi đường thật (KHÔNG để lẫn)

Yêu cầu: bỏ `DEMO_AUTH=1` khỏi đường chạy thật, nhưng vẫn giữ **một chế độ demo riêng, có nhãn, cho diễn tập**.

### 5.1 Cơ chế tách — chốt khởi động fail-closed-mặc-định (sửa theo review HIGH-1, MEDIUM-5)

**Vấn đề của bản trước:** nếu lấy `DEMO_AUTH=0` (mặc định hiện tại) làm "đường thật được bind ra mạng", thì một triển khai *quên đặt biến môi trường* sẽ rơi thẳng vào nhánh thật-bind-mạng — **yếu hơn** chốt hiện nay (hiện nay thiếu `DEMO_AUTH=1` ⇒ `process.exit(1)`, không bao giờ mở ra mạng). Phải giữ tính chất "không có cấu hình hợp lệ ⇒ không phục vụ gì ra mạng".

**Chọn một biến chế độ *không có mặc định mạng*:** thêm biến mới **`AUTH_MODE`** với giá trị `'real' | 'demo'` và **KHÔNG có default**. `config.ts` bắt buộc `AUTH_MODE` phải được đặt rõ; **thiếu hoặc giá trị lạ ⇒ `loadConfig` ném ⇒ `server.ts` thoát trước khi `listen`.** Không mode nào được chọn ngầm. (Giữ `DEMO_AUTH` lại cũng được, nhưng *không* để giá trị mặc định của nó quyết định có bind ra mạng — `AUTH_MODE` mới là cổng. Khuyến nghị: bỏ hẳn `DEMO_AUTH`, chỉ dùng `AUTH_MODE`, để không còn hai biến chồng nghĩa.)

- **`AUTH_MODE=real`:** BFF **bắt buộc** có đủ cấu hình Identity hợp lệ (xem §5.1.1), **được phép bind host không phải localhost**, `POST /api/session` **chỉ** chấp nhận mật khẩu+MFA. Route `GET /api/session/demo-users` và luồng login-không-mật-khẩu **không được đăng ký**.
- **`AUTH_MODE=demo`:** giữ chốt localhost hiện có (`server.ts` exit nếu host ≠ localhost); đăng ký `demo-users` + login-không-mật-khẩu như hiện nay; **cảnh báo khởi động** + **nhãn trên màn** (DemoBanner/Scope) bật.
- **`AUTH_MODE` thiếu / không nhận ra ⇒ thoát** (`process.exit(1)` với thông điệp rõ), **không bao giờ bind ra mạng.** Đây là chốt fail-closed-mặc-định cần nêu thành bất biến: *"một môi trường không khai mode, hoặc khai sai, thì thoát; không có đường nào mở ra mạng."*
- **Hai nhánh loại trừ nhau tại `buildApp`:** cờ `deps.mode: 'real' | 'demo'` quyết định bộ route nào được `register`; không đăng ký cả hai cùng lúc. Không có đường nào để request ở chế độ real chạm handler demo và ngược lại. Có **test khẳng định** (B6): ở `mode:'real'`, `GET /api/session/demo-users` → **404** và `POST /api/session` kiểu không-mật-khẩu → **401/404**, không rò danh sách user.

### 5.1.1 Hợp đồng cấu hình (config contract) — bổ sung cho `config.ts` (sửa theo MEDIUM-5)

`config.ts` hiện chỉ kiểm `SESSION_SECRET` (≥32) và `DEMO_AUTH`. Bổ sung các khóa sau vào `schema` (zod) và `loadConfig` **bắt buộc hiện diện-và-hợp-lệ khi `AUTH_MODE=real`** (ở `demo` thì không bắt buộc):

| Env | Kiểu / ràng buộc zod | Bắt buộc ở `real`? | Dùng để |
|---|---|---|---|
| `AUTH_MODE` | `z.enum(['real','demo'])`, **không default** | luôn | chọn chế độ; thiếu ⇒ ném |
| `SESSION_SECRET` | `z.string().min(32)` | **có** (ở `real` **không** cho sinh ngẫu nhiên — xem dưới) | ký access token HS256 |
| `REFRESH_SECRET` | `z.string().min(32)` | **có** | ký/HMAC refresh & `mfaToken`/pre-tenant token (khác khóa access) |
| `TOTP_ENC_KEY` | `z.string().min(32)` (hoặc base64 32 byte) | **có** | mã hóa bí mật TOTP khi lưu (§4.2) |
| `SESSION_STORE_URL` | `z.string()` (đường dẫn file ở M0, hoặc `redis://…`) | **có** | kho phiên/refresh có thu hồi (§3.2, MEDIUM-2) |
| `OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_CLIENT_ID` | `z.string()`/`z.url()` | **chỉ bắt buộc ở M1** (khi tách IdP) | RP OIDC khi IdP đã tách khỏi BFF |

Quy ước thực thi (một chỗ duy nhất, `loadConfig`): 
- Ở `AUTH_MODE=real`, nếu bất kỳ khóa bắt buộc nào thiếu hoặc không đạt ràng buộc độ dài ⇒ **`loadConfig` ném `Error` có thông điệp nêu tên khóa**; `server.ts` để lỗi này nổi lên trước `app.listen`, in ra rồi `process.exit(1)`.
- Ở `real`, **cấm sinh `SESSION_SECRET`/`REFRESH_SECRET` ngẫu nhiên** (khác hành vi demo hiện nay): phiên không được "mất khi khởi động lại" trên đường thật, và khóa phải ổn định để thu hồi/refresh có nghĩa. Thiếu ⇒ ném.
- Ở `demo`, giữ nguyên hành vi hiện có (được sinh `SESSION_SECRET` ngẫu nhiên, chỉ cảnh báo).

**Test (vào bảng B6):** (a) `loadConfig({AUTH_MODE:'real'})` thiếu `TOTP_ENC_KEY`/`REFRESH_SECRET`/`SESSION_STORE_URL`/`SESSION_SECRET` ⇒ **ném**, thông điệp nêu đúng tên khóa; (b) `AUTH_MODE` không đặt ⇒ ném; (c) ở `real`, `SESSION_SECRET` không đặt ⇒ ném (không im lặng sinh ngẫu nhiên). **Mutation chứng minh đỏ:** cho một khóa bắt buộc có default, hoặc nới nhánh "thiếu mode ⇒ chọn `demo`/bind mạng" ⇒ các test trên chuyển xanh-sai ⇒ phải đỏ khi khôi phục chốt.

### 5.2 Diễn tập dùng chế độ demo

`infra/trial.mjs` và các lệnh `trial:*` tiếp tục chạy ở `DEMO_AUTH=1` trên localhost — không đổi, vì đó là đường demo có nhãn. Đường thật dùng cho pilot/M1.

### 5.3 Trang "Phạm vi" phản ánh

- `Scope.tsx`: **gỡ** dòng *"Đăng nhập: chọn người dùng demo, chưa có mật khẩu (T-IDP)"* khỏi nhóm `SIMULATED`; **thêm** vào nhóm `REAL`: *"Đăng nhập nhân viên bằng mật khẩu và MFA (TOTP); vòng đời phiên có cấp/gia hạn/thu hồi; tenant lấy từ phiên đã ký"*. Nếu OTP SĐT/thiết bị tin cậy còn mô phỏng ở M0 thì **thêm một dòng SIMULATED có nhãn** cho riêng phần đó (trung thực: TOTP thật, OTP-SĐT mô phỏng).
- `DemoBanner.tsx`: chỉ hiện ở `mode:'demo'`. Ở đường thật, **không** hiện "Chưa có xác thực thật".

---

## 6. Ảnh hưởng tới kho cục bộ mã hóa (offline)

Đây là câu hỏi mở của bài học M0-S2 dòng 5: *khóa AES-GCM dẫn xuất từ đâu khi đã có auth thật, xóa khi đăng xuất, dùng chung máy nhiều người.*

Hiện trạng (`local/store.ts`, `crypto.ts`): mỗi `(tenant, userId)` một CSDL Dexie riêng; khóa AES-GCM-256 **sinh ngẫu nhiên tại máy** (`newKey`, `extractable:false`) và **lưu trong IndexedDB cùng máy**. Khóa **không** dẫn xuất từ danh tính người dùng — nó chỉ nằm cùng máy với dữ liệu (đúng như ghi chú giới hạn trong `crypto.ts`).

Quyết định cho T-IDP (giữ phạm vi M0, không mở rộng quá mức):

1. **M0 giữ nguyên mô hình khóa-tại-máy per `(tenant,userId)`.** Lý do (sửa theo review NIT-3): **không dùng khóa kho *mở bằng mật khẩu* ở M0 (bất kể KDF — PBKDF2, Argon2, scrypt đều không phải vấn đề)** — vấn đề là *bất kỳ* cơ chế mở kho cần nhập lại mật khẩu khi offline: nhân viên sẽ phải nhập mật khẩu để mở kho *trong khi mất mạng và access token đã hết hạn*, mà xác minh mật khẩu/MFA/refresh lại cần mạng. Điều này mâu thuẫn trực tiếp với mục tiêu "mất mạng vẫn khám/ký/in". Vì vậy khóa kho **không gắn với mật khẩu** ở M0.
2. **Gắn vòng đời khóa với vòng đời phiên một cách an toàn:**
   - **Đăng xuất chủ động khi không còn mục chờ:** gọi `store.destroy()` (đã có) để **xóa khóa + dữ liệu** của `(tenant,userId)` trên máy. Hiện `OfflineProvider` đã tạo store theo `(tenant,userId)`; T-IDP nối nút "đăng xuất" với `destroy()` khi `pendingCount()===0`.
   - **Đăng xuất khi còn mục chờ:** **không xóa** (sẽ mất dữ liệu bệnh nhân chưa đồng bộ, vi phạm N1/OFF-6). Giữ kho, hiện thông điệp "máy này còn N mục chưa đồng bộ của …" (đã có ở `Login.tsx`), và chỉ `close()` chứ không `destroy()`. Người đó đăng nhập lại trên máy này thì đồng bộ tiếp bằng phiên mới.
   - **Phiên hết hạn (401) khi còn mục chờ:** y như trên — kho sống sót, hàng đợi đồng bộ tồn tại qua cả lúc refresh token hết hạn (bài học dòng 6). Khi online lại và đăng nhập lại, `SyncEngine` gửi tiếp bằng token mới (`OfflineProvider` lấy token từ `authRef`).
3. **Dùng chung máy nhiều người:** vì CSDL tách theo `(tenant,userId)`, hai nhân viên trên cùng máy có hai kho + hai khóa khác nhau; ai đăng nhập thì `OfflineProvider` mở đúng kho của người đó. **Rủi ro còn lại (ghi rõ ở Scope/README):** khóa vẫn nằm cùng máy, nên *người có quyền vào máy và vào hồ sơ trình duyệt của nhân viên khác* về lý thuyết đọc được kho của người đó — M0 **không** chống mối đe dọa này (đúng như giới hạn đã nêu trong `crypto.ts` và `Scope.tsx` MISSING "mã PIN cho kho trên máy"). T-IDP **không** làm xấu đi điều này; mã PIN kho vẫn là việc sau (giữ nguyên dòng MISSING).
4. **Quyền khi đồng bộ — danh tính ký ĐƯỢC CHỐT LÚC TẠO MỤC (sửa theo review MEDIUM-3):** yêu cầu đồng bộ phải mang **đúng danh tính người ký lúc tạo mục** (`participant.individual.identifier`, so với `cmd.doctor.userId` ở `medplum.ts`), **không** phải danh tính của phiên đang đăng nhập lúc gửi đi.

   Hiện trạng mã (`local/sync.ts`): mỗi kho gắn một `owner = {tenant, userId}`; `SyncEngine` chỉ gửi khi phiên hiện tại khớp `owner` (dừng với `paused:'owner'` nếu không), và danh tính người ký nằm trong **payload của mục** (`body.payload`, chứa `doctor.userId`) được dựng lúc enqueue. Thiết kế **giữ và nêu rõ bất biến này:**
   - **Danh tính ký được ghi vào payload của mục ngay lúc tạo (offline, dưới phiên đang xác thực lúc đó)** và **gửi nguyên văn lúc đồng bộ** — không bao giờ thay bằng danh tính của phiên sống lúc sync. Trên máy dùng chung, nếu A tạo mục rồi B đăng nhập, mục của A **vẫn mang A** làm participant.
   - Vì mỗi kho tách theo `(tenant,userId)` và engine dừng khi phiên ≠ owner, B đăng nhập **không rút** hàng đợi của A (engine `paused:'owner'`); A đăng nhập lại trên máy đó mới gửi tiếp — danh tính vẫn là A. 
   - **Di trú demo→thật:** `userId` thời demo khác `userId` auth thật. Mục tạo *trước* mốc cắt (pre-cutover) mang `userId` demo sẽ **không khớp** nhân viên thật ở `completeVisit`. Hành vi đã chọn: **từ chối (reject) + đánh dấu cần xử lý (N3), không best-effort ghi dưới danh tính khác.** Vì mốc cắt T-IDP đi kèm xóa dữ liệu demo khỏi đường thật (đường thật là Project/tenant khác, §5), rủi ro thực tế thấp; vẫn ghi rõ là từ chối để không âm thầm gán sai người ký.

   **Phải có test (B7):** (a) mục do A mở, **đồng bộ trong lúc B đang đăng nhập trên cùng máy**, vẫn ghi A là participant và B không hoàn tất được lượt của A (so `participant.individual.identifier`); (b) mục mang `userId` không khớp nhân viên thật (giả lập pre-cutover) → bị `completeVisit` từ chối, mục ở trạng thái cần xử lý, không ghi dưới danh tính phiên sống.

---

## 7. Bất biến và cách TÁI CHỨNG MINH bằng test (mutation testing)

Nguyên tắc văn hóa test của dự án: mỗi chốt chặn phải có **test được xác nhận ĐỎ khi gỡ chốt**. Dưới đây là từng chốt, test nào, package nào, và cách chứng minh đỏ.

| # | Chốt chặn | Test (package) | Mutation chứng minh đỏ |
|---|---|---|---|
| B1 | **Thiếu phiên hợp lệ → chặn.** Request không token / token sai / hết hạn / sai `typ` (mfa/pretenant) / `sid` đã thu hồi bị `401` trên **mọi** route `requireSession`, không chạm Medplum, không trả dữ liệu. | `services/bff` **unit** (gọi route với/không Authorization qua `buildApp` + `MemoryAuditSink`); gồm case `sid` thu hồi và case token sai `typ`. | Gỡ `requireSession` (hoặc bỏ bước kiểm `sid`/hết hạn/`typ` trong `requireSession`/`SessionService.verify`) ⇒ request không hợp lệ trả 200/dữ liệu ⇒ test đỏ. |
| B0 | **Web giữ 0 import `@medplum/*`** (bất biến #3). | **unit/lint**: một bài grep/kiểm tĩnh khẳng định không file nào trong `apps/clinic-web/src` import `@medplum/…`. | Thêm một import `@medplum/core` vào một file web ⇒ bài kiểm đỏ. |
| B2 | **Tenant chỉ từ JWT đã ký, request không ép được tenant.** Thêm `tenant` giả vào body/query/header **không** đổi tenant hiệu lực. | `services/bff` **unit**: đăng nhập tenant X, gọi `/api/patients/search?...&tenant=Y` (và body `{tenant:Y}`) ⇒ vẫn chỉ thấy dữ liệu X; token ký cho X nhưng gửi header `x-tenant: Y` ⇒ bỏ qua. **Integration** (`test:integration`, cần stack): hai tenant thật, token X không đọc được bệnh nhân Y (404), kể cả khi nhồi tenant Y vào request. | Thêm (giả định) một nhánh đọc tenant từ `req.query.tenant ?? req.session.tenant` ⇒ test đỏ ngay. Khẳng định `store(req)` chỉ dùng `req.session!.tenant`. |
| B2b | **Pre-tenant token KHÔNG mở route dữ liệu; `select-tenant` chỉ chọn trong `allow` đã ký** (MEDIUM-1). | `services/bff` **unit**: pre-tenant token gọi `/api/patients/search` → 401; `select-tenant` với tenant ∉ `allow` → 403, kể cả khi nhồi thêm tenant vào body/query. | Cho `verify` chấp nhận `typ:'pretenant'` như access ⇒ test (a) đỏ; đọc `allow` từ body thay vì token đã ký ⇒ test (b) đỏ. |
| B3 | **Audit fail-closed trước khi trả dữ liệu; không PII — gồm cả nhánh login/denied tiền-phiên** (HIGH-2). Audit sink ném ⇒ route 500 (kể cả route đăng nhập trả 401), **không** có thân dữ liệu; log/audit không chứa mật khẩu/OTP/loginId/SĐT/tên/query. | `services/bff` **unit**: (1) `AuditSink` giả **ném** ở `record` ⇒ `GET /api/patients/search` trả 500, body **không** chứa `results`; (2) sink ném khi ghi `login/denied` ⇒ `POST /api/session` mật khẩu sai trả **500**, không trả 401; (3) "không PII": bắt `logStream` + nội dung audit, khẳng định entry `login/denied` không có `loginId`/mật khẩu/OTP. | Chuyển `await record(...)`/`await recordLogin(...)` thành không-await / nuốt lỗi ⇒ route trả 200/401 dù audit lỗi ⇒ (1)/(2) đỏ. Thêm `loginId` vào audit entry ⇒ (3) đỏ. |
| B4 | **TOTP bắt buộc cho `owner`/`doctor`, có forced-enrollment gate; `mfaToken` không mở route dữ liệu** (MEDIUM-4). | `services/bff` **unit**: (1) login `owner` đã bật TOTP → `mfaRequired`; dùng `mfaToken` gọi `/api/patients/search` ⇒ 401; chỉ sau `/api/session/mfa` đúng code mới có access. (2) login `owner` **chưa** đăng ký TOTP → `enrollMfa`; `mfaToken` enroll **không** mở route dữ liệu cho tới khi đăng ký + xác minh xong. | Cho `mfaToken`/`enroll` token được `verify` như access ⇒ (1)/(2) đỏ. Bỏ bắt buộc enroll cho `owner`/`doctor` (cấp access ngay khi chưa có TOTP) ⇒ (2) đỏ. |
| B5 | **Token thu hồi/hết hạn thật sự chặn trên MỌI route; refresh một-lần, replay song song chỉ một thành công** (HIGH-3, MEDIUM-2). Sau `logout`/`DELETE sessions/:sid`, access cùng `sid` bị từ chối **ở cả route đọc lẫn ghi/ký** ngay lập tức; hết hạn access → 401; refresh dùng lại → thu hồi `sid`. | `services/bff` **unit** (thời gian ảo — **không `sleep`**): (1) thu hồi `sid` ⇒ route **đọc** `/api/patients/:id` trả 401 (không chỉ route ghi); (2) hết hạn access → 401; (3) refresh xoay 1 lần, dùng lại refresh cũ → 401 + `sid` bị thu hồi; (4) **hai refresh song song cùng token** ⇒ đúng **một** thành công, `sid` bị thu hồi (kiểm consume nguyên tử). | Bỏ kiểm `sid` trên route đọc ⇒ (1) đỏ. Không xoay refresh / consume không nguyên tử (hai bên cùng qua) ⇒ (3)/(4) đỏ. |
| B6 | **Chế độ real không có cửa demo; hợp đồng cấu hình fail-closed** (HIGH-1, MEDIUM-5). Ở `mode:'real'`, route demo không tồn tại; `AUTH_MODE` thiếu/sai ⇒ không khởi động; thiếu khóa Identity bắt buộc ⇒ không khởi động. | `services/bff` **unit**: (1) build app `mode:'real'` ⇒ `demo-users` 404, login-không-mật-khẩu 401/404. (2) `loadConfig({AUTH_MODE:'real'})` thiếu `TOTP_ENC_KEY`/`REFRESH_SECRET`/`SESSION_STORE_URL`/`SESSION_SECRET` ⇒ **ném**, thông điệp nêu đúng tên khóa. (3) `AUTH_MODE` không đặt ⇒ ném. (4) ở `real`, `SESSION_SECRET` trống ⇒ ném (không im lặng sinh ngẫu nhiên). | Đăng ký route demo bất kể mode ⇒ (1) đỏ. Cho một khóa bắt buộc có default / cho `AUTH_MODE` thiếu rơi về `demo`-bind-mạng ⇒ (2)/(3)/(4) đỏ. |
| B7 | **Quyền đồng bộ theo danh tính ký, chốt lúc tạo mục** (MEDIUM-3). Người B không hoàn tất lượt do A mở; danh tính ký lấy từ payload mục, không từ phiên sống. | `services/bff` **integration** (đã có mẫu so `participant.individual.identifier` ở `completeVisit`): (1) mục của A đồng bộ khi B đang đăng nhập vẫn ghi A; (2) mục mang `userId` không khớp nhân viên thật (giả lập pre-cutover) → bị từ chối, không ghi dưới danh tính phiên sống. | Bỏ so participant / lấy danh tính từ phiên sống thay vì payload ⇒ (1)/(2) đỏ. |

Ghi chú chạy test (bẫy đã biết):
- **F5:** `test:integration` đăng nhập quản trị Medplum một lần/khâu dựng dữ liệu; chạy bộ **ba lần liền tay** dễ gặp `429` ở khâu dựng — **không phải lỗi mã**, chờ ~1 phút. Thêm file test mới thì tính lại số lần đăng nhập.
- **Thời gian ảo bắt buộc** cho mọi test hết hạn/refresh (B5): tiêm `now()` (như `deps.now` đã có), **không `sleep`**; reset trạng thái phiên trong `beforeEach`.
- **e2e** (`visit.mjs`): nếu T-IDP chạm luồng giao diện đăng nhập, cập nhật bước đăng nhập của e2e sang mật khẩu+MFA cho đường thật, **giữ** đường demo cho e2e hiện có (demo chạy localhost). **TOTP xác định cho e2e (sửa theo review NIT-2):** seed một tài khoản nhân viên thử với **bí mật TOTP đã biết trước**; bài e2e **tự tính mã TOTP trong test từ bí mật đó** (dùng cùng thuật toán RFC 6238 + đồng hồ test, **không `sleep`** chờ cửa sổ mới), và **reset tài khoản/kho phiên mỗi lần chạy** để không mang trạng thái cũ. Không `page.waitForFunction` với hàm async; dùng `eventually(() => page.evaluate(...))`.

---

## 8. Kế hoạch kiểm thử tổng thể

- **Unit (`pnpm test`, không cần Medplum):** B0–B6 trên `buildApp` + `MemoryAuditSink` + `now()` ảo; TOTP (vector chuẩn RFC 6238); băm mật khẩu (Argon2id round-trip + từ chối mật khẩu rỗng); **xoay refresh một-lần + replay song song** (B5 case 4: hai `consume` song song chỉ một thành công — kiểm nguyên tử của kho phiên M0); pre-tenant token + chọn tenant trong `allow` đã ký (B2b mức unit); hợp đồng cấu hình `loadConfig` ở `AUTH_MODE=real` (B6).
- **Integration (`pnpm --filter @phongmach/bff test:integration`, cần stack):** B2 (cách ly hai tenant thật), B7 (participant), và luồng login→MFA→refresh→gọi route dữ liệu đầu-cuối ở BFF với Medplum thật. Lưu ý F5.
- **e2e (`pnpm e2e`, nếu chạm giao diện):** đăng nhập thật (nhập mật khẩu + TOTP) rồi làm một lượt khám; kiểm **trang "Phạm vi"** hiển thị đăng nhập ở nhóm "thật"; kiểm chế độ demo vẫn chạy riêng.
- **Lệnh báo cáo khi IMPLEMENT (không chạy trong vòng thiết kế này):** `pnpm typecheck && pnpm test`, rồi `pnpm --filter @phongmach/bff test:integration`, và `pnpm e2e` nếu chạm giao diện — báo kết quả từng lệnh.

---

## 9. Checklist cập nhật (khi IMPLEMENT — KHÔNG sửa trong vòng này)

- [ ] `services/bff/src/session.ts`: hai token (access `typ:'access'` ~15′ + refresh opaque một-lần), `sid`, `mfaToken`/pre-tenant token (`typ:'mfa'`/`'pretenant'`, khóa `REFRESH_SECRET`); `verify` kiểm hết hạn + `typ` + **thu hồi `sid`**; `requireSession` tra `sid` trên **mọi** route.
- [ ] `services/bff/src/` **kho phiên** mới (SQLite ở M0 qua `SESSION_STORE_URL`, Redis ở M1): consume refresh **nguyên tử** (UNIQUE + UPDATE-đếm-dòng), thu hồi `sid`; tuần tự hóa theo `sid` nếu dùng kho trong tiến trình.
- [ ] `services/bff/src/` **module `identity`** mới: hồ sơ nhân viên, Argon2id, TOTP (bí mật mã hóa bằng `TOTP_ENC_KEY`), forced-enrollment gate cho `owner`/`doctor`, rate-limit nội bộ, (mô phỏng-có-nhãn) bộ nối OTP-SĐT + trusted-device; ranh giới claim OIDC-ready.
- [ ] `services/bff/src/audit.ts`: `userId`/`tenant` thành optional cho `action:'login'`; thêm `recordLogin()` không dùng `req.session!`.
- [ ] `services/bff/src/app.ts`: route `POST /api/session` (mật khẩu), `/api/session/mfa`, `/api/session/select-tenant` (pre-tenant token), `/api/session/refresh`, `/api/session/logout`, `DELETE /api/sessions/:sid`; `recordLogin` fail-closed trên nhánh denied; đăng ký route theo `mode:'real'|'demo'`.
- [ ] `services/bff/src/config.ts` + `server.ts`: thêm `AUTH_MODE` (không default) + hợp đồng cấu hình §5.1.1 (`REFRESH_SECRET`, `TOTP_ENC_KEY`, `SESSION_STORE_URL` bắt buộc ở `real`; cấm sinh secret ngẫu nhiên ở `real`); thiếu/sai ⇒ `loadConfig` ném ⇒ exit trước `listen`; `real` bind ngoài localhost, `demo` giữ chốt localhost; cảnh báo khởi động.
- [ ] `apps/clinic-web/src/components/Login.tsx`: form mật khẩu + bước MFA; giữ thông điệp `expired`/`device-pending` (OFF-6); chế độ demo vẫn hiện danh sách user.
- [ ] `apps/clinic-web/src/api.ts`: thêm `login(loginId,password)`, `mfa`, `refresh`, `logout`, `selectTenant`; cookie refresh (fetch `credentials:'include'`); giữ "chỉ `/api`, chỉ import *type*", **0 import `@medplum/*`**.
- [ ] `apps/clinic-web/src/local/*` + `OfflineProvider.tsx`: nối "đăng xuất khi hết mục chờ" → `destroy()`; giữ kho khi còn mục chờ.
- [ ] **`apps/clinic-web/src/components/Scope.tsx`**: chuyển đăng nhập từ `SIMULATED` → `REAL`; nếu OTP-SĐT còn mô phỏng, thêm dòng `SIMULATED` riêng cho phần đó.
- [ ] **`apps/clinic-web/src/components/DemoBanner.tsx`**: chỉ hiện ở `mode:'demo'`; bỏ "Chưa có xác thực thật" khỏi đường thật.
- [ ] **`README.md`** mục "Giới hạn": cập nhật trạng thái xác thực (thật) và phần còn mô phỏng (nếu có).
- [ ] **`docs/ke-hoach-trien-khai.md`** mục **5.2 / 5.7 / 5.9**: cập nhật trạng thái T-IDP, mô hình token/offline-key, bỏ ghi chú "chỉ chạy khi DEMO_AUTH=1" ở đường thật (đóng A8/F2 theo quyết định A/B).
- [ ] **`apps/clinic-web/e2e/visit.mjs`**: cập nhật bước đăng nhập và bước kiểm trang "Phạm vi".

---

## 10. Câu hỏi / giả định cần chủ dự án CHỐT (dừng ở đây)

1. **A hay B?** Đề xuất **B** (IdP riêng UNIGIS; M0 là IdP tối giản nhúng trong BFF theo ranh giới OIDC). **Nếu chọn A**, cần chủ dự án **chấp nhận egress HIBP qua proxy** (F2/T-EGR) như điều kiện tuân thủ và chấp nhận rủi ro F5 sau NAT. *Cần quyết định này trước khi code.*
2. **Phạm vi MFA ở M0 (xác nhận-hoặc-ghi-đè, không bỏ ngỏ):** quyết định của thiết kế là **TOTP bắt buộc cho `owner`/`doctor`, có forced-enrollment gate** (§4.1(3)); **OTP-SĐT + thiết bị tin cậy là mô phỏng-có-nhãn ở M0** (§4.3), làm thật ở M1. Cần chủ dự án **xác nhận** quy tắc này, hoặc ghi đè (ví dụ bắt buộc TOTP cả `assistant`).
3. **Tuổi token:** access ~15 phút + refresh ~ (đề xuất 7–14 ngày, xoay mỗi lần dùng). Chốt con số theo yêu cầu bảo mật/UX của pilot.
4. **Khóa kho offline M0:** đề xuất **giữ khóa-tại-máy per `(tenant,userId)`** (không dẫn xuất từ mật khẩu để không phá offline); mã PIN kho vẫn là việc sau. Xác nhận chấp nhận giới hạn "khóa cùng máy" cho M0.
5. **Lưu trữ bảng phiên/refresh ở M0:** đề xuất **SQLite cạnh BFF** (có consume refresh nguyên tử bằng UNIQUE + UPDATE-đếm-dòng, §3.2) qua `SESSION_STORE_URL`; M1 chuyển Redis. **Không** dùng file JSON ghi ngây thơ (dính lớp lỗi không-nguyên-tử F11). Xác nhận hạ tầng cho pilot.
6. **Nguồn hồ sơ nhân viên:** ai tạo nhân viên và gán vai trò/tenant (quy trình quản trị)? Ảnh hưởng `select-tenant` cho nhân viên nhiều phòng khám.

---

## 11. Phản hồi các phát hiện của review (vòng 1 → vòng 2)

Bản này giải quyết toàn bộ phát hiện trong `design-review.json` (verdict CHANGES_REQUESTED). Tóm tắt cách xử lý từng mục:

- **HIGH-1 (đảo `DEMO_AUTH` làm yếu chốt mặc định):** *Đã sửa* — §5.1 thay bằng biến `AUTH_MODE` **không có default**; mode thiếu/sai ⇒ thoát, không bao giờ bind ra mạng. Nêu thành bất biến + case B6.
- **HIGH-2 (audit login/denied dùng `req.session!`, trường bắt buộc):** *Đã sửa* — §4.5 định nghĩa đường `recordLogin()` tiền-phiên, cho `userId`/`tenant` optional ở `action:'login'`, nêu rõ trường theo ok/denied và giữ `await`-trước-khi-trả trên nhánh từ chối; case B3(2).
- **HIGH-3 (thu hồi chỉ kiểm ở route ghi):** *Đã sửa* — §3.2 chuyển sang **kiểm `sid` trên mọi route `requireSession`** (gồm route đọc), bỏ cửa sổ 15 phút; B5(1) tách riêng route đọc.
- **MEDIUM-1 (token giữa MFA và chọn tenant):** *Đã sửa* — §4.1 thêm **pre-tenant token** (`typ:'pretenant'` + `allow` đã ký, không mở route dữ liệu); case B2b.
- **MEDIUM-2 (kho refresh M0 không nguyên tử):** *Đã sửa* — §3.2 chốt **SQLite + consume nguyên tử** (hoặc Redis GETDEL / tuần tự theo `sid`); case B5(4) replay song song. §10(5) cập nhật.
- **MEDIUM-3 (danh tính ký lúc sync):** *Đã sửa* — §6(4) chốt **danh tính ký ghi vào payload lúc tạo mục**, gửi nguyên văn; nêu di trú demo→thật là **từ chối**; case B7(1)/(2).
- **MEDIUM-4 (MFA vừa bắt buộc vừa để ngỏ):** *Đã sửa* — §4.1(3) chốt **TOTP bắt buộc cho `owner`/`doctor` + forced-enrollment gate**; §4.3 chốt OTP-SĐT/trusted-device là mô phỏng-có-nhãn; §10(2) chỉ còn là điểm xác nhận; case B4(1)/(2).
- **MEDIUM-5 (hợp đồng cấu hình thiếu):** *Đã sửa* — §5.1.1 thêm bảng khóa env + ràng buộc zod + nơi `loadConfig` enforce; case B6(2)/(3)/(4).
- **NIT-1 (cookie trusted-device):** *Đã sửa* — §4.3 nêu thuộc tính cookie + tương tác logout/`DELETE sessions/:sid`/đổi mật khẩu.
- **NIT-2 (TOTP xác định cho e2e):** *Đã sửa* — §7/§8 ghi chú seed tài khoản TOTP đã biết, tính mã trong test, reset mỗi lần chạy.
- **NIT-3 (câu chữ PBKDF2/Argon2):** *Đã sửa* — §6(1) đổi lại: vấn đề là *bất kỳ* cơ chế mở kho bằng mật khẩu khi offline, không phải KDF cụ thể.

Ngoài ra bổ sung **B0** (grep/lint khẳng định web 0 import `@medplum/*`) theo khuyến nghị phần "Invariant re-proof" của review.

---

*Hết thiết kế. Đề xuất **Phương án B** (IdP riêng UNIGIS; M0 là IdP tối giản nhúng trong BFF theo ranh giới OIDC). Vẫn **chờ chủ dự án chốt A/B** (và chấp nhận egress HIBP qua proxy nếu chọn A) trước khi code — dừng ở bước thiết kế theo yêu cầu.*
