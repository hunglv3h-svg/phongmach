# Bộ ca khám mô phỏng cho phiên thử với bác sĩ (M0-1)

> **DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.**
>
> Tệp này sinh từ `packages/trial/src/cases-noi.ts` và `cases-nhi.ts` bằng lệnh `pnpm trial sheets`. Không sửa tay: sửa dữ liệu rồi sinh lại (có kiểm thử giữ hai bên khớp nhau).
> Tuổi ghi trên phiếu tính đến 04/11/2026. Tên và ngày sinh đều là giả. Bản in mỗi ca một trang: xem `docs/phien-thu-bac-si.md`.

## Tổng quan

| Ca | Chuyên khoa | Nội dung | Tình huống | Tính số đo |
|---|---|---|---|---|
| NL1 | Nội tổng quát | Cảm, sổ mũi (làm quen: đơn mẫu) | Ca thường, dùng đơn mẫu | Không (làm quen) |
| NL2 | Nội tổng quát | Viêm họng, dị ứng penicillin (làm quen: cảnh báo) | Có dị ứng thuốc đã ghi trong hồ sơ | Không (làm quen) |
| NL3 | Nội tổng quát | Tái khám tăng huyết áp (làm quen: kê lại) | "Kê lại" đơn của lượt khám cũ | Không (làm quen) |
| N01 | Nội tổng quát | Viêm họng cấp | Ca thường, dùng đơn mẫu | Có |
| N02 | Nội tổng quát | Viêm dạ dày | Ca thường, dùng đơn mẫu | Có |
| N03 | Nội tổng quát | Viêm họng cấp, bệnh nhân dị ứng penicillin | Có dị ứng thuốc đã ghi trong hồ sơ; Ca thường, dùng đơn mẫu | Có |
| N04 | Nội tổng quát | Tăng huyết áp, xin đơn 90 ngày | Bệnh mạn tính, đơn 90 ngày; Ca thường, dùng đơn mẫu | Có |
| N05 | Nội tổng quát | Tăng huyết áp và rối loạn lipid máu, kê lại đơn cũ | "Kê lại" đơn của lượt khám cũ | Có |
| N06 | Nội tổng quát | Viêm họng cấp, bệnh nhân xin thêm thuốc trùng hoạt chất | Trùng hoạt chất; Ca thường, dùng đơn mẫu | Có |
| N07 | Nội tổng quát | Nhiễm trùng hô hấp trên | Ca thường, dùng đơn mẫu | Có |
| N08 | Nội tổng quát | Đau thắt lưng, bệnh nhân dị ứng thuốc kháng viêm | Có dị ứng thuốc đã ghi trong hồ sơ; Ca thường, dùng đơn mẫu | Có |
| N09 | Nội tổng quát | Đái tháo đường typ 2, kê lại và xin đơn 90 ngày | "Kê lại" đơn của lượt khám cũ; Bệnh mạn tính, đơn 90 ngày | Có |
| N10 | Nội tổng quát | Tiêu chảy cấp | Ca thường, dùng đơn mẫu | Có |
| N11 | Nội tổng quát | Viêm mũi dị ứng tái phát, kê lại đơn cũ | "Kê lại" đơn của lượt khám cũ | Có |
| N12 | Nội tổng quát | Đái tháo đường typ 2, tăng liều metformin | "Kê lại" đơn của lượt khám cũ; Trùng hoạt chất | Có |
| PL1 | Nhi | Sốt siêu vi (làm quen: đơn mẫu, nhập liều) | Ca thường, dùng đơn mẫu | Không (làm quen) |
| PL2 | Nhi | Ho, sổ mũi, chưa có cân nặng (làm quen: cảnh báo cân nặng) | Trẻ em chưa có cân nặng; Ca thường, dùng đơn mẫu | Không (làm quen) |
| PL3 | Nhi | Ho, sổ mũi tái lại (làm quen: kê lại) | "Kê lại" đơn của lượt khám cũ | Không (làm quen) |
| P01 | Nhi | Sốt siêu vi | Ca thường, dùng đơn mẫu | Có |
| P02 | Nhi | Ho, sổ mũi | Ca thường, dùng đơn mẫu | Có |
| P03 | Nhi | Tiêu chảy cấp | Ca thường, dùng đơn mẫu | Có |
| P04 | Nhi | Viêm amidan cấp, trẻ dị ứng penicillin | Có dị ứng thuốc đã ghi trong hồ sơ; Không có đơn mẫu, kê từng thuốc | Có |
| P05 | Nhi | Sốt, phiếu chưa có cân nặng (hỏi được) | Trẻ em chưa có cân nặng; Ca thường, dùng đơn mẫu | Có |
| P06 | Nhi | Sổ mũi ở trẻ nhũ nhi, không cân được | Trẻ em chưa có cân nặng; Ca thường, dùng đơn mẫu | Có |
| P07 | Nhi | Sốt siêu vi, đổi hàm lượng thuốc hạ sốt | Trùng hoạt chất; Ca thường, dùng đơn mẫu | Có |
| P08 | Nhi | Ho, sổ mũi tái lại, kê lại đơn cũ | "Kê lại" đơn của lượt khám cũ | Có |
| P09 | Nhi | Hen ở thiếu niên, kê lại và xin đơn 90 ngày | "Kê lại" đơn của lượt khám cũ; Bệnh mạn tính, đơn 90 ngày | Có |
| P10 | Nhi | Sốt, trẻ dị ứng ibuprofen, người nhà xin ibuprofen | Có dị ứng thuốc đã ghi trong hồ sơ; Ca thường, dùng đơn mẫu | Có |
| P11 | Nhi | Tiêu chảy cấp ở trẻ lớn, thêm thuốc vào đơn mẫu | Ca thường, dùng đơn mẫu | Có |
| P12 | Nhi | Viêm tai giữa cấp, không có đơn mẫu | Không có đơn mẫu, kê từng thuốc | Có |

## Phủ tình huống (chỉ tính ca có số đo)

| Tình huống | Nội tổng quát | Nhi |
|---|---|---|
| Ca thường, dùng đơn mẫu | N01, N02, N03, N04, N06, N07, N08, N10 | P01, P02, P03, P05, P06, P07, P10, P11 |
| Có dị ứng thuốc đã ghi trong hồ sơ | N03, N08 | P04, P10 |
| Trùng hoạt chất | N06, N12 | P07 |
| Bệnh mạn tính, đơn 90 ngày | N04, N09 | P09 |
| Trẻ em chưa có cân nặng | không áp dụng | P05, P06 |
| "Kê lại" đơn của lượt khám cũ | N05, N09, N11, N12 | P08, P09 |

