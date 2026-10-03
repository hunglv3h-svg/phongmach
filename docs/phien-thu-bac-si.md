# Phiên thử với 3 bác sĩ: đo tiêu chí M0-1

Cập nhật 03/10/2026. Trạng thái M0-1: **đã sẵn sàng đo, chưa đo.**

Tiêu chí M0-1 (kế hoạch, mục 5.3): 3 bác sĩ thật, mỗi người ít nhất 10 lượt khám mô phỏng; p50 ≤ 60 giây, p90 ≤ 120 giây. Tài liệu này để người điều phối chạy buổi thử và lấy được số đo. Nó không chứa con số M0-1 nào: các ô số ở mục 10 để trống cho tới sau buổi thử.

> **Nguyên tắc.** Không con số nào của M0-1 được ghi vào tài liệu trước khi bác sĩ thật khám. Số của bài diễn tập (`pnpm trial:rehearsal`), của e2e hay của người trong đội tự bấm thử là **số chạy thử kỹ thuật**, không phải số của bác sĩ; mọi tệp xuất từ phiên diễn tập đều tự đóng nhãn đó.

## 1. Buổi thử đo gì và không đo gì

| | |
|---|---|
| Đồng hồ bắt đầu | Lúc bác sĩ bấm "Gọi vào khám" (máy chủ ghi mốc mở hồ sơ) |
| Đồng hồ dừng | Lúc máy chủ nhận "Ký & In". **Không gồm** thời gian hộp thoại in và máy in (xem câu hỏi 3 ở mục 2) |
| Nằm trong thời gian đo | Đọc hồ sơ (dị ứng, tiền sử, lượt khám cũ), hỏi bệnh, nhập sinh hiệu, triệu chứng, chẩn đoán, kê đơn, xử lý cảnh báo |
| Không đo | Tiếp đón và cấp số (hàng chờ được xếp sẵn bằng lệnh), in ra giấy, khám thực thể thật (kết quả khám do điều phối viên đọc) |
| Ai đo | Máy chủ, cùng hàm với màn hình "Thời gian khám" (`computeMetrics` của BFF). Lượt mở hoặc ký lúc mất mạng đo bằng đồng hồ máy khám và đếm riêng |
| Không tính vào p50/p90, đếm riêng | Ca làm quen; lượt dài hơn 30 phút; lượt có giờ máy khách không hợp lý; lượt mở rồi không ký |

## 2. Câu hỏi chủ dự án cần trả lời trước buổi thử

Phiên chuẩn bị này không tự quyết các điểm sau; mặc định đang dùng ghi ở cột cuối.

| # | Câu hỏi | Vì sao phải hỏi | Đang chuẩn bị theo |
|---|---|---|---|
| 1 | Buổi thử chạy trên máy cục bộ hay staging (Q16)? | BFF bản M0 chưa có xác thực thật nên chỉ nghe trên localhost: bác sĩ phải ngồi đúng máy đang chạy BFF. Muốn dùng máy tính bảng hoặc mỗi bác sĩ một máy thì cần staging (prompt `M0-STG`) | Máy cục bộ, một máy, ba bác sĩ lần lượt |
| 2 | Ba bác sĩ thuộc chuyên khoa nào (Q15)? | Bộ ca có hai nhóm: nội tổng quát và nhi. Bác sĩ chuyên khoa khác sẽ khám ca không quen, số đo kém ý nghĩa | Mỗi bác sĩ chọn `noi` hoặc `nhi` khi xếp hàng chờ |
| 3 | Đồng hồ tính đến lúc ký hay lúc in? | Kế hoạch ghi "từ mở hồ sơ đến in đơn"; mã đo đến lúc máy chủ nhận yêu cầu ký. Phần chênh là thời gian dựng trang in và hộp thoại in của trình duyệt, chưa được đo | Đến lúc ký (như mã hiện tại). Phiếu quan sát có ô ghi tay thời gian từ "Ký & In" tới lúc giấy ra, cho 3 ca mỗi bác sĩ |
| 4 | Ngưỡng 60/120 giây áp cho từng bác sĩ hay cho số gộp của ba người? | Kế hoạch không nói rõ; hai cách có thể cho kết luận khác nhau | Bản xuất ghi cả hai, không tự kết luận |
| 5 | Ai là cố vấn y khoa duyệt bộ ca, hạn nào? | 30 ca là dữ liệu minh họa, **chưa được duyệt**; phải duyệt trước buổi thử | Chưa có người duyệt |

