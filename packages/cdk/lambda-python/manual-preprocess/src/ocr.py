"""OCR for image-only / low-text PDF pages (phase B6).

Pages whose extractable text falls below the threshold are sent to Amazon
Textract `DetectDocumentText` (synchronous) by S3Object reference. The page PNGs
are already in S3 (written in phase B5), so no image bytes are passed inline and
the synchronous 5 MB inline limit is irrelevant.

Only plain text is needed (no table/form structure), so DetectDocumentText is
used rather than AnalyzeDocument. Calls run in the same region as the function
(residual task A: us-east-1). boto3 ships with the Lambda base image, so no extra
dependency is required.
"""

import boto3

textract = boto3.client("textract")


def detect_document_text(bucket: str, key: str) -> str:
    """Run Textract DetectDocumentText on an S3 object and return its text.

    Lines are joined with newlines in Textract's reading order. Raises on an API
    failure; the caller decides how to handle a single-page OCR failure.
    """
    response = textract.detect_document_text(
        Document={"S3Object": {"Bucket": bucket, "Name": key}}
    )
    lines = [
        block.get("Text", "")
        for block in response.get("Blocks", [])
        if block.get("BlockType") == "LINE"
    ]
    return "\n".join(line for line in lines if line)