## Nội tổng quát

### NL1 · Nội tổng quát · Cảm, sổ mũi (làm quen: đơn mẫu)

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.* **Ca làm quen: không tính vào số đo.**

**Người đóng vai**

- Bệnh nhân: Phạm Văn Tùng, nam, 38 tuổi (sinh 12/04/1988)
- Lý do đến khám (đã ghi lúc cấp số): Sổ mũi, ho 2 ngày

**Kể với bác sĩ**

- Sổ mũi, hắt hơi, ho khan từ 2 ngày nay.
- Người hơi mệt, không sốt.

**Chỉ nói khi bác sĩ hỏi**

- Không khó thở, không đau ngực.
- Không dị ứng thuốc.
- Chưa uống thuốc gì.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37,2 °C
- Mạch: 78 lần/phút
- Huyết áp: 120/78 mmHg
- Cân nặng: 66 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Họng hơi đỏ, phổi thông khí đều, không ran.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Làm quen với màn hình khám: nhập sinh hiệu, chọn đơn mẫu, "Ký & In".
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Nhiễm trùng hô hấp trên cấp (không kháng sinh)" (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Thuốc: Paracetamol 500 mg; Cetirizin 10 mg; Natri clorid 0,9% (nhỏ mũi)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### NL2 · Nội tổng quát · Viêm họng, dị ứng penicillin (làm quen: cảnh báo)

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.* **Ca làm quen: không tính vào số đo.**

**Người đóng vai**

- Bệnh nhân: Lê Thị Hồng Nhung, nữ, 47 tuổi (sinh 03/09/1979)
- Lý do đến khám (đã ghi lúc cấp số): Đau họng, sốt nhẹ

**Kể với bác sĩ**

- Đau họng, nuốt đau từ hôm qua.
- Sốt nhẹ về chiều.

**Chỉ nói khi bác sĩ hỏi**

- Từng nổi mẩn ngứa khắp người khi uống amoxicillin (đã ghi trong hồ sơ).
- Không ho, không khó thở.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,1 °C
- Mạch: 88 lần/phút
- Huyết áp: 118/76 mmHg
- Cân nặng: 54 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Họng đỏ, amidan sưng nhẹ, không mủ. Hạch góc hàm không to.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: Penicillin (amoxicillin…)
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Có dị ứng thuốc đã ghi trong hồ sơ
- Làm quen với cảnh báo: đơn mẫu có amoxicillin nên máy cảnh báo dị ứng. Cho bác sĩ thấy hai lối ra: bỏ thuốc và thêm thuốc khác, hoặc ghi lý do vẫn kê.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Viêm họng cấp có chỉ định kháng sinh" (2) Máy hiện cảnh báo: dị ứng thuốc (3) Bỏ Amoxicillin 500 mg (nút × ở dòng thuốc) (4) Thêm thuốc: gõ "azithromycin", Enter: Azithromycin 500 mg (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J02.9 Viêm họng cấp, không đặc hiệu. Thuốc: Paracetamol 500 mg; Azithromycin 500 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### NL3 · Nội tổng quát · Tái khám tăng huyết áp (làm quen: kê lại)

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.* **Ca làm quen: không tính vào số đo.**

**Người đóng vai**

- Bệnh nhân: Trần Văn Bảy, nam, 68 tuổi (sinh 20/06/1958)
- Lý do đến khám (đã ghi lúc cấp số): Tái khám tăng huyết áp, hết thuốc

**Kể với bác sĩ**

- Đến xin kê lại thuốc huyết áp như lần trước, đã hết thuốc.
- Uống đều mỗi sáng, người khỏe.

**Chỉ nói khi bác sĩ hỏi**

- Không đau đầu, không chóng mặt, không phù chân.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Mạch: 74 lần/phút
- Huyết áp: 134/82 mmHg
- Cân nặng: 61 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Tim đều, phổi trong, không phù.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Tiền sử: Tăng huyết áp 10 năm, đang dùng amlodipin
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): I10 Tăng huyết áp vô căn (nguyên phát). Đơn: Amlodipin 5 mg: 1 x 1 lần/ngày x 30 ngày

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ
- Làm quen với nút "Kê lại đơn này" ở cột lịch sử khám bên trái.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: I10 Tăng huyết áp vô căn (nguyên phát). Thuốc: Amlodipin 5 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N01 · Nội tổng quát · Viêm họng cấp

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Nguyễn Thị Mai Hoa, nữ, 34 tuổi (sinh 18/06/1992)
- Lý do đến khám (đã ghi lúc cấp số): Đau họng, sốt 2 ngày

**Kể với bác sĩ**

- Đau rát họng, nuốt đau từ 2 ngày nay.
- Sốt, tối qua đo ở nhà 38,5 độ.

**Chỉ nói khi bác sĩ hỏi**

- Không ho, không sổ mũi.
- Không dị ứng thuốc.
- Không có thai, không cho con bú.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,4 °C
- Mạch: 92 lần/phút
- Huyết áp: 112/72 mmHg
- Cân nặng: 52 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Họng đỏ rực, amidan sưng, có chấm mủ trắng. Hạch góc hàm sưng đau.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Ca thường: đơn mẫu "Viêm họng cấp có chỉ định kháng sinh", không có cảnh báo.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Viêm họng cấp có chỉ định kháng sinh" (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J02.9 Viêm họng cấp, không đặc hiệu. Thuốc: Amoxicillin 500 mg; Paracetamol 500 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N02 · Nội tổng quát · Viêm dạ dày

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Hoàng Văn Thắng, nam, 45 tuổi (sinh 05/08/1981)
- Lý do đến khám (đã ghi lúc cấp số): Đau thượng vị, đầy bụng

**Kể với bác sĩ**

- Đau âm ỉ vùng trên rốn khoảng 1 tuần, đau hơn khi đói.
- Ợ hơi, đầy bụng sau ăn.

**Chỉ nói khi bác sĩ hỏi**

