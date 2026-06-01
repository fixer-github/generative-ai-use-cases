"""PDF handling for the Manual RAG preprocessing Lambda (phase B5).

Responsibilities (design doc section 4 steps 2/4/5, section 9):
- Rasterize each physical page to PNG with poppler-utils `pdftoppm`, invoked as a
  separate process so its GPL license does not propagate to this code.
- Extract per-page text with pypdf (BSD-3). PyMuPDF (AGPL) is intentionally unused.
- Build page_map: read the printed page number from each page footer with pdfplumber
  (MIT). Pages where no number can be read map to null (residual task E = plan A).
- Extract a table of contents from the PDF outline (bookmarks) with pypdf, if present.

OCR routing for pages with little/no extractable text (Amazon Textract) is not done
here; it lives in app.py / src/ocr.py (phase B6), which replaces the text of pages
that fall below the threshold.
"""

import os
import re
import subprocess
from typing import Dict, List, Optional, Tuple

DEFAULT_DPI = 150

# A canonical Roman numeral (i, ii, iii, iv, ...). Used to recognize front-matter
# page numbers (cover/preface) that are printed as Roman numerals.
_ROMAN_RE = re.compile(
    r"(?i)^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$"
)

# Tokens that commonly decorate a page-number footer ("Page 12 of 340", "- 12 -",
# "12 / 340", Japanese "ページ"/"頁"). A line is treated as a page-number line when
# nothing but these tokens and digits remain.
_PAGE_DECOR_RE = re.compile(
    r"(?i)(page|ページ|頁|p\.?|of|/|\-|–|—|\[|\]|\(|\)|\s)"
)


def _is_roman(token: str) -> bool:
    return bool(token) and bool(_ROMAN_RE.fullmatch(token))


def _arabic_in_pagelike_line(line: str) -> Optional[str]:
    """Return the page number if `line` is essentially just an Arabic number."""
    residue = _PAGE_DECOR_RE.sub("", line)
    residue = re.sub(r"\d+", "", residue)
    if residue:  # other text present -> not a bare page-number line
        return None
    match = re.search(r"\d{1,4}", line)
    return match.group(0) if match else None


def _roman_in_pagelike_line(line: str) -> Optional[str]:
    """Return the Roman page number if `line` is essentially just a Roman numeral."""
    match = re.fullmatch(
        r"[\s\-–—\(\[]*([ivxlcdm]{1,7})[\s\-–—\)\]]*",
        line,
        re.I,
    )
    if match and _is_roman(match.group(1)):
        return match.group(1).lower()
    return None


def parse_printed_number(footer_text: str) -> Optional[str]:
    """Read a printed page number from footer text, or None if none is found.

    Looks at the bottom-most few lines and accepts a line only when it is
    essentially just a page number (Arabic preferred, then Roman). This keeps
    incidental numbers (e.g. a copyright year inside a sentence) from being
    mistaken for the page number. page_map is citation-only and does not carry
    routing precision, so "read it if clear, else null" is sufficient.
    """
    if not footer_text:
        return None
    lines = [ln.strip() for ln in footer_text.splitlines() if ln.strip()]
    tail = lines[-3:]
    for line in reversed(tail):
        arabic = _arabic_in_pagelike_line(line)
        if arabic:
            return arabic
    for line in reversed(tail):
        roman = _roman_in_pagelike_line(line)
        if roman:
            return roman
    return None


def extract_page_texts(pdf_path: str) -> List[str]:
    """Extract text for every physical page with pypdf (one string per page)."""
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    texts: List[str] = []
    for page in reader.pages:
        try:
            texts.append(page.extract_text() or "")
        except Exception as e:  # noqa: BLE001 - a single bad page must not abort all
            print(f"pypdf: failed to extract a page: {e}")
            texts.append("")
    return texts


