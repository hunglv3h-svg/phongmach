#!/usr/bin/env python3
"""Sinh trang-thai-chuc-nang.docx từ trang-thai-chuc-nang.md.

Cách chạy (từ thư mục gốc worktree):

    python scripts/md-to-docx.py

Không cần pandoc hay libreoffice — chỉ dùng python-docx (đã cài sẵn, 1.2.0).
Hỗ trợ: tiêu đề `#`/`##`/`###`, bảng markdown `| ... |` (kẻ khung 'Table Grid'),
đoạn văn, danh sách `-`/`*`/`1.`, và trích dẫn `>`. Giữ nguyên ký hiệu Unicode
✅ 🟡 🔧 ⬜ nhờ dùng font Calibri (hỗ trợ tiếng Việt). Markdown phức tạp (ảnh, khối
mã lồng nhau) không cần cho tài liệu này nên không xử lý.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.shared import Pt

# Đặt tên cố định: script đọc .md ở gốc worktree và ghi .docx cùng chỗ.
ROOT = Path(__file__).resolve().parent.parent
MD_PATH = ROOT / "trang-thai-chuc-nang.md"
DOCX_PATH = ROOT / "trang-thai-chuc-nang.docx"

# Font hỗ trợ tiếng Việt; Calibri có sẵn trên Windows và không lỗi dấu/ký hiệu Unicode.
BODY_FONT = "Calibri"

# Loại bỏ **đậm**, *nghiêng*, `mã` và [text](url) → text, giữ lại nội dung đọc được.
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
_CODE = re.compile(r"`([^`]+)`")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def clean_inline(text: str) -> str:
    """Bỏ cú pháp inline của markdown, giữ lại chữ (kể cả ký hiệu Unicode)."""
    text = _LINK.sub(r"\1", text)
    text = _BOLD.sub(r"\1", text)
    text = _ITALIC.sub(r"\1", text)
    text = _CODE.sub(r"\1", text)
    return text.strip()


def split_table_row(line: str) -> list[str]:
    """Tách một dòng `| a | b |` thành các ô, bỏ `|` đầu/cuối."""
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [clean_inline(cell.strip()) for cell in s.split("|")]


def is_table_separator(line: str) -> bool:
    """Dòng ngăn cách tiêu đề bảng, ví dụ `|---|---|` hoặc `|:--|--:|`."""
    s = line.strip()
    if "|" not in s or not set(s) <= set("|-: "):
        return False
    return "-" in s


def set_body_font(document: Document) -> None:
    """Đặt font mặc định cho toàn tài liệu để tiếng Việt hiển thị đúng."""
    style = document.styles["Normal"]
    style.font.name = BODY_FONT
    style.font.size = Pt(11)


def add_table(document: Document, rows: list[list[str]]) -> None:
    """Dựng bảng Word có kẻ khung từ các dòng markdown (dòng đầu là tiêu đề)."""
    if not rows:
        return
    cols = max(len(r) for r in rows)
    table = document.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    for i, row in enumerate(rows):
        cells = table.rows[i].cells
        for j in range(cols):
            text = row[j] if j < len(row) else ""
            cells[j].text = text
            for paragraph in cells[j].paragraphs:
                for run in paragraph.runs:
                    run.font.name = BODY_FONT
                    if i == 0:
                        run.font.bold = True


def convert(md_text: str) -> Document:
    document = Document()
    set_body_font(document)

    lines = md_text.splitlines()
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        # Dòng trống: bỏ qua.
        if not stripped:
            i += 1
            continue

        # Ngăn cách `---` / `***` giữa các mục: bỏ qua (không vẽ gì).
        if set(stripped) <= set("-*_") and len(stripped) >= 3:
            i += 1
            continue

        # Tiêu đề.
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            level = len(heading.group(1))
            document.add_heading(clean_inline(heading.group(2)), level=min(level, 4))
            i += 1
            continue

        # Bảng: dòng hiện tại và dòng sau đều có `|`, dòng sau là ngăn cách.
        if "|" in line and i + 1 < n and is_table_separator(lines[i + 1]):
            header = split_table_row(line)
            rows = [header]
            i += 2  # bỏ qua dòng ngăn cách
            while i < n and "|" in lines[i] and lines[i].strip():
                rows.append(split_table_row(lines[i]))
                i += 1
            add_table(document, rows)
            continue

        # Trích dẫn `>`.
        if stripped.startswith(">"):
            quote = clean_inline(stripped.lstrip(">").strip())
            para = document.add_paragraph(quote)
            para.style = "Intense Quote" if "Intense Quote" in [s.name for s in document.styles] else para.style
            i += 1
            continue

        # Danh sách có thứ tự.
        ordered = re.match(r"^\d+\.\s+(.*)$", stripped)
        if ordered:
            document.add_paragraph(clean_inline(ordered.group(1)), style="List Number")
            i += 1
            continue

        # Danh sách không thứ tự.
        bullet = re.match(r"^[-*+]\s+(.*)$", stripped)
        if bullet:
            document.add_paragraph(clean_inline(bullet.group(1)), style="List Bullet")
            i += 1
            continue

        # Đoạn văn thường (gộp các dòng liền nhau không rỗng, không phải cấu trúc khác).
        buffer = [clean_inline(stripped)]
        i += 1
        while i < n:
            nxt = lines[i].strip()
            if (
                not nxt
                or nxt.startswith(("#", ">", "-", "*", "+", "|"))
                or re.match(r"^\d+\.\s+", nxt)
            ):
                break
            buffer.append(clean_inline(nxt))
            i += 1
        document.add_paragraph(" ".join(buffer))

    return document


def main() -> int:
    if not MD_PATH.exists():
        print(f"Không tìm thấy {MD_PATH}", file=sys.stderr)
        return 1
    document = convert(MD_PATH.read_text(encoding="utf-8"))
    document.save(DOCX_PATH)
    print(f"Đã sinh {DOCX_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