- Không nôn, không đi ngoài phân đen.
- Hay uống cà phê, thỉnh thoảng uống rượu bia.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 36,8 °C
- Mạch: 76 lần/phút
- Huyết áp: 124/80 mmHg
- Cân nặng: 68 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Ấn thượng vị đau nhẹ, bụng mềm, không có phản ứng thành bụng.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Ca thường: đơn mẫu "Viêm dạ dày" (3 thuốc), không có cảnh báo.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Viêm dạ dày" (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: K29.7 Viêm dạ dày, không đặc hiệu. Thuốc: Omeprazol 20 mg; Domperidon 10 mg; Nhôm hydroxyd + magnesi hydroxyd

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N03 · Nội tổng quát · Viêm họng cấp, bệnh nhân dị ứng penicillin

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Đỗ Thị Thu Thảo, nữ, 31 tuổi (sinh 27/04/1995)
- Lý do đến khám (đã ghi lúc cấp số): Đau họng, sốt

**Kể với bác sĩ**

- Đau họng 3 ngày, nuốt vướng.
- Sốt về chiều, người mỏi.

**Chỉ nói khi bác sĩ hỏi**

- Năm ngoái uống amoxicillin thì nổi mề đay toàn thân, phải đi tiêm (đã ghi trong hồ sơ).
- Không khó thở.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,6 °C
- Mạch: 96 lần/phút
- Huyết áp: 110/70 mmHg
- Cân nặng: 49 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Họng đỏ, amidan sưng to, có mủ. Hạch góc hàm hai bên sưng đau.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: Penicillin (amoxicillin…)
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Có dị ứng thuốc đã ghi trong hồ sơ; Ca thường, dùng đơn mẫu
- Đơn mẫu viêm họng có amoxicillin: máy phải cảnh báo dị ứng penicillin và khóa nút ký. Ghi lại bác sĩ đổi thuốc hay ghi lý do vẫn kê.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Viêm họng cấp có chỉ định kháng sinh" (2) Máy hiện cảnh báo: dị ứng thuốc (3) Bỏ Amoxicillin 500 mg (nút × ở dòng thuốc) (4) Thêm thuốc: gõ "azithromycin", Enter: Azithromycin 500 mg (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J02.9 Viêm họng cấp, không đặc hiệu. Thuốc: Paracetamol 500 mg; Azithromycin 500 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N04 · Nội tổng quát · Tăng huyết áp, xin đơn 90 ngày

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Vũ Đình Khôi, nam, 64 tuổi (sinh 14/07/1962)
- Lý do đến khám (đã ghi lúc cấp số): Tái khám tăng huyết áp

**Kể với bác sĩ**

- Tái khám huyết áp, đang uống amlodipin 5 mg mỗi sáng, huyết áp ở nhà ổn.
- Sắp về quê ở với con 3 tháng, xin bác sĩ kê đủ thuốc 90 ngày.

**Chỉ nói khi bác sĩ hỏi**

- Không đau đầu, không phù chân, không hồi hộp.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Mạch: 72 lần/phút
- Huyết áp: 132/80 mmHg
- Cân nặng: 64 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Tim đều, không phù, phổi trong.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Tiền sử: Tăng huyết áp 5 năm, đang dùng amlodipin 5 mg
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Bệnh mạn tính, đơn 90 ngày; Ca thường, dùng đơn mẫu
- Bệnh mạn tính được kê tối đa 90 ngày (bệnh khác tối đa 30). Sửa "Số ngày" thành 90: máy không chặn vì chẩn đoán I10 là mạn tính.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Tăng huyết áp: tái khám cấp thuốc" (2) Amlodipin 5 mg: nhập số ngày 90 (3) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: I10 Tăng huyết áp vô căn (nguyên phát); Z76.0 Cấp lại đơn thuốc. Thuốc: Amlodipin 5 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N05 · Nội tổng quát · Tăng huyết áp và rối loạn lipid máu, kê lại đơn cũ

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Bùi Thị Kim Liên, nữ, 66 tuổi (sinh 30/05/1960)
- Lý do đến khám (đã ghi lúc cấp số): Tái khám, xin kê lại thuốc

**Kể với bác sĩ**

- Đến tái khám huyết áp và mỡ máu, xin kê lại đúng thuốc lần trước.
- Uống thuốc đều, không thấy khó chịu gì.

**Chỉ nói khi bác sĩ hỏi**

- Không đau cơ, không mệt.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Mạch: 70 lần/phút
- Huyết áp: 128/78 mmHg
- Cân nặng: 57 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Tim đều, không phù.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Tiền sử: Tăng huyết áp, rối loạn lipid máu
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): I10 Tăng huyết áp vô căn (nguyên phát); E78.5 Rối loạn lipid máu, không đặc hiệu. Đơn: Amlodipin 5 mg: 1 x 1 lần/ngày x 30 ngày; Atorvastatin 20 mg: 1 x 1 lần/ngày x 30 ngày

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ
- "Kê lại đơn này" một nút: thuốc, chẩn đoán và lời dặn của lượt khám cũ được điền sẵn.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: I10 Tăng huyết áp vô căn (nguyên phát); E78.5 Rối loạn lipid máu, không đặc hiệu. Thuốc: Amlodipin 5 mg; Atorvastatin 20 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N06 · Nội tổng quát · Viêm họng cấp, bệnh nhân xin thêm thuốc trùng hoạt chất

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Phan Quốc Việt, nam, 39 tuổi (sinh 22/06/1987)
- Lý do đến khám (đã ghi lúc cấp số): Đau họng, sốt

**Kể với bác sĩ**

- Đau họng, sốt 2 ngày.
- Lần trước bị y như vậy, uống "amoxicillin có thêm acid clavulanic" thì khỏi nhanh: xin bác sĩ kê thuốc đó.

**Chỉ nói khi bác sĩ hỏi**

- Không dị ứng thuốc.
- Không đau bụng, không tiêu chảy khi uống thuốc đó lần trước.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,3 °C
- Mạch: 90 lần/phút
- Huyết áp: 122/80 mmHg
- Cân nặng: 70 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Họng đỏ, amidan sưng, có mủ.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Trùng hoạt chất; Ca thường, dùng đơn mẫu
- Đơn mẫu đã có amoxicillin; thêm amoxicillin + acid clavulanic thì máy cảnh báo trùng hoạt chất amoxicillin. Ghi lại bác sĩ bỏ một trong hai hay ghi lý do.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Viêm họng cấp có chỉ định kháng sinh" (2) Thêm thuốc: gõ "amoxicillin clav", Enter: Amoxicillin + acid clavulanic 625 mg (3) Máy hiện cảnh báo: trùng hoạt chất (4) Bỏ Amoxicillin 500 mg (nút × ở dòng thuốc) (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J02.9 Viêm họng cấp, không đặc hiệu. Thuốc: Paracetamol 500 mg; Amoxicillin + acid clavulanic 625 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N07 · Nội tổng quát · Nhiễm trùng hô hấp trên

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Đặng Thị Ngọc Ánh, nữ, 25 tuổi (sinh 09/08/2001)
- Lý do đến khám (đã ghi lúc cấp số): Sổ mũi, ho, đau họng nhẹ

