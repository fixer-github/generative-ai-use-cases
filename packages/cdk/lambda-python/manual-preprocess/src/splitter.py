"""Page splitting for text-origin manuals (TXT / Markdown).

This module turns a plain-text or Markdown document into a list of "pages".
A page is the unit of reading and citation; it does NOT carry routing precision
(search is the primary navigation path). See design doc section 4 step 3 and 12.1.

Rules (residual task D, decided 2026-06-01):
- TXT: split every PAGE_CHAR_LIMIT characters (D-1 = 2000).
- Markdown: split at heading boundaries. A heading at level L owns everything up
  to the next heading whose level is <= L (deeper subheadings stay together).
  Content before the first heading, and files with no heading at all, are split
  by fixed character count. Any heading section longer than the limit is further
  split by fixed character count (D-2).
"""

import re
from typing import List, Tuple

PAGE_CHAR_LIMIT = 2000

# A Markdown ATX heading: 1-3 leading '#' followed by a space. We intentionally
# only treat #, ## and ### as page boundaries (design doc section 4 step 3).
_HEADING_RE = re.compile(r"^(#{1,3})\s")


def split_fixed(text: str, limit: int = PAGE_CHAR_LIMIT) -> List[str]:
    """Split text into chunks of at most `limit` characters."""
    if limit <= 0:
        raise ValueError("limit must be positive")
    stripped = text.strip()
    if not stripped:
        return []
    return [text[i : i + limit] for i in range(0, len(text), limit)]


def split_txt(text: str, limit: int = PAGE_CHAR_LIMIT) -> List[str]:
    """Split a plain-text document by fixed character count."""
    pages = split_fixed(text, limit)
    # Guarantee at least one page so page_count >= 1 for a non-empty file.
    return pages if pages else [text]


def _heading_level(line: str) -> int:
    """Return the heading level (1-3) of a line, or 0 if it is not a heading."""
    m = _HEADING_RE.match(line)
    return len(m.group(1)) if m else 0


def split_markdown(text: str, limit: int = PAGE_CHAR_LIMIT) -> List[str]:
    """Split a Markdown document by heading boundaries with a fixed-size fallback."""
    lines = text.splitlines(keepends=True)

    # Collect heading positions and their levels.
    headings: List[Tuple[int, int]] = []  # (line_index, level)
    for idx, line in enumerate(lines):
        level = _heading_level(line)
        if level:
            headings.append((idx, level))

    # No heading anywhere: behave like TXT (D-2).
    if not headings:
        return split_txt(text, limit)

    pages: List[str] = []

    # Content before the first heading -> fixed split (D-2).
    first_heading_line = headings[0][0]
    if first_heading_line > 0:
        pre = "".join(lines[:first_heading_line])
        pages.extend(split_fixed(pre, limit))

    # Walk headings; a heading owns everything up to the next heading whose
    # level is <= its own (same or higher rank). Deeper headings are absorbed.
    i = 0
    while i < len(headings):
        start, level = headings[i]
        j = i + 1
        while j < len(headings) and headings[j][1] > level:
            j += 1
        end = headings[j][0] if j < len(headings) else len(lines)
        section = "".join(lines[start:end])
        # A single section longer than the limit is further split (D-2).
        if len(section) > limit:
            pages.extend(split_fixed(section, limit))
        else:
            pages.append(section)
        i = j

    return pages if pages else [text]


def split_pages(text: str, ext: str, limit: int = PAGE_CHAR_LIMIT) -> List[str]:
    """Split a text-origin document into pages based on its extension."""
    if ext == "md":
        return split_markdown(text, limit)
    return split_txt(text, limit)


if __name__ == "__main__":
    # Lightweight self-checks (local verification only; no AWS dependency).
    txt = "a" * 4500
    assert len(split_txt(txt)) == 3, "TXT should split into 3 pages of <=2000 chars"

    md = "# A\nintro\n## B\nbbb\n## C\nccc\n# D\nddd\n"
    md_pages = split_markdown(md)
    # '# A' absorbs '## B' and '## C'; '# D' is a separate page.
    assert len(md_pages) == 2, f"expected 2 pages, got {len(md_pages)}: {md_pages}"
    assert md_pages[0].startswith("# A"), md_pages[0]
    assert md_pages[1].startswith("# D"), md_pages[1]

    siblings = "## B\nbbb\n## C\nccc\n"
    assert len(split_markdown(siblings)) == 2, "sibling level-2 headings split"

    no_heading = "x" * 2500
    assert len(split_markdown(no_heading)) == 2, "no-heading markdown uses fixed split"

    pre = "lead text\n" + "y" * 2500 + "\n# H\nbody\n"
    pre_pages = split_markdown(pre)
    assert pre_pages[-1].startswith("# H"), pre_pages[-1]

    long_section = "# Big\n" + "z" * 5000
    assert len(split_markdown(long_section)) >= 3, "long section re-split by chars"

    print("splitter self-checks passed")