## 3. Bộ ca

- [`docs/phien-thu/ca-mo-phong.md`](phien-thu/ca-mo-phong.md): 12 ca nội tổng quát (N01–N12) và 12 ca nhi (P01–P12) tính số đo, mỗi nhóm thêm 3 ca làm quen (NL1–NL3, PL1–PL3). Mỗi bác sĩ khám 12 ca: đủ 10 lượt, dư 2.
- Phủ các tình huống của kịch bản: ca thường dùng đơn mẫu, có dị ứng, trùng hoạt chất, bệnh mạn tính 90 ngày, trẻ em thiếu cân nặng (chỉ nhi), "kê lại". Bảng phủ nằm ở đầu tệp trên.
- **Chưa được cố vấn y khoa duyệt.** Dòng này in trên từng phiếu, kèm ô để cố vấn ký. Việc cần cố vấn xem kỹ: liều trẻ em trong "đường đi của bài diễn tập", lựa chọn thay thế ở các ca dị ứng (N03, N08, P04), và ca hen 15 tuổi (P09).
- Nguồn duy nhất là `packages/trial/src/cases-noi.ts` và `cases-nhi.ts`. Sửa ca thì sửa ở đó, rồi `pnpm trial sheets` và `pnpm test`. Kiểm thử chạy từng ca trên đúng mã bản nháp và bộ quy tắc của màn hình khám: ca không ký được, hoặc không hiện cảnh báo mà phiếu hứa, thì đỏ.
- Mỗi bác sĩ có bản sao bệnh nhân riêng của từng ca (cùng tên). Vì vậy lượt khám của bác sĩ trước không làm đổi hồ sơ bác sĩ sau nhìn thấy, và ba người gặp điều kiện như nhau. Tìm theo tên ở "Tiếp đón" sẽ ra ba người trùng tên: không tìm tay, dùng lệnh xếp hàng chờ.

## 4. Chuẩn bị

### Trước buổi thử vài ngày

1. Chủ dự án trả lời năm câu hỏi ở mục 2.
2. Cố vấn y khoa duyệt bộ ca; sửa theo góp ý; sinh lại phiếu.
3. In phiếu ca: `pnpm trial sheets`, mở `services/bff/.data/trial/phieu-ca/phieu-ca-noi.html` (hoặc `-nhi`) bằng trình duyệt, in A4. Mỗi ca một trang. In thêm mục 8 và 9 của tài liệu này: mỗi bác sĩ một bản.
4. Chạy `pnpm trial:rehearsal` trên chính máy sẽ dùng: phải đạt 11/11.
5. Phân vai: điều phối viên (chạy lệnh, đọc kết quả khám, bấm giờ in), một hoặc hai người đóng vai bệnh nhân, một người ghi phiếu quan sát (có thể là điều phối viên nếu thiếu người).

### Chuẩn bị máy

Máy Windows 11 có Git Bash, Docker Desktop đang mở, Node 22 (như `README.md`, mục "Chạy trên Windows"). Gõ lệnh trong Git Bash ở gốc kho.

```bash
pnpm install
pnpm stack:up          # nếu stack Medplum chưa chạy; trên máy dev hiện tại stack đã chạy sẵn
pnpm trial:up          # tạo hoặc dùng lại phòng khám thử, build giao diện, chạy BFF (8112) và giao diện (4175)
```

`pnpm trial:up` giữ cửa sổ đó cho tới khi bấm Ctrl+C. Mở trình duyệt ở `http://127.0.0.1:4175`: màn hình đăng nhập chỉ có phòng khám thử với năm người dùng (Bác sĩ thử 1, 2, 3; Phụ tá; Điều phối viên). Hai phòng khám demo không có mặt ở đây và không bị đụng tới.

