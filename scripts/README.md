# scripts

## md-to-docx.py

Sinh bản Word (.docx) dễ đọc từ tệp markdown của dự án, đặt cạnh tệp .md cùng tên.

Chạy từ gốc worktree:

```bash
python scripts/md-to-docx.py                                                   # trang-thai-chuc-nang.md
python scripts/md-to-docx.py docs/ke-hoach-trien-khai.md trang-thai-chuc-nang.md
```

Yêu cầu: Python 3 + `python-docx` (1.2.0, đã cài sẵn). Không cần pandoc/libreoffice.

Script hỗ trợ tiêu đề `#`…`######`, bảng markdown (kẻ khung, chia độ rộng cột theo nội dung),
đoạn văn, danh sách (thụt một cấp), trích dẫn `>`, khối mã ``` (nền xám, chữ Consolas: dùng cho các
prompt ở kế hoạch mục 11) và chữ **đậm** / `mã` trong dòng. Khổ A4, lề 2 cm. Giữ nguyên ký hiệu
✅ 🟡 🔧 ⬜ ⏳ 🚧 và dấu tiếng Việt. Chạy lại script mỗi khi `.md` thay đổi để `.docx` khớp: tệp .docx
được sinh lại hoàn toàn, sửa thẳng trong Word sẽ mất.

Kiểm nhanh sau khi sửa script: `python scripts/test_md_to_docx.py` (im lặng nếu đạt).