**Kể với bác sĩ**

- Sổ mũi nước trong, hắt hơi, ho khan 3 ngày.
- Đau họng nhẹ, không sốt.

**Chỉ nói khi bác sĩ hỏi**

- Không khó thở.
- Không dị ứng thuốc.
- Không có thai.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37 °C
- Mạch: 80 lần/phút
- Huyết áp: 108/70 mmHg
- Cân nặng: 48 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Niêm mạc mũi phù nề, họng hơi đỏ, phổi không ran.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Ca thường: đơn mẫu "Nhiễm trùng hô hấp trên cấp (không kháng sinh)".
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Nhiễm trùng hô hấp trên cấp (không kháng sinh)" (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Thuốc: Paracetamol 500 mg; Cetirizin 10 mg; Natri clorid 0,9% (nhỏ mũi)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N08 · Nội tổng quát · Đau thắt lưng, bệnh nhân dị ứng thuốc kháng viêm

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Ngô Văn Sáu, nam, 53 tuổi (sinh 02/05/1973)
- Lý do đến khám (đã ghi lúc cấp số): Đau lưng sau khi bê đồ nặng

**Kể với bác sĩ**

- Đau vùng thắt lưng 2 ngày nay sau khi bê chậu cây, cúi xuống đau tăng.
- Không lan xuống chân.

**Chỉ nói khi bác sĩ hỏi**

- Trước đây uống diclofenac thì sưng môi, sưng mắt (đã ghi trong hồ sơ).
- Không tê chân, tiểu tiện bình thường.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 36,7 °C
- Mạch: 78 lần/phút
- Huyết áp: 126/82 mmHg
- Cân nặng: 72 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Co cứng cơ cạnh cột sống thắt lưng hai bên, ấn đau. Nâng chân thẳng không đau, phản xạ gân xương bình thường.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: Thuốc kháng viêm không steroid (ibuprofen, diclofenac…)
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Có dị ứng thuốc đã ghi trong hồ sơ; Ca thường, dùng đơn mẫu
- Đơn mẫu đau lưng có meloxicam (thuốc kháng viêm không steroid): máy phải cảnh báo dị ứng. Thuốc dùng khi cần (paracetamol) phải tự nhập số lượng.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Đau vùng thắt lưng" (2) Máy hiện cảnh báo: dị ứng thuốc (3) Bỏ Meloxicam 7,5 mg (nút × ở dòng thuốc) (4) Bỏ Omeprazol 20 mg (nút × ở dòng thuốc) (5) Thêm thuốc: gõ "paracetamol 500", Enter: Paracetamol 500 mg (6) Máy hiện cảnh báo: thiếu liều hoặc số lượng (chặn ký cho tới khi nhập) (7) Paracetamol 500 mg: nhập số lượng 15 (8) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: M54.5 Đau vùng thắt lưng. Thuốc: Eperison 50 mg; Paracetamol 500 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N09 · Nội tổng quát · Đái tháo đường typ 2, kê lại và xin đơn 90 ngày

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Lý Thị Bích Vân, nữ, 60 tuổi (sinh 21/05/1966)
- Lý do đến khám (đã ghi lúc cấp số): Tái khám đái tháo đường

**Kể với bác sĩ**

- Tái khám tiểu đường, đường huyết đo ở nhà buổi sáng khoảng 6–7.
- Nhà xa, đi lại khó: xin bác sĩ kê thuốc cũ đủ 3 tháng.

**Chỉ nói khi bác sĩ hỏi**

- Không khát nhiều, không sụt cân, không tê chân.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Mạch: 76 lần/phút
- Huyết áp: 124/78 mmHg
- Cân nặng: 58 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Tim phổi bình thường, bàn chân không loét.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Tiền sử: Đái tháo đường typ 2, đang dùng metformin
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): E11.9 Đái tháo đường typ 2, không biến chứng. Đơn: Metformin 500 mg: 1 x 2 lần/ngày x 30 ngày

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ; Bệnh mạn tính, đơn 90 ngày
- Kê lại rồi sửa số ngày thành 90: được phép vì E11.9 là bệnh mạn tính.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Metformin 500 mg: nhập số ngày 90 (3) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: E11.9 Đái tháo đường typ 2, không biến chứng. Thuốc: Metformin 500 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N10 · Nội tổng quát · Tiêu chảy cấp

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Hồ Minh Trí, nam, 28 tuổi (sinh 11/05/1998)
- Lý do đến khám (đã ghi lúc cấp số): Đi ngoài phân lỏng từ đêm qua

**Kể với bác sĩ**

- Đi ngoài phân lỏng 5–6 lần từ đêm qua, sau khi ăn hải sản ở quán.
- Đau quặn bụng từng cơn, hơi mệt.

**Chỉ nói khi bác sĩ hỏi**

- Phân không có máu, không sốt, không nôn.
- Vẫn uống được nước.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37,1 °C
- Mạch: 86 lần/phút
- Huyết áp: 114/72 mmHg
- Cân nặng: 63 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bụng mềm, ấn đau nhẹ quanh rốn, không có dấu mất nước.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Ca thường: đơn mẫu "Tiêu chảy cấp (người lớn, không kháng sinh)".
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Tiêu chảy cấp (người lớn, không kháng sinh)" (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: A09 Tiêu chảy và viêm dạ dày - ruột do nhiễm khuẩn. Thuốc: Oresol (muối bù nước); Racecadotril 100 mg; Men vi sinh Lactobacillus

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N11 · Nội tổng quát · Viêm mũi dị ứng tái phát, kê lại đơn cũ

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Dương Thị Thanh Tâm, nữ, 42 tuổi (sinh 07/07/1984)
- Lý do đến khám (đã ghi lúc cấp số): Hắt hơi, ngạt mũi tái phát

**Kể với bác sĩ**

- Trời trở lạnh lại hắt hơi liên tục buổi sáng, ngạt mũi, chảy nước mũi trong.
- Lần trước bác sĩ kê thuốc uống thấy đỡ: xin kê lại.

**Chỉ nói khi bác sĩ hỏi**

