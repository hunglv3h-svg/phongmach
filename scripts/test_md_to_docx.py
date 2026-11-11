"""Kiểm nhanh md-to-docx.py. Chạy: python scripts/test_md_to_docx.py (im lặng nếu đạt)."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("md_to_docx", Path(__file__).with_name("md-to-docx.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

SAMPLE = """# Tiêu đề

Đoạn có **đậm** và `mã`.

| Mã | Trạng thái |
|---|---|
| T-X | **⏳** |

```text
Mục tiêu
- dòng trong khối mã không phải danh sách
| cũng không phải bảng |
```

1. mục một
  - con
"""

doc = m.convert(SAMPLE)
paras = doc.paragraphs
code = [p.text for p in paras if p.style.name == m.CODE_STYLE]
assert code == ["Mục tiêu", "- dòng trong khối mã không phải danh sách", "| cũng không phải bảng |"], code
assert len(doc.tables) == 1 and doc.tables[0].cell(1, 1).text == "⏳"
assert doc.tables[0].cell(1, 1).paragraphs[0].runs[0].bold
bold = [r.text for p in paras for r in p.runs if r.bold]
assert "đậm" in bold, bold
assert any(r.font.name == m.CODE_FONT and r.text == "mã" for p in paras for r in p.runs)
assert any(p.text == "1. mục một" for p in paras)
assert any(p.style.name == "List Bullet 2" and p.text == "con" for p in paras)

# Độ rộng cột: tổng bằng bề ngang trang; cột chữ dài rộng hơn cột trống; cột trống vẫn đủ cho 4 ký tự.
rows = [["Mã", "Việc", "PR"], ["T-IDEM-2a", "Một việc có mô tả khá dài cần nhiều chỗ hơn", ""]]
w = m.column_widths_cm(rows, 3)
assert abs(sum(w) - m.TEXT_WIDTH_CM) < 1e-6, w
assert w[1] > w[0] > w[2] >= 5 * m.CHAR_CM + m.CELL_PAD_CM, w