- **Chỉ ký lượt khám trên phòng khám thử trong buổi thử.** Trước buổi thử không tự khám thử trên phiên `m0-1`: mọi lượt đã ký của Bác sĩ thử 1–3 trên ca tính số đo đều vào số đo. Muốn thử thì chạy `pnpm trial:rehearsal` (phòng khám diễn tập riêng) hoặc dùng ca làm quen.
- **Trình duyệt:** Chrome hoặc Edge bản mới, cửa sổ rộng từ 1280 px. Tắt tiện ích tự điền và dịch trang. Để một tab duy nhất. [Chưa kiểm chứng: mới thử trên Chromium không giao diện; chưa thử trên máy tính bảng hay trình duyệt khác.]
- **In:** "Ký & In" mở hộp thoại in của trình duyệt. Đồng hồ đã dừng trước đó, nhưng bác sĩ phải bấm "In" hoặc Esc mới làm tiếp được. Có máy in A5 thì đặt làm máy in mặc định và in thật. Không có thì dặn bác sĩ bấm Esc. Chrome có cờ `--kiosk-printing` để in thẳng không hỏi [Chưa kiểm chứng trên máy thử].
- **Cổng bị giữ:** script không dừng tiến trình lạ; đặt `TRIAL_BFF_PORT`, `TRIAL_WEB_PORT` sang cổng trống.
- **Lỗi đã biết trên `main`** (xem `README.md`, mục "Giới hạn"): "Ký & In" có lúc lưu lượt khám nhưng không mở trang in; bấm "In lại đơn". Hàng chờ có lúc hiện hai dòng cho một lượt sau khi mất phản hồi. Cả hai không làm sai số đo; ghi vào phiếu quan sát nếu gặp.
- Tắt thông báo của hệ điều hành, cắm sạc, tắt chế độ ngủ.

## 5. Kịch bản điều phối

Mỗi bác sĩ khoảng 40–50 phút. Ví dụ dưới đây cho bác sĩ thứ nhất, chuyên khoa nội; bác sĩ sau thay `bs1` bằng `bs2`, `bs3` và `noi` bằng `nhi` nếu cần. Lệnh gõ ở một cửa sổ Git Bash thứ hai.

| Bước | Thời lượng | Điều phối viên làm | Ghi chú |
|---|---|---|---|
| 1. Đón bác sĩ | 3 phút | Nói: dữ liệu hoàn toàn là giả; đang thử phần mềm chứ không chấm bác sĩ; chữ ký số và cổng đơn thuốc là mô phỏng; bộ ca chưa phải phác đồ. Hỏi và ghi phần "thông tin chung" của phiếu phản hồi | Không nêu mục tiêu 60 giây trước khi khám |
| 2. Xếp ca làm quen | | `pnpm trial queue bs1 noi warmup` | 3 ca, không tính số đo |
| 3. Đăng nhập | | Bác sĩ chọn "Bác sĩ thử 1", mở "Hàng chờ" | |
| 4. Ca làm quen | 10 phút | Hướng dẫn từng nút, cho hỏi thoải mái: gọi vào khám, sinh hiệu, gõ tắt chẩn đoán, đơn mẫu, kê lại, cảnh báo và ô lý do, "Ký & In", "Về hàng chờ" | Dừng khi bác sĩ nói đã quen. Chưa quen thì `pnpm trial queue bs1 noi warmup round=2` |
| 5. Dọn, xếp ca tính số đo | | `pnpm trial clear` rồi `pnpm trial queue bs1 noi` | 12 ca theo thứ tự N01…N12 |
| 6. Ca tính số đo | 20–25 phút | Với từng ca: người đóng vai ngồi sẵn, cầm phiếu; bác sĩ bấm "Gọi vào khám" trên người đứng đầu; điều phối viên đưa "phiếu điều dưỡng" và đọc "kết quả khám" khi bác sĩ khám. Không gợi ý thao tác | Bác sĩ tự quyết định điều trị. Kẹt quá 2 phút mới gợi ý, và ghi vào phiếu quan sát |
| 7. Bấm giờ in (3 ca) | | Bấm đồng hồ tay từ lúc bác sĩ bấm "Ký & In" tới lúc giấy ra (hoặc hộp thoại in đóng) | Dữ liệu cho câu hỏi 3 |
| 8. Kết thúc lượt | | `pnpm trial clear` | Còn lượt đang khám dở thì lệnh báo; xem "Sự cố" |
| 9. Phản hồi | 5–8 phút | Bác sĩ điền phiếu ở mục 8; hỏi thêm ba câu mở cuối phiếu | Làm ngay, khi còn nhớ |
| 10. Đăng xuất | | "Đăng xuất" trước khi bác sĩ sau vào | Kho trên máy của bác sĩ đó bị xóa |