- Không sốt, không đau đầu.
- Không dị ứng thuốc.
- Uống thuốc lần trước có hơi buồn ngủ nhưng chịu được.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 36,6 °C
- Mạch: 74 lần/phút
- Huyết áp: 112/72 mmHg
- Cân nặng: 53 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Niêm mạc mũi nhợt, phù nề, dịch trong.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Tiền sử: Viêm mũi dị ứng theo mùa
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): J30.4 Viêm mũi dị ứng, không đặc hiệu. Đơn: Cetirizin 10 mg: 1 x 1 lần/ngày x 14 ngày; Natri clorid 0,9% (nhỏ mũi): số lượng 1

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ
- "Kê lại đơn này" với đơn có thuốc nhỏ mũi (cách dùng gõ tay được mang sang).
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J30.4 Viêm mũi dị ứng, không đặc hiệu. Thuốc: Cetirizin 10 mg; Natri clorid 0,9% (nhỏ mũi)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### N12 · Nội tổng quát · Đái tháo đường typ 2, tăng liều metformin

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Trịnh Văn Lợi, nam, 57 tuổi (sinh 25/04/1969)
- Lý do đến khám (đã ghi lúc cấp số): Tái khám đái tháo đường, đường huyết còn cao

**Kể với bác sĩ**

- Tái khám tiểu đường. Đang uống metformin 500 mg sáng 1 viên, tối 1 viên.
- Đường huyết đo ở nhà buổi sáng vẫn 8–9.

**Chỉ nói khi bác sĩ hỏi**