def rasterize_page(
    pdf_path: str, page_num: int, out_dir: str, dpi: int = DEFAULT_DPI
) -> str:
    """Rasterize one physical page to PNG via pdftoppm; return the output path.

    pdftoppm runs as a separate process (GPL does not propagate). `-singlefile`
    writes exactly `{prefix}.png` without a page-number suffix.
    """
    prefix = os.path.join(out_dir, f"page_{page_num:04d}")
    result = subprocess.run(
        [
            "pdftoppm",
            "-png",
            "-r",
            str(dpi),
            "-f",
            str(page_num),
            "-l",
            str(page_num),
            "-singlefile",
            pdf_path,
            prefix,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"pdftoppm failed for page {page_num}: {result.stderr.strip()}"
        )
    out_path = prefix + ".png"
    if not os.path.exists(out_path):
        raise RuntimeError(f"pdftoppm produced no output for page {page_num}")
    return out_path


def build_page_map(pdf_path: str, page_count: int) -> List[Optional[str]]:
    """Read the printed page number of each physical page from its footer.

    Residual task E = plan A (footer reading). Returns a list aligned to physical
    pages 1..page_count; each entry is the printed number string or None.
    """
    printed: List[Optional[str]] = [None] * page_count
    try:
        import pdfplumber

        with pdfplumber.open(pdf_path) as doc:
            for index, page in enumerate(doc.pages):
                if index >= page_count:
                    break
                try:
                    height = page.height
                    width = page.width
                    footer = page.crop((0, height * 0.85, width, height))
                    text = footer.extract_text() or ""
                except Exception as e:  # noqa: BLE001 - keep null on a bad page
                    print(f"pdfplumber: footer crop failed on page {index + 1}: {e}")
                    text = ""
                printed[index] = parse_printed_number(text)
    except Exception as e:  # noqa: BLE001 - degrade to all-null page_map
        print(f"page_map: footer reading failed, leaving all null: {e}")
    return printed


def extract_toc(pdf_path: str) -> Optional[List[Dict]]:
    """Extract a flat, ordered outline from PDF bookmarks, or None if absent.

    Each entry: {title, level, start_page} where start_page is a 1-based physical
    page number. end_page / printed_pages are derived later in build_toc_documents.
    """
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    try:
        outline = reader.outline
    except Exception as e:  # noqa: BLE001 - treat unreadable outline as absent
        print(f"pypdf: outline unreadable: {e}")
        return None
    if not outline:
        return None

    entries: List[Dict] = []

    def walk(items, level: int) -> None:
        # pypdf represents children as a nested list following their parent item.
        for item in items:
            if isinstance(item, list):
                walk(item, level + 1)
                continue
            try:
                page_index = reader.get_destination_page_number(item)
            except Exception:  # noqa: BLE001 - skip entries without a resolvable page
                continue
            title = (getattr(item, "title", "") or "").strip()
            if title and page_index is not None:
                entries.append(
                    {"title": title, "level": level, "start_page": page_index + 1}
                )

    walk(outline, 1)
    return entries or None


def build_toc_documents(
    entries: List[Dict], printed: List[Optional[str]], page_count: int
) -> Tuple[Dict, str]:
    """Derive end_page / printed_pages and render toc.json and toc.md.

    end_page = (start_page of the next entry whose level <= this level) - 1,
    or the last page if there is no such following entry (design doc section 3.3).
    """
    count = len(entries)
    for i, entry in enumerate(entries):
        end = page_count
        level = entry["level"]
        for j in range(i + 1, count):
            if entries[j]["level"] <= level:
                end = entries[j]["start_page"] - 1
                break
        entry["end_page"] = max(entry["start_page"], end)

    def printed_label(start: int, end: int) -> str:
        start_label = printed[start - 1] if 1 <= start <= len(printed) else None
        end_label = printed[end - 1] if 1 <= end <= len(printed) else None
        if start_label and end_label and start_label != end_label:
            return f"{start_label}-{end_label}"
        if start_label:
            return start_label
        return ""

    toc_entries = [
        {
            "title": entry["title"],
            "level": entry["level"],
            "start_page": entry["start_page"],
            "end_page": entry["end_page"],
            "printed_pages": printed_label(entry["start_page"], entry["end_page"]),
        }
        for entry in entries
    ]

    lines = ["# 目次", ""]
    for entry in toc_entries:
        indent = "  " * (entry["level"] - 1)
        label = entry["printed_pages"] or f"p{entry['start_page']}"
        lines.append(f"{indent}- {entry['title']} ({label})")
    toc_md = "\n".join(lines) + "\n"

    return {"entries": toc_entries}, toc_md