Sau bác sĩ cuối: `pnpm trial export`, đối chiếu với màn hình (mục 7), điền biên bản (mục 10).

Quy ước trong lúc đo:

- Đồng hồ chạy từ "Gọi vào khám" tới "Ký & In". Bác sĩ không bấm "Gọi vào khám" khi người đóng vai chưa sẵn sàng, và không rời máy giữa ca.
- Người đóng vai chỉ nói phần "Kể với bác sĩ"; phần "Chỉ nói khi bác sĩ hỏi" thì chờ hỏi. Phần "Dành cho điều phối viên" không đọc cho bác sĩ.
- Sau khi ký, màn hình hiện số giây của lượt vừa xong kèm "mục tiêu ≤ 60 giây". Bác sĩ sẽ thấy con số này; không bình luận về nó trong lúc đo.
- Bác sĩ bỏ qua hàng chờ và khám theo thứ tự khác cũng được: số đo không phụ thuộc thứ tự.

Sự cố:

| Tình huống | Xử lý | Ghi lại |
|---|---|---|
| Bác sĩ bỏ dở một ca (đã mở, không ký) | Để nguyên, làm ca kế. Cuối lượt `pnpm trial clear` sẽ báo; `pnpm trial clear force` hủy lượt đó | Lượt không vào p50/p90, được đếm ở cột "Mở rồi không ký" |
| Cần làm lại một ca hoặc cả nhóm | `pnpm trial queue bs1 noi round=2` xếp lại cả nhóm; bác sĩ chỉ gọi ca cần làm lại, còn lại `pnpm trial clear` | Cả hai lượt của ca đó đều vào số đo. Ghi lý do |
| Chạy nhầm lệnh xếp hai lần | Không sao: lần hai không cấp thêm số | |
| Mất mạng, máy chủ dừng | Ứng dụng chuyển sang "Mất mạng", bác sĩ vẫn ký được; lượt đó đo bằng đồng hồ máy khám. Chạy lại `pnpm trial:up` nếu BFF dừng | Cột "Đo ở máy khám" |
| Hộp thoại in không hiện | Bấm "In lại đơn" | Lỗi đã biết |
| Bác sĩ nghỉ giữa chừng với hồ sơ đang mở | Lượt đó sẽ dài; nếu quá 30 phút máy tự loại và đếm riêng | Ghi giờ nghỉ |

## 6. Ca làm quen và cách loại chúng khi xuất

Ca làm quen dùng bệnh nhân riêng (NL1–NL3, PL1–PL3). Lệnh xuất nhận ra chúng theo bệnh nhân và **tự loại** khỏi số đo M0-1, kể cả khi bác sĩ khám lẫn với ca tính số đo; không phải đánh dấu gì bằng tay. Mỗi lượt làm quen vẫn có một dòng trong CSV với ghi chú "không: ca làm quen", và số ca bị loại hiện ở cột "Ca làm quen (loại)".

Màn hình "Thời gian khám" không biết ca làm quen, nên con số trên màn hình gồm cả chúng. Bản xuất có hai bảng: bảng M0-1 (đã loại) và bảng "đối chiếu với màn hình" (chưa loại).

Không loại bằng tay một lượt tính số đo. Nếu buộc phải loại (sự cố kỹ thuật đã ghi trong phiếu quan sát), ghi cả số trước và sau khi loại vào biên bản, kèm lý do.

## 7. Xuất số đo

```bash
pnpm trial export            # 30 ngày gần nhất; days=1 nếu cả buổi thử nằm trong hôm nay
```

Lệnh in bảng tóm tắt ra màn hình và ghi ba tệp vào `services/bff/.data/trial/m0-1/export/`:

- `…-luot-kham.csv`: mỗi lượt một dòng (bác sĩ, ca, loại ca, ngày, mã lượt khám, giờ mở hồ sơ, giờ ký, số giây, nguồn đo, có vào phân vị không và vì sao). Mở được bằng Excel.
- `…-tom-tat.md`: bảng theo từng bác sĩ (số lượt, p50, p90, số lượt đo ở máy khám, số lượt bị loại vì giờ không hợp lý, số lượt dài hơn 30 phút, ca làm quen bị loại, lượt ngoài bộ ca, lượt mở rồi không ký, so với ngưỡng 60/120 giây và mức 10 lượt), một dòng gộp, và bảng đối chiếu với màn hình.
- `…-tom-tat.json`: cùng nội dung, cho máy đọc.