- Uống thuốc đều, không đau bụng, không tiêu chảy.
- Không dị ứng thuốc.
- Ăn uống chưa kiêng được nhiều.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Mạch: 80 lần/phút
- Huyết áp: 130/82 mmHg
- Cân nặng: 74 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Tim phổi bình thường, bàn chân không loét.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Tiền sử: Đái tháo đường typ 2, đang dùng metformin 500 mg x 2
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): E11.9 Đái tháo đường typ 2, không biến chứng. Đơn: Metformin 500 mg: 1 x 2 lần/ngày x 30 ngày

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ; Trùng hoạt chất
- Kê lại đơn cũ rồi đổi hàm lượng: khi cả metformin 500 mg và 850 mg cùng nằm trong đơn, máy cảnh báo trùng hoạt chất cho tới khi bỏ một thuốc (hoặc ghi lý do).
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Thêm thuốc: gõ "metformin 850", Enter: Metformin 850 mg (3) Máy hiện cảnh báo: trùng hoạt chất (4) Bỏ Metformin 500 mg (nút × ở dòng thuốc) (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: E11.9 Đái tháo đường typ 2, không biến chứng. Thuốc: Metformin 850 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

## Nhi

### PL1 · Nhi · Sốt siêu vi (làm quen: đơn mẫu, nhập liều)

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.* **Ca làm quen: không tính vào số đo.**

**Người đóng vai**

- Bệnh nhân: Nguyễn Gia Huy, nam, 3 tuổi (sinh 15/05/2023)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Sốt từ đêm qua

**Kể với bác sĩ**

- Bé sốt từ đêm qua, cao nhất 38,8 độ, uống hạ sốt thì giảm.
- Vẫn chơi, ăn kém hơn mọi ngày.

**Chỉ nói khi bác sĩ hỏi**

- Không ho, không nôn, không tiêu chảy, không phát ban.
- Không dị ứng thuốc.
- Tiêm chủng đủ.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,6 °C
- Mạch: 118 lần/phút
- Cân nặng: 14 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bé tỉnh, họng hơi đỏ, phổi trong, không ban, cổ mềm.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Làm quen: thuốc dạng trẻ em để trống liều, bác sĩ phải nhập "Liều/lần" theo cân nặng thì mới ký được.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Sốt, nhiễm virus ở trẻ em" (2) Máy hiện cảnh báo: thiếu liều hoặc số lượng (chặn ký cho tới khi nhập) (3) Paracetamol 150 mg (gói): nhập liều/lần 1 (4) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: B34.9 Nhiễm virus, không đặc hiệu. Thuốc: Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### PL2 · Nhi · Ho, sổ mũi, chưa có cân nặng (làm quen: cảnh báo cân nặng)

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.* **Ca làm quen: không tính vào số đo.**

**Người đóng vai**

- Bệnh nhân: Trần Ngọc Bảo Anh, nữ, 4 tuổi (sinh 10/06/2022)
- Người đi cùng, nói chuyện với bác sĩ: Bố bé
- Lý do đến khám (đã ghi lúc cấp số): Ho, sổ mũi 3 ngày

**Kể với bác sĩ**

- Bé ho, sổ mũi 3 ngày, đêm ngạt mũi khó ngủ.
- Hôm qua sốt nhẹ 38 độ.

**Chỉ nói khi bác sĩ hỏi**

- Chưa cân cho bé ở phòng khám. Tuần trước cân ở trường mầm non là 16 kg.
- Không khó thở, bú và ăn được.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37,8 °C
- Mạch: 110 lần/phút
- Cân nặng: CHƯA CÂN (để trống)

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Mũi chảy dịch trong, họng đỏ nhẹ, phổi không ran, không co kéo.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Trẻ em chưa có cân nặng; Ca thường, dùng đơn mẫu
- Làm quen: phiếu điều dưỡng không có cân nặng nên máy cảnh báo. Bác sĩ hỏi người nhà rồi nhập cân nặng, hoặc ghi lý do.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Ho, sổ mũi ở trẻ em" (2) Máy hiện cảnh báo: trẻ chưa được ghi cân nặng (3) Hỏi người nhà rồi nhập cân nặng 16 kg (4) Paracetamol 150 mg (gói): nhập liều/lần 1 (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Thuốc: Natri clorid 0,9% (nhỏ mũi); Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### PL3 · Nhi · Ho, sổ mũi tái lại (làm quen: kê lại)

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.* **Ca làm quen: không tính vào số đo.**

**Người đóng vai**

- Bệnh nhân: Lê Minh Quân, nam, 5 tuổi (sinh 08/04/2021)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Ho, sổ mũi, sốt nhẹ

**Kể với bác sĩ**

- Bé lại ho, sổ mũi, sốt nhẹ giống đợt trước.
- Đợt trước bác sĩ kê thuốc uống 3 ngày là khỏi: xin kê lại.

**Chỉ nói khi bác sĩ hỏi**

- Không khó thở, không nôn.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38 °C
- Mạch: 104 lần/phút
- Cân nặng: 18 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Họng đỏ nhẹ, mũi chảy dịch trong, phổi không ran.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Đơn: Natri clorid 0,9% (nhỏ mũi): số lượng 2; Paracetamol 250 mg (gói): số lượng 6

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ
- Làm quen với nút "Kê lại đơn này": liều đã nhập ở lượt khám cũ được mang sang.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Thuốc: Natri clorid 0,9% (nhỏ mũi); Paracetamol 250 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P01 · Nhi · Sốt siêu vi

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Phạm Bảo Châu, nữ, 3 tuổi (sinh 22/07/2023)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Sốt 2 ngày

**Kể với bác sĩ**

- Bé sốt 2 ngày nay, lúc cao nhất 39 độ.
- Hạ sốt xong thì chơi bình thường, ăn ít hơn.

**Chỉ nói khi bác sĩ hỏi**

- Không ho, không sổ mũi, không tiêu chảy, không ban.
- Không co giật.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,7 °C
- Mạch: 122 lần/phút
- Cân nặng: 14 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bé tỉnh, họng đỏ nhẹ, phổi trong, không ban, cổ mềm.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Ca thường: đơn mẫu "Sốt, nhiễm virus ở trẻ em", nhập liều theo cân nặng.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Sốt, nhiễm virus ở trẻ em" (2) Paracetamol 150 mg (gói): nhập liều/lần 1 (3) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: B34.9 Nhiễm virus, không đặc hiệu. Thuốc: Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P02 · Nhi · Ho, sổ mũi

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Hoàng Gia Bảo, nam, 2 tuổi (sinh 30/08/2024)
- Người đi cùng, nói chuyện với bác sĩ: Bà nội
- Lý do đến khám (đã ghi lúc cấp số): Ho, sổ mũi 2 ngày

**Kể với bác sĩ**

- Cháu ho, chảy nước mũi 2 ngày, đêm ngạt mũi quấy khóc.
- Chiều qua sốt 38 độ.

**Chỉ nói khi bác sĩ hỏi**

- Không thở khò khè, vẫn ăn cháo và bú được.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38 °C
- Mạch: 124 lần/phút
- Cân nặng: 12 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Mũi chảy dịch trong, họng hơi đỏ, phổi không ran, không co kéo lồng ngực.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Ca thường: đơn mẫu "Ho, sổ mũi ở trẻ em", nhập liều theo cân nặng.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Ho, sổ mũi ở trẻ em" (2) Paracetamol 150 mg (gói): nhập liều/lần 1 (3) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Thuốc: Natri clorid 0,9% (nhỏ mũi); Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P03 · Nhi · Tiêu chảy cấp

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Vũ Ngọc Diệp, nữ, 20 tháng (sinh 14/02/2025)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Đi ngoài phân lỏng từ hôm qua

**Kể với bác sĩ**

- Bé đi ngoài phân lỏng, nhiều nước 6 lần từ hôm qua.
- Nôn 1 lần sáng nay.

**Chỉ nói khi bác sĩ hỏi**

- Phân không có máu, không nhầy.
- Vẫn bú mẹ và uống được nước, tiểu bình thường.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37,4 °C
- Mạch: 126 lần/phút
- Cân nặng: 11 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bé tỉnh, mắt không trũng, môi không khô, nếp véo da mất nhanh. Bụng mềm.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Ca thường: đơn mẫu "Tiêu chảy cấp ở trẻ em" (3 thuốc), nhập liều kẽm.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Tiêu chảy cấp ở trẻ em" (2) Máy hiện cảnh báo: thiếu liều hoặc số lượng (chặn ký cho tới khi nhập) (3) Kẽm 10 mg: nhập liều/lần 2 (4) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: A09 Tiêu chảy và viêm dạ dày - ruột do nhiễm khuẩn. Thuốc: Oresol (muối bù nước); Kẽm 10 mg; Men vi sinh Lactobacillus

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P04 · Nhi · Viêm amidan cấp, trẻ dị ứng penicillin

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Đặng Minh Khôi, nam, 7 tuổi (sinh 03/06/2019)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Sốt, đau họng

**Kể với bác sĩ**

- Bé sốt cao 39 độ 2 ngày, kêu đau họng, nuốt đau, bỏ ăn.
- Hơi thở hôi.

**Chỉ nói khi bác sĩ hỏi**

- Năm 4 tuổi uống amoxicillin thì nổi ban đỏ khắp người (đã ghi trong hồ sơ).
- Không ho, không khó thở.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 39 °C
- Mạch: 112 lần/phút
- Cân nặng: 24 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Amidan hai bên sưng to, đỏ, có mủ trắng. Hạch góc hàm sưng đau. Phổi trong.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: Penicillin (amoxicillin…)
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Có dị ứng thuốc đã ghi trong hồ sơ; Không có đơn mẫu, kê từng thuốc
- Không có đơn mẫu: bác sĩ gõ chẩn đoán và từng thuốc. Nếu chọn amoxicillin, máy phải cảnh báo dị ứng penicillin. Ghi lại bác sĩ chọn thuốc nào; cố vấn y khoa cần cho ý kiến về lựa chọn thay thế trong bài diễn tập (cefixim).
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Gõ chẩn đoán "J03", Enter: J03.9 Viêm amidan cấp, không đặc hiệu (2) Thêm thuốc: gõ "amoxicillin 250", Enter: Amoxicillin 250 mg (gói) (3) Máy hiện cảnh báo: dị ứng thuốc (4) Bỏ Amoxicillin 250 mg (gói) (nút × ở dòng thuốc) (5) Thêm thuốc: gõ "cefixim 100", Enter: Cefixim 100 mg (gói) (6) Cefixim 100 mg (gói): nhập liều/lần 1 (7) Thêm thuốc: gõ "paracetamol 250", Enter: Paracetamol 250 mg (gói) (8) Paracetamol 250 mg (gói): nhập liều/lần 1, số lượng 6 (9) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J03.9 Viêm amidan cấp, không đặc hiệu. Thuốc: Cefixim 100 mg (gói); Paracetamol 250 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P05 · Nhi · Sốt, phiếu chưa có cân nặng (hỏi được)

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Bùi Thảo Nguyên, nữ, 4 tuổi (sinh 19/05/2022)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Sốt từ sáng

**Kể với bác sĩ**

- Bé sốt từ sáng nay 38,5 độ, hơi mệt, vẫn uống sữa được.
- Ở lớp đang có mấy bạn sốt.

**Chỉ nói khi bác sĩ hỏi**

- Hôm nay chưa cân. Tuần trước cân ở trường là 16 kg.
- Không ho, không nôn, không ban.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,5 °C
- Mạch: 116 lần/phút
- Cân nặng: CHƯA CÂN (để trống)

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bé tỉnh, họng đỏ nhẹ, phổi trong, không ban.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Trẻ em chưa có cân nặng; Ca thường, dùng đơn mẫu
- Phiếu điều dưỡng không có cân nặng: máy cảnh báo "trẻ chưa được ghi cân nặng". Người nhà chỉ nói cân nặng khi bác sĩ hỏi. Ghi lại bác sĩ nhập cân nặng hay ghi lý do.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Sốt, nhiễm virus ở trẻ em" (2) Máy hiện cảnh báo: trẻ chưa được ghi cân nặng (3) Hỏi người nhà rồi nhập cân nặng 16 kg (4) Paracetamol 150 mg (gói): nhập liều/lần 1 (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: B34.9 Nhiễm virus, không đặc hiệu. Thuốc: Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P06 · Nhi · Sổ mũi ở trẻ nhũ nhi, không cân được

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Ngô Đức Anh, nam, 9 tháng (sinh 20/01/2026)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Sổ mũi, ngạt mũi

**Kể với bác sĩ**

- Bé sổ mũi, ngạt mũi 2 ngày, bú hay phải nhả ra để thở.
- Không sốt.

**Chỉ nói khi bác sĩ hỏi**

- Cân của phòng khám đang hỏng nên chưa cân. Mẹ không nhớ cân nặng lần cân gần nhất.
- Không ho nhiều, không khò khè.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37 °C
- Mạch: 130 lần/phút
- Cân nặng: CHƯA CÂN (để trống)

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Mũi nhiều dịch trong, họng không đỏ, phổi không ran, không co kéo.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Trẻ em chưa có cân nặng; Ca thường, dùng đơn mẫu
- Không lấy được cân nặng: bác sĩ phải ghi lý do thì mới ký được. Trong bài diễn tập, đơn chỉ còn nước muối nhỏ mũi nên lý do là "không có thuốc tính theo cân nặng".
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Ho, sổ mũi ở trẻ em" (2) Bỏ Paracetamol 150 mg (gói) (nút × ở dòng thuốc) (3) Máy hiện cảnh báo: trẻ chưa được ghi cân nặng (4) Ghi lý do ở cảnh báo "trẻ chưa được ghi cân nặng": "Chỉ kê nước muối nhỏ mũi, không có thuốc tính theo cân nặng" (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Thuốc: Natri clorid 0,9% (nhỏ mũi)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P07 · Nhi · Sốt siêu vi, đổi hàm lượng thuốc hạ sốt

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Lý Hải Đăng, nam, 6 tuổi (sinh 12/09/2020)
- Người đi cùng, nói chuyện với bác sĩ: Bố bé
- Lý do đến khám (đã ghi lúc cấp số): Sốt 1 ngày

**Kể với bác sĩ**

- Bé sốt từ chiều qua, 38,8 độ, kêu đau đầu, mỏi người.
- Ở nhà còn gói hạ sốt 150 mg của em bé, uống 1 gói không thấy hạ.

**Chỉ nói khi bác sĩ hỏi**

- Không ho, không nôn, không ban.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,8 °C
- Mạch: 108 lần/phút
- Cân nặng: 20 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bé tỉnh, họng đỏ nhẹ, phổi trong, cổ mềm, không ban.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Trùng hoạt chất; Ca thường, dùng đơn mẫu
- Đơn mẫu có gói 150 mg; bé 20 kg nên bác sĩ có thể đổi sang gói 250 mg. Khi cả hai cùng nằm trong đơn, máy cảnh báo trùng hoạt chất paracetamol.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Sốt, nhiễm virus ở trẻ em" (2) Thêm thuốc: gõ "paracetamol 250", Enter: Paracetamol 250 mg (gói) (3) Máy hiện cảnh báo: trùng hoạt chất (4) Bỏ Paracetamol 150 mg (gói) (nút × ở dòng thuốc) (5) Paracetamol 250 mg (gói): nhập liều/lần 1, số lượng 6 (6) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: B34.9 Nhiễm virus, không đặc hiệu. Thuốc: Paracetamol 250 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P08 · Nhi · Ho, sổ mũi tái lại, kê lại đơn cũ

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Đỗ Khánh Linh, nữ, 4 tuổi (sinh 02/04/2022)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Ho, sổ mũi, sốt nhẹ

**Kể với bác sĩ**

- Bé ho, sổ mũi lại 2 ngày nay, tối qua sốt 38 độ.
- Đợt trước bác sĩ kê nước muối và hạ sốt, 3 ngày thì khỏi: xin kê lại như cũ.

**Chỉ nói khi bác sĩ hỏi**

- Không khó thở, ăn được.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37,9 °C
- Mạch: 108 lần/phút
- Cân nặng: 16 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Mũi chảy dịch trong, họng đỏ nhẹ, phổi không ran.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Đơn: Natri clorid 0,9% (nhỏ mũi): số lượng 2; Paracetamol 150 mg (gói): số lượng 6

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ
- "Kê lại đơn này" một nút: liều đã nhập ở lượt khám cũ được mang sang.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J06.9 Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu. Thuốc: Natri clorid 0,9% (nhỏ mũi); Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P09 · Nhi · Hen ở thiếu niên, kê lại và xin đơn 90 ngày

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Trịnh Quốc Bảo, nam, 15 tuổi (sinh 25/05/2011)
- Người đi cùng, nói chuyện với bác sĩ: Bố cháu (cháu tự kể được)
- Lý do đến khám (đã ghi lúc cấp số): Tái khám hen, hết thuốc

**Kể với bác sĩ**

- Cháu bị hen từ nhỏ, đang uống thuốc dự phòng mỗi tối, 3 tháng nay không lên cơn.
- Cháu sắp vào kỳ thi và ở nội trú: xin bác sĩ kê thuốc cũ đủ 3 tháng.

**Chỉ nói khi bác sĩ hỏi**

- Không ho đêm, không khò khè, chơi thể thao được.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Mạch: 82 lần/phút
- Nhịp thở: 18 lần/phút
- SpO2: 98 %
- Cân nặng: 52 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Phổi thông khí đều hai bên, không ran rít, không ran ngáy.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Tiền sử: Hen phế quản từ nhỏ
- Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): J45.9 Hen, không đặc hiệu. Đơn: Montelukast 10 mg: 1 x 1 lần/ngày x 30 ngày

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: "Kê lại" đơn của lượt khám cũ; Bệnh mạn tính, đơn 90 ngày
- Kê lại rồi sửa số ngày thành 90: được phép vì J45.9 (hen) là bệnh mạn tính. Bệnh nhân 15 tuổi nên đã có CCCD.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái) (2) Montelukast 10 mg: nhập số ngày 90 (3) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: J45.9 Hen, không đặc hiệu. Thuốc: Montelukast 10 mg

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P10 · Nhi · Sốt, trẻ dị ứng ibuprofen, người nhà xin ibuprofen

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Phan Nhã Uyên, nữ, 3 tuổi (sinh 27/06/2023)
- Người đi cùng, nói chuyện với bác sĩ: Bà ngoại
- Lý do đến khám (đã ghi lúc cấp số): Sốt cao từ đêm

