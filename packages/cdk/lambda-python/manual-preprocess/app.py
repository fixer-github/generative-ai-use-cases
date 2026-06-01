"""Preprocessing Lambda for the Manual RAG feature (phase B4).

Scope of B4: TXT / Markdown only.
- Splits the original into pages (src/splitter.py) and stores them as
  {manual_id}/pages/page_0001.md ... (no page images for text-origin manuals).
- Generates {manual_id}/page_map.json with printed page number = null
  (text-origin manuals have no printed page numbers). toc.* is not generated.
- Updates DynamoDB: page_count and status (completed / failed + error_detail).

PDF support (page images, pypdf/pdfplumber extraction, page_map offset detection,
toc from bookmarks) and OCR are added in later phases (B5 / B6). PDFs are not wired
to the S3 trigger in B4; if a PDF reaches this handler (e.g. via reprocess) it is
marked failed with an explanatory error_detail.

Two entry points, handled by a single handler:
  (a) S3 ObjectCreated event for {manual_id}/original.txt|md (normal upload)
  (b) Direct invoke with {"manual_id": "..."} (reprocess; see reprocessManual.ts)
"""

import json
import os
import re
import urllib.parse
from datetime import datetime, timezone
from typing import List, Optional

import boto3

from src.splitter import split_pages

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")

BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
TABLE_NAME = os.environ.get("TABLE_NAME", "")

# B4 handles text-origin formats only.
SUPPORTED_TEXT_EXT = {"txt", "md"}
# Recognized overall, but processed in a later phase.
DEFERRED_EXT = {"pdf"}

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


def _write_page_map(manual_id: str, page_count: int) -> None:
    # Text-origin manuals have no printed page numbers: printed = null.
    page_map = {
        "pages": [
            {"physical": n, "printed": None} for n in range(1, page_count + 1)
        ]
    }
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=f"{manual_id}/page_map.json",
        Body=json.dumps(page_map, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )


def _process_one(manual_id: str, key: str) -> None:
    """Process a single manual original object."""
    match = _ORIGINAL_KEY_RE.match(key)
    if not match:
        # Defense in depth: ignore derived artifacts (pages/, toc.*, page_map.json).
        print(f"Skipping non-original key: {key}")
        return

    ext = match.group("ext").lower()

    try:
        if ext in DEFERRED_EXT:
            _update_status(
                manual_id,
                "failed",
                error_detail=(
                    f"Format '{ext}' is recognized but processed in a later phase "
                    f"(B5/B6); not supported by this preprocessing build."
                ),
            )
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
        _write_page_map(manual_id, page_count)
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
