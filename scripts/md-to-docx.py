#!/usr/bin/env python3
"""Sinh tệp .docx (Word) từ tệp markdown của dự án, đặt cạnh tệp .md cùng tên.

Cách chạy (từ thư mục gốc worktree):

    python scripts/md-to-docx.py                                   # trang-thai-chuc-nang.md
    python scripts/md-to-docx.py docs/ke-hoach-trien-khai.md       # một hay nhiều tệp

Không cần pandoc hay libreoffice — chỉ dùng python-docx (đã cài sẵn, 1.2.0).
Hỗ trợ: tiêu đề `#`…`######`, bảng `| ... |` (kẻ khung 'Table Grid'), đoạn văn, danh sách `-`/`*`/`1.`
(kể cả thụt lề một cấp), trích dẫn `>`, khối mã ``` (nền xám, chữ Consolas, để chép prompt), chữ **đậm**
và `mã` trong dòng. Khổ A4. Markdown khác (ảnh, HTML) không cần cho tài liệu dự án nên không xử lý.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Mm, Pt

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MD = ROOT / "trang-thai-chuc-nang.md"

# Font hỗ trợ tiếng Việt; Calibri có sẵn trên Windows và không lỗi dấu/ký hiệu Unicode.
BODY_FONT = "Calibri"
CODE_FONT = "Consolas"
CODE_STYLE = "Khối mã"
TEXT_WIDTH_CM = 17  # A4 rộng 21 cm trừ hai lề 2 cm
TABLE_FONT_PT = 10
CHAR_CM = 0.18  # bề ngang trung bình một ký tự Calibri 10 pt
CELL_PAD_CM = 0.4  # lề trái + phải của ô

_BOLD_OR_CODE = re.compile(r"\*\*(.+?)\*\*|`([^`]+)`")
_ITALIC = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
_CODE = re.compile(r"`([^`]+)`")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def clean_inline(text: str) -> str:
    """Bỏ cú pháp inline của markdown, giữ lại chữ (dùng cho tiêu đề)."""
    text = _LINK.sub(r"\1", text)
    text = _BOLD.sub(r"\1", text)
    text = _ITALIC.sub(r"\1", text)
    text = _CODE.sub(r"\1", text)
    return text.strip()


def add_inline(paragraph, text: str, bold: bool = False) -> None:
    """Thêm chữ vào đoạn, giữ **đậm** và `mã` thành run riêng; *nghiêng* và [link](url) chỉ giữ chữ."""
    text = _LINK.sub(r"\1", text)
    pos = 0
    for m in _BOLD_OR_CODE.finditer(text):
        _add_plain(paragraph, text[pos : m.start()], bold)
        if m.group(1) is not None:
            add_inline(paragraph, m.group(1), bold=True)
        else:
            run = paragraph.add_run(m.group(2))
            run.font.name = CODE_FONT
            run.bold = bold or None
        pos = m.end()
    _add_plain(paragraph, text[pos:], bold)


def _add_plain(paragraph, text: str, bold: bool) -> None:
    if text:
        run = paragraph.add_run(_ITALIC.sub(r"\1", text))
        run.bold = bold or None


def split_table_row(line: str) -> list[str]:
    """Tách một dòng `| a | b |` thành các ô, bỏ `|` đầu/cuối."""
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [cell.strip() for cell in s.split("|")]


def is_table_separator(line: str) -> bool:
    """Dòng ngăn cách tiêu đề bảng, ví dụ `|---|---|` hoặc `|:--|--:|`."""
    s = line.strip()
    if "|" not in s or not set(s) <= set("|-: "):
        return False
    return "-" in s


def setup_document(document: Document) -> None:
    """Khổ A4, lề 2 cm, font mặc định tiếng Việt, và kiểu đoạn cho khối mã."""
    for section in document.sections:
        section.page_width, section.page_height = Mm(210), Mm(297)
        section.left_margin = section.right_margin = Cm(2)
        section.top_margin = section.bottom_margin = Cm(2)
    normal = document.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(11)

    code = document.styles.add_style(CODE_STYLE, 1)  # 1 = kiểu đoạn
    code.base_style = normal
    code.font.name = CODE_FONT
    code.font.size = Pt(9)
    # Nền xám: `w:shd` phải đứng trước `w:spacing`/`w:ind` trong pPr, nên thêm trước khi đặt khoảng cách.
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "F2F2F2")
    code.element.get_or_add_pPr().append(shd)
    code.paragraph_format.space_before = Pt(0)
    code.paragraph_format.space_after = Pt(0)
    code.paragraph_format.line_spacing = 1.0


def add_table(document: Document, rows: list[list[str]]) -> None:
    """Dựng bảng Word có kẻ khung từ các dòng markdown (dòng đầu là tiêu đề)."""
    if not rows:
        return
    cols = max(len(r) for r in rows)
    table = document.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    table.autofit = False
    widths = [Cm(w) for w in column_widths_cm(rows, cols)]
    for j, column in enumerate(table.columns):
        column.width = widths[j]
    for i, row in enumerate(rows):
        cells = table.rows[i].cells
        for j in range(cols):
            cells[j].width = widths[j]
            paragraph = cells[j].paragraphs[0]
            add_inline(paragraph, row[j] if j < len(row) else "", bold=(i == 0))
            for run in paragraph.runs:
                run.font.size = Pt(TABLE_FONT_PT)


def column_widths_cm(rows: list[list[str]], cols: int) -> list[float]:
    """Mỗi cột trước hết đủ rộng cho từ dài nhất của nó (chặn 4–14 ký tự, để mã dài không ép cột khác),
    phần còn lại chia theo độ dài chữ dài nhất của cột (chặn 45 ký tự)."""
    texts = [[clean_inline(r[j]) if j < len(r) else "" for r in rows] for j in range(cols)]
    longest_word = [min(14, max(4, *(len(w) for t in col for w in t.split()), 0)) for col in texts]
    longest_text = [min(45, max(len(t) for t in col)) or 1 for col in texts]
    mins = [(w + 1) * CHAR_CM + CELL_PAD_CM for w in longest_word]
    rest = TEXT_WIDTH_CM - sum(mins)
    if rest <= 0:
        return [TEXT_WIDTH_CM * m / sum(mins) for m in mins]
    return [m + rest * t / sum(longest_text) for m, t in zip(mins, longest_text)]


def list_level(line: str) -> int:
    """Cấp danh sách theo số khoảng trắng đầu dòng: 0–1 → 1, 2–3 → 2, từ 4 → 3."""
    indent = len(line) - len(line.lstrip(" "))
    return min(1 + indent // 2, 3)


def convert(md_text: str) -> Document:
    document = Document()
    setup_document(document)

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

        # Khối mã ```: mỗi dòng một đoạn kiểu "Khối mã", giữ nguyên khoảng trắng đầu dòng.
        if stripped.startswith("```"):
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                document.add_paragraph(lines[i].rstrip(), style=CODE_STYLE)
                i += 1
            i += 1  # bỏ dòng ``` đóng
            document.add_paragraph()
            continue

        # Ngăn cách `---` / `***` giữa các mục: bỏ qua (không vẽ gì).
        if set(stripped) <= set("-*_") and len(stripped) >= 3:
            i += 1
            continue

        # Tiêu đề.
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            document.add_heading(clean_inline(heading.group(2)), level=len(heading.group(1)))
            i += 1
            continue

        # Bảng: dòng hiện tại và dòng sau đều có `|`, dòng sau là ngăn cách.
        if "|" in line and i + 1 < n and is_table_separator(lines[i + 1]):
            rows = [split_table_row(line)]
            i += 2  # bỏ qua dòng ngăn cách
            while i < n and "|" in lines[i] and lines[i].strip():
                rows.append(split_table_row(lines[i]))
                i += 1
            add_table(document, rows)
            continue

        # Trích dẫn `>`: gộp các dòng liền nhau; dòng `>` rỗng tách đoạn.
        if stripped.startswith(">"):
            parts: list[str] = []
            while i < n and lines[i].strip().startswith(">"):
                parts.append(lines[i].strip().lstrip(">").strip())
                i += 1
            for block in "\n".join(parts).split("\n\n"):
                if block.strip():
                    para = document.add_paragraph(style="Intense Quote")
                    add_inline(para, " ".join(block.split("\n")))
            continue

        # Danh sách có thứ tự: giữ nguyên số trong markdown (kiểu List Number của Word đánh số liền cả tài liệu).
        ordered = re.match(r"^(\d+\.)\s+(.*)$", stripped)
        if ordered:
            para = document.add_paragraph()
            para.paragraph_format.left_indent = Cm(0.7 * list_level(line))
            para.paragraph_format.first_line_indent = Cm(-0.7)
            add_inline(para, f"{ordered.group(1)} {ordered.group(2)}")
            i += 1
            continue

        # Danh sách không thứ tự.
        bullet = re.match(r"^[-*+]\s+(.*)$", stripped)
        if bullet:
            level = list_level(line)
            para = document.add_paragraph(style="List Bullet" if level == 1 else f"List Bullet {level}")
            add_inline(para, bullet.group(1))
            i += 1
            continue

        # Đoạn văn thường (gộp các dòng liền nhau không rỗng, không phải cấu trúc khác).
        buffer = [stripped]
        i += 1
        while i < n:
            nxt = lines[i].strip()
            if (
                not nxt
                or nxt.startswith(("#", ">", "|", "```"))
                or (set(nxt) <= set("-*_") and len(nxt) >= 3)
                or re.match(r"^[-*+]\s+", nxt)
                or re.match(r"^\d+\.\s+", nxt)
            ):
                break
            buffer.append(nxt)
            i += 1
        add_inline(document.add_paragraph(), " ".join(buffer))

    return document


def main(argv: list[str]) -> int:
    # Cửa sổ lệnh Windows mặc định cp1252: không in được tiếng Việt, script thoát mã 1 dù đã lưu .docx.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    paths = [Path(a) for a in argv] or [DEFAULT_MD]
    for md_path in paths:
        if not md_path.exists():
            print(f"Không tìm thấy {md_path}", file=sys.stderr)
            return 1
        docx_path = md_path.with_suffix(".docx")
        convert(md_path.read_text(encoding="utf-8")).save(docx_path)
        print(f"Đã sinh {docx_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