**Kể với bác sĩ**

- Cháu sốt từ đêm, 39 độ, quấy khóc.
- Hàng xóm bảo siro ibuprofen hạ sốt nhanh hơn: xin bác sĩ kê cho cháu siro ibuprofen.

**Chỉ nói khi bác sĩ hỏi**

- Mẹ cháu dặn là cháu từng nổi mề đay sau khi uống ibuprofen (đã ghi trong hồ sơ), bà không nhớ rõ.
- Không ho, không nôn, không ban.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 39 °C
- Mạch: 128 lần/phút
- Cân nặng: 15 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bé tỉnh, họng đỏ nhẹ, phổi trong, cổ mềm, không ban.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: Ibuprofen
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Có dị ứng thuốc đã ghi trong hồ sơ; Ca thường, dùng đơn mẫu
- Người nhà xin đúng thuốc trẻ dị ứng. Nếu bác sĩ thêm ibuprofen, máy phải cảnh báo dị ứng (dị ứng ghi theo hoạt chất). Bác sĩ đọc cột dị ứng và từ chối ngay cũng là kết quả đúng: ghi lại.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Sốt, nhiễm virus ở trẻ em" (2) Paracetamol 150 mg (gói): nhập liều/lần 1 (3) Thêm thuốc: gõ "ibuprofen siro", Enter: Ibuprofen 100 mg/5 ml (siro) (4) Máy hiện cảnh báo: dị ứng thuốc (5) Bỏ Ibuprofen 100 mg/5 ml (siro) (nút × ở dòng thuốc) (6) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: B34.9 Nhiễm virus, không đặc hiệu. Thuốc: Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P11 · Nhi · Tiêu chảy cấp ở trẻ lớn, thêm thuốc vào đơn mẫu

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Hồ Tuấn Kiệt, nam, 8 tuổi (sinh 16/08/2018)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Đi ngoài phân lỏng, đau bụng