Mọi con số do `computeMetrics` của BFF tính (`services/bff/src/metrics.ts`), trên đúng dữ liệu màn hình "Thời gian khám" đọc. Lệnh xuất không có công thức phân vị hay ngưỡng loại của riêng nó.

**Đối chiếu với màn hình trước khi tin con số:** đăng nhập "Điều phối viên", mở "Thời gian khám", chọn cùng khoảng (ví dụ "30 ngày"). Bảng trên màn hình phải trùng từng ô với bảng "Đối chiếu với màn hình" của bản xuất. Bài diễn tập đã kiểm việc này tự động (mục 11).

## 8. Phiếu ghi phản hồi của bác sĩ

In mỗi bác sĩ một bản. Điền ngay sau lượt khám.

**Thông tin chung** (điều phối viên hỏi và ghi trước khi khám)

- Mã bác sĩ trong buổi thử: ☐ Bác sĩ thử 1 ☐ 2 ☐ 3 · Chuyên khoa: ……………… · Số năm hành nghề: ………
- Đang dùng phần mềm phòng khám nào: ……………… · Kê đơn hiện nay bằng: ☐ phần mềm ☐ viết tay ☐ cả hai
- Một lượt khám thông thường của bác sĩ hiện mất khoảng (tự ước lượng): ……… phút, trong đó ghi chép và kê đơn: ……… phút

**Cho điểm** (1 = hoàn toàn không đồng ý, 5 = hoàn toàn đồng ý)

| # | Nhận định | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 1 | Tôi tìm thấy ngay dị ứng, tiền sử và lượt khám cũ của bệnh nhân | ☐ | ☐ | ☐ | ☐ | ☐ |
| 2 | Nhập sinh hiệu nhanh và không vướng | ☐ | ☐ | ☐ | ☐ | ☐ |
| 3 | Gõ tắt chẩn đoán ra đúng mã tôi cần | ☐ | ☐ | ☐ | ☐ | ☐ |
| 4 | Đơn mẫu khớp với cách tôi kê | ☐ | ☐ | ☐ | ☐ | ☐ |
| 5 | "Kê lại đơn này" làm đúng điều tôi mong | ☐ | ☐ | ☐ | ☐ | ☐ |
| 6 | Cảnh báo (dị ứng, trùng hoạt chất, cân nặng) hiện đúng lúc và dễ hiểu | ☐ | ☐ | ☐ | ☐ | ☐ |
| 7 | Việc phải ghi lý do khi vẫn kê là hợp lý | ☐ | ☐ | ☐ | ☐ | ☐ |
| 8 | Nhập liều cho trẻ em (nếu khám nhi) thuận tay | ☐ | ☐ | ☐ | ☐ | ☐ |
| 9 | Tôi luôn biết vì sao chưa ký được | ☐ | ☐ | ☐ | ☐ | ☐ |
| 10 | Tôi tin đơn in ra đúng với cái tôi đã kê | ☐ | ☐ | ☐ | ☐ | ☐ |
| 11 | So với cách đang làm, phần mềm này nhanh hơn | ☐ | ☐ | ☐ | ☐ | ☐ |
| 12 | Tôi sẵn sàng dùng thử ở phòng mạch của mình | ☐ | ☐ | ☐ | ☐ | ☐ |

**Câu hỏi mở**

1. Bước nào làm bác sĩ mất thời gian nhất? ………………………………………………………………
2. Thiếu gì thì bác sĩ không thể dùng hằng ngày? ………………………………………………………………
3. Thuốc, chẩn đoán hay đơn mẫu nào bác sĩ tìm mà không có? ………………………………………………………………
4. Cảnh báo nào thừa, cảnh báo nào thiếu? ………………………………………………………………
5. Bộ ca có giống bệnh nhân thật của bác sĩ không? Khác ở đâu? ………………………………………………………………

## 9. Phiếu quan sát của người điều phối

Mỗi bác sĩ một bản. Ghi trong lúc khám, không đợi cuối buổi.

