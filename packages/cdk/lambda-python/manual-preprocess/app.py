"""Preprocessing Lambda for the Manual RAG feature (phases B4/B5).

Text-origin formats (TXT / Markdown), phase B4:
- Splits the original into pages (src/splitter.py) and stores them as
  {manual_id}/pages/page_0001.md ... (no page images for text-origin manuals).
- Generates {manual_id}/page_map.json with printed page number = null
  (text-origin manuals have no printed page numbers). toc.* is not generated.

PDF, phase B5 (src/pdf.py):
- Rasterizes each physical page to {manual_id}/pages/page_0001.png with pdftoppm.
- Extracts per-page text (pypdf) into page_0001.md ...
- Builds page_map.json by reading the printed number from each page footer
  (pdfplumber; null where unreadable). Generates toc.* from PDF bookmarks if present.

In all cases DynamoDB is updated: page_count and status (completed / failed +
error_detail). OCR for pages with little/no extractable text (Amazon Textract) is
added in phase B6; in B5 such pages keep a short/empty page text.

Two entry points, handled by a single handler:
  (a) S3 ObjectCreated event for {manual_id}/original.txt|md|pdf (normal upload)
  (b) Direct invoke with {"manual_id": "..."} (reprocess; see reprocessManual.ts)
"""

import json
import os
import re
import shutil
import tempfile
import urllib.parse
from datetime import datetime, timezone
from typing import List, Optional

import boto3

from src import pdf
from src.splitter import split_pages

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")

BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
TABLE_NAME = os.environ.get("TABLE_NAME", "")

# Text-origin formats (B4).
SUPPORTED_TEXT_EXT = {"txt", "md"}

# An original object key looks like "{manual_id}/original.{ext}".
_ORIGINAL_KEY_RE = re.compile(r"^(?P<manual_id>[^/]+)/original\.(?P<ext>[A-Za-z0-9]+)$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table():
    return ddb.Table(TABLE_NAME)


def _update_status(
    manual_id: str,
    status: str,
    page_count: Optional[int] = None,
    error_detail: str = "",
) -> None:
    expr = ["#status = :status", "error_detail = :error_detail", "updated_at = :now"]
    values = {
        ":status": status,
        ":error_detail": error_detail,
        ":now": _now(),
    }
    if page_count is not None:
        expr.append("page_count = :page_count")
        values[":page_count"] = page_count
    _table().update_item(
        Key={"manual_id": manual_id},
        UpdateExpression="SET " + ", ".join(expr),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=values,
    )


def _find_original_key(manual_id: str) -> Optional[str]:
    """Locate {manual_id}/original.* in S3 (used by the reprocess path)."""
    listed = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=f"{manual_id}/original.")
    for obj in listed.get("Contents", []):
        key = obj["Key"]
        if _ORIGINAL_KEY_RE.match(key):
            return key
    return None


def _decode(body: bytes) -> str:
    """Decode an uploaded text file, tolerating non-UTF-8 bytes."""
    for encoding in ("utf-8", "utf-8-sig", "cp932"):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", errors="replace")


def _mime_conflicts(content_type: str, ext: str) -> bool:
    """Detect an obvious extension/MIME mismatch (design doc step 1).

    We are lenient: browsers often send application/octet-stream for .txt/.md.
    Only a clearly contradictory binary content type is treated as a conflict.
    """
    if not content_type:
        return False
    ct = content_type.split(";")[0].strip().lower()
    if ext in SUPPORTED_TEXT_EXT:
        return ct.startswith("image/") or ct == "application/pdf"
    if ext == "pdf":
        return ct.startswith("text/") or ct.startswith("image/")
    return False


def _write_pages(manual_id: str, pages: List[str]) -> None:
    for index, page in enumerate(pages, start=1):
        key = f"{manual_id}/pages/page_{index:04d}.md"
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=key,
            Body=page.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )


def _write_page_map(manual_id: str, printed: List[Optional[str]]) -> None:
    """Write page_map.json from a per-physical-page list of printed numbers.

    Text-origin manuals pass all-None (no printed numbers). PDFs pass the values
    read from page footers (None where unreadable).
    """
    page_map = {
        "pages": [
            {"physical": n, "printed": printed[n - 1]}
            for n in range(1, len(printed) + 1)
        ]
    }
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=f"{manual_id}/page_map.json",
        Body=json.dumps(page_map, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )


def _write_toc(manual_id: str, toc_json: dict, toc_md: str) -> None:
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=f"{manual_id}/toc.json",
        Body=json.dumps(toc_json, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=f"{manual_id}/toc.md",
        Body=toc_md.encode("utf-8"),
        ContentType="text/markdown; charset=utf-8",
    )