**Kể với bác sĩ**

- Cháu đi ngoài phân lỏng 7–8 lần từ hôm qua sau khi ăn liên hoan ở lớp.
- Đau bụng quanh rốn từng cơn.

**Chỉ nói khi bác sĩ hỏi**

- Phân không máu, sốt nhẹ 37,8 độ, không nôn.
- Uống được nước.
- Không dị ứng thuốc.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 37,8 °C
- Mạch: 98 lần/phút
- Cân nặng: 26 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Bụng mềm, ấn đau nhẹ quanh rốn, không có dấu mất nước.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Ca thường, dùng đơn mẫu
- Đơn mẫu rồi thêm một thuốc bằng ô "Thêm thuốc" và sửa số ngày.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Chọn đơn mẫu "Tiêu chảy cấp ở trẻ em" (2) Kẽm 10 mg: nhập liều/lần 2 (3) Thêm thuốc: gõ "racecadotril 30", Enter: Racecadotril 30 mg (gói) (4) Racecadotril 30 mg (gói): nhập liều/lần 1, số ngày 3 (5) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: A09 Tiêu chảy và viêm dạ dày - ruột do nhiễm khuẩn. Thuốc: Oresol (muối bù nước); Kẽm 10 mg; Men vi sinh Lactobacillus; Racecadotril 30 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................

### P12 · Nhi · Viêm tai giữa cấp, không có đơn mẫu

*DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.*

**Người đóng vai**

- Bệnh nhân: Dương Minh Anh, nữ, 4 tuổi (sinh 05/09/2022)
- Người đi cùng, nói chuyện với bác sĩ: Mẹ bé
- Lý do đến khám (đã ghi lúc cấp số): Đau tai, sốt

**Kể với bác sĩ**

- Bé kêu đau tai phải từ đêm qua, khóc nhiều, sốt 38,5 độ.
- Mấy hôm trước bị sổ mũi.

**Chỉ nói khi bác sĩ hỏi**

- Tai không chảy mủ.
- Không dị ứng thuốc.
- Chưa uống kháng sinh đợt này.

**Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)**

- Nhiệt độ: 38,5 °C
- Mạch: 114 lần/phút
- Cân nặng: 16 kg

**Kết quả khám (điều phối viên đọc khi bác sĩ khám)**

- Màng nhĩ phải đỏ, phồng, chưa thủng. Tai trái bình thường. Họng đỏ nhẹ.

**Đã có sẵn trong hồ sơ trên máy**

- Dị ứng: chưa ghi nhận
- Lịch sử khám: lần đầu đến khám

**Dành cho điều phối viên (không đọc cho bác sĩ)**

- Tình huống: Không có đơn mẫu, kê từng thuốc
- Không có đơn mẫu: bác sĩ gõ tắt chẩn đoán và từng thuốc, nhập liều theo cân nặng. Đo phần chậm nhất của màn hình kê đơn.
- Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): (1) Gõ chẩn đoán "H66", Enter: H66.9 Viêm tai giữa, không đặc hiệu (2) Thêm thuốc: gõ "amoxicillin 250", Enter: Amoxicillin 250 mg (gói) (3) Amoxicillin 250 mg (gói): nhập liều/lần 1 (4) Thêm thuốc: gõ "paracetamol 150", Enter: Paracetamol 150 mg (gói) (5) Paracetamol 150 mg (gói): nhập liều/lần 1, số lượng 6 (6) Bấm "Ký & In"
- Đơn cuối của bài diễn tập: H66.9 Viêm tai giữa, không đặc hiệu. Thuốc: Amoxicillin 250 mg (gói); Paracetamol 150 mg (gói)

**Cố vấn y khoa duyệt**

- [ ] Dùng được   [ ] Cần sửa: ............................................................
- Người duyệt, ngày: ....................................