Bác sĩ thử: ……… · Chuyên khoa: ……… · Ngày: ……… · Giờ bắt đầu ca tính số đo: ……… · Máy, trình duyệt, cỡ màn hình: ………………

| Ca | Ký được không cần gợi ý | Kẹt ở đâu (màn hình, nút, từ ngữ) | Gợi ý của điều phối viên | Cảnh báo: bác sĩ đổi thuốc / ghi lý do / không gặp | Gõ tìm không ra (từ khóa) | Lỗi phần mềm, ghi chú |
|---|---|---|---|---|---|---|
| Làm quen 1 | | | | | | |
| Làm quen 2 | | | | | | |
| Làm quen 3 | | | | | | |
| 01 | | | | | | |
| 02 | | | | | | |
| 03 | | | | | | |
| 04 | | | | | | |
| 05 | | | | | | |
| 06 | | | | | | |
| 07 | | | | | | |
| 08 | | | | | | |
| 09 | | | | | | |
| 10 | | | | | | |
| 11 | | | | | | |
| 12 | | | | | | |

Bấm giờ tay từ "Ký & In" tới lúc giấy ra hoặc hộp thoại in đóng (3 ca): ca ……: ……… giây · ca ……: ……… giây · ca ……: ……… giây. In ra: ☐ máy in thật ☐ bấm Esc.

Sự cố trong lượt (lượt bỏ dở, làm lại, mất mạng, nghỉ giữa chừng, lệnh đã chạy): ………………………………………………………………

Điều bác sĩ nói thành lời đáng ghi lại: ………………………………………………………………

## 10. Mẫu biên bản kết quả

Điền sau buổi thử. Số lấy từ tệp `…-tom-tat.md` của `pnpm trial export`; đính kèm tệp đó và tệp CSV. **Không điền bằng số của bài diễn tập.**

**Biên bản phiên thử M0-1**

- Ngày, nơi thử: ……………… · Điều phối viên: ……………… · Người đóng vai bệnh nhân: ………………
- Môi trường: ☐ máy cục bộ ☐ staging; máy: ………………; trình duyệt: ………………; mã ở commit: ………………
- Bộ ca đã được cố vấn y khoa duyệt: ☐ có, người duyệt và ngày: ……………… ☐ chưa
- Đồng hồ tính đến: ☐ lúc ký (như mã hiện tại) ☐ khác: ………………

Người tham gia (tên thật chỉ ghi ở đây, không đưa vào hệ thống):

| Mã trong buổi thử | Bác sĩ | Chuyên khoa | Nhóm ca |
|---|---|---|---|
| Bác sĩ thử 1 | | | ☐ nội ☐ nhi |
| Bác sĩ thử 2 | | | ☐ nội ☐ nhi |
| Bác sĩ thử 3 | | | ☐ nội ☐ nhi |

Số đo (ca tính số đo, đã loại ca làm quen):

| Bác sĩ | Số lượt | p50 (giây) | p90 (giây) | Đo ở máy khám | Loại: giờ không hợp lý | Loại: dài hơn 30 phút | Ca làm quen (loại) | Ngoài bộ ca (loại) | Mở rồi không ký | Đủ 10 lượt | p50 ≤ 60 | p90 ≤ 120 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bác sĩ thử 1 | | | | | | | | | | | | |
| Bác sĩ thử 2 | | | | | | | | | | | | |
| Bác sĩ thử 3 | | | | | | | | | | | | |
| Gộp | | | | | | | | | | | | |

- Đã đối chiếu bảng "Đối chiếu với màn hình" của bản xuất với màn hình "Thời gian khám": ☐ khớp ☐ lệch ở: ………………
- Lượt loại bằng tay (nếu có), lý do, số trước và sau khi loại: ………………
- Thời gian từ "Ký & In" tới lúc giấy ra (bấm giờ tay, 9 ca): thấp nhất ……… · cao nhất ……… giây
- Kết luận M0-1: ☐ đạt ☐ chưa đạt ☐ chưa đủ dữ liệu. Áp ngưỡng cho: ☐ từng bác sĩ ☐ số gộp. Lý do: ………………
- Ba việc phải sửa trước buổi trình diễn (đầu vào cho prompt `M0-PH`): 1. ……………… 2. ……………… 3. ………………
- Điểm phản hồi trung bình từng nhận định và trích ý kiến của bác sĩ: đính kèm ba phiếu ở mục 8.

