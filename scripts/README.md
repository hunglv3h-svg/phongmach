# scripts

## md-to-docx.py

Sinh `trang-thai-chuc-nang.docx` (bản dễ đọc, có hàng lối) từ `trang-thai-chuc-nang.md`
ở thư mục gốc worktree.

Chạy từ gốc worktree:

```bash
python scripts/md-to-docx.py
```

Yêu cầu: Python 3 + `python-docx` (1.2.0, đã cài sẵn). Không cần pandoc/libreoffice.

Script hỗ trợ tiêu đề (`#`/`##`/`###`), bảng markdown (kẻ khung 'Table Grid'),
đoạn văn, danh sách và trích dẫn `>`. Giữ nguyên ký hiệu ✅ 🟡 🔧 ⬜ và dấu tiếng Việt
(font Calibri). Chạy lại script mỗi khi `.md` thay đổi để `.docx` khớp.