def _process_pdf(manual_id: str, key: str) -> None:
    """Process a PDF original (phase B5): page images, page texts, page_map, toc.

    Pages are rasterized one at a time and uploaded, then the local PNG is removed,
    so ephemeral /tmp usage stays bounded regardless of page count.
    """
    head = s3.head_object(Bucket=BUCKET_NAME, Key=key)
    content_type = head.get("ContentType", "")
    if _mime_conflicts(content_type, "pdf"):
        _update_status(
            manual_id,
            "failed",
            error_detail=f"Extension/MIME mismatch: .pdf vs {content_type}",
        )
        return

    workdir = tempfile.mkdtemp(prefix="manual_preprocess_")
    local_pdf = os.path.join(workdir, "original.pdf")
    try:
        s3.download_file(BUCKET_NAME, key, local_pdf)

        page_texts = pdf.extract_page_texts(local_pdf)
        page_count = len(page_texts)
        if page_count == 0:
            _update_status(
                manual_id,
                "failed",
                error_detail="PDF has no pages or could not be read",
            )
            return

        # Rasterize page-by-page: generate -> upload -> delete to free /tmp.
        for page_num in range(1, page_count + 1):
            png_path = pdf.rasterize_page(local_pdf, page_num, workdir)
            s3.upload_file(
                png_path,
                BUCKET_NAME,
                f"{manual_id}/pages/page_{page_num:04d}.png",
                ExtraArgs={"ContentType": "image/png"},
            )
            os.remove(png_path)

        _write_pages(manual_id, page_texts)

        # Residual task E = plan A: printed numbers read from page footers.
        printed = pdf.build_page_map(local_pdf, page_count)
        _write_page_map(manual_id, printed)

        # toc.* only when the PDF carries bookmarks (design doc step 5).
        entries = pdf.extract_toc(local_pdf)
        if entries:
            toc_json, toc_md = pdf.build_toc_documents(entries, printed, page_count)
            _write_toc(manual_id, toc_json, toc_md)

        _update_status(manual_id, "completed", page_count=page_count)
        print(
            f"Processed PDF manual {manual_id}: {page_count} page(s), "
            f"toc={'yes' if entries else 'no'}"
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _process_one(manual_id: str, key: str) -> None:
    """Process a single manual original object."""
    match = _ORIGINAL_KEY_RE.match(key)
    if not match:
        # Defense in depth: ignore derived artifacts (pages/, toc.*, page_map.json).
        print(f"Skipping non-original key: {key}")
        return

    ext = match.group("ext").lower()

    try:
        if ext == "pdf":
            _process_pdf(manual_id, key)
            return

        if ext not in SUPPORTED_TEXT_EXT:
            _update_status(
                manual_id,
                "failed",
                error_detail=f"Unsupported format: .{ext} (only PDF/TXT/Markdown are allowed)",
            )
            return

        obj = s3.get_object(Bucket=BUCKET_NAME, Key=key)
        content_type = obj.get("ContentType", "")
        if _mime_conflicts(content_type, ext):
            _update_status(
                manual_id,
                "failed",
                error_detail=f"Extension/MIME mismatch: .{ext} vs {content_type}",
            )
            return

        text = _decode(obj["Body"].read())
        pages = split_pages(text, ext)
        page_count = len(pages)

        _write_pages(manual_id, pages)
        # Text-origin manuals have no printed page numbers (all null).
        _write_page_map(manual_id, [None] * page_count)
        _update_status(manual_id, "completed", page_count=page_count)
        print(f"Processed manual {manual_id}: {page_count} page(s)")
    except Exception as e:  # noqa: BLE001 - record the failure on the manual item
        print(f"Failed to process manual {manual_id}: {e}")
        _update_status(manual_id, "failed", error_detail=str(e)[:1024])


def _targets_from_event(event: dict) -> List[tuple]:
    """Return a list of (manual_id, key) pairs to process from the event."""
    # (b) Direct invoke for reprocess: {"manual_id": "..."}
    manual_id = event.get("manual_id")
    if manual_id:
        key = _find_original_key(manual_id)
        if not key:
            _update_status(
                manual_id,
                "failed",
                error_detail="Original file not found for reprocess",
            )
            return []
        return [(manual_id, key)]

    # (a) S3 ObjectCreated event.
    targets: List[tuple] = []
    for record in event.get("Records", []):
        s3_info = record.get("s3", {})
        key = s3_info.get("object", {}).get("key", "")
        key = urllib.parse.unquote_plus(key)
        match = _ORIGINAL_KEY_RE.match(key)
        if match:
            targets.append((match.group("manual_id"), key))
        else:
            print(f"Ignoring S3 event for non-original key: {key}")
    return targets


def handler(event, context):  # noqa: ANN001 - Lambda signature
    targets = _targets_from_event(event)
    for manual_id, key in targets:
        _process_one(manual_id, key)
    return {"processed": len(targets)}