## 11. Diễn tập kỹ thuật

```bash
pnpm trial:rehearsal         # cần stack Medplum đang chạy; tự tạo phòng khám diễn tập mới, BFF 8113, giao diện 4176, tự dừng
```

Bài `apps/clinic-web/e2e/trial-rehearsal.mjs` chạy trên Chromium thật, trên một phòng khám diễn tập mới mỗi lần, đi đúng các lệnh và màn hình của mục 5:

1. Hai bác sĩ thử, mỗi người 3 ca làm quen rồi 12 ca tính số đo (bác sĩ 1 nội, bác sĩ 2 nhi), mỗi ca bấm đúng "đường đi của bài diễn tập" ghi trên phiếu. Đơn máy chủ lưu phải đúng như phiếu ghi, cảnh báo phải hiện đúng chỗ.
2. Một lượt mở rồi bỏ dở, `pnpm trial clear`, lệnh xếp cho bác sĩ sau bị chặn, `pnpm trial clear force`.
3. `pnpm trial export`: ca làm quen bị loại; p50 và p90 của từng bác sĩ khớp với phân vị mà bài tự tính, độc lập với BFF, từ số giây màn hình đã hiện sau mỗi lần ký; CSV mỗi lượt một dòng.
4. Bảng đối chiếu của bản xuất khớp từng ô với màn hình "Thời gian khám" của điều phối viên và của từng bác sĩ.
5. Phiếu ca in ra đúng mỗi ca một trang A4.

Kết quả ngày 03/10/2026 [Đã đo; máy dev Windows 11, i7-11800H, 32 GB RAM, Medplum 5.2.0 trong Docker Desktop, bản build, Chromium không giao diện]: ba lần chạy trọn bài đều đạt 11/11 bước, mỗi lần 30 lượt đã ký và 1 lượt bỏ dở, 4 đến 5,5 phút. Số giây bài này in ra là của máy bấm (vài giây mỗi lượt): **số chạy thử kỹ thuật, không ghi vào đây và không phải số M0-1.**

Bài đã được thấy đỏ khi cố ý làm hỏng: làm hỏng trường mà lệnh xuất dùng để nhận ra ca làm quen thì bài dừng ở bước xuất số đo. Một lần chạy khác hỏng ở lúc bác sĩ 1 đăng xuất vì trình duyệt không giao diện chết giữa chừng; không tái hiện được và chưa rõ nguyên nhân (kế hoạch, mục 5.9, đoạn "M0-THU"). Nếu gặp, chạy lại.

Bài không nằm trong `pnpm e2e` và chưa chạy trong CI: nó là công cụ kiểm trước buổi thử, chạy tay. Mỗi lần chạy để lại một Project diễn tập trong Medplum.

## 12. Giới hạn của buổi thử

- **Ca mô phỏng, không phải bệnh nhân thật.** Không có khám thực thể; kết quả khám được đọc cho bác sĩ. Số đo nói về thao tác trên phần mềm và hỏi bệnh theo kịch bản, không phải thời gian một lượt khám thật.
- **Sinh hiệu nhập trong thời gian đo.** Ở phòng mạch có phụ tá, sinh hiệu có thể đã được nhập trước; ở M0 chỉ màn hình khám nhập được.
- **Bác sĩ thấy số giây của mình sau mỗi ca**, kèm mục tiêu 60 giây. Điều này có thể làm bác sĩ khám nhanh hơn bình thường.
- **Thứ tự ca cố định**, nên các ca sau hưởng lợi từ việc đã quen. Ba ca làm quen giảm bớt, không loại bỏ được.
- **Ba bác sĩ là mẫu rất nhỏ.** p90 của 12 lượt là lượt chậm thứ hai; một ca kẹt đủ làm đổi kết luận.
- **In không được đo** (câu hỏi 3). Thời gian tới lúc giấy ra chỉ có số bấm tay của 3 ca mỗi người.
- **Một máy, có mạng, máy chủ cùng máy.** Không đo độ trễ mạng tới máy chủ ở xa; nếu chạy trên staging, số đo sẽ gồm cả độ trễ đó.
- **Danh mục và đơn mẫu là tập con minh họa.** Bác sĩ tìm thuốc không có sẽ mất thời gian: ghi lại từ khóa ở phiếu quan sát.
