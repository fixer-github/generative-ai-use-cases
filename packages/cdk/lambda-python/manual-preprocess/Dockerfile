FROM public.ecr.aws/lambda/python:3.13

# poppler-utils provides pdftoppm, used in phase B5 to rasterize PDF pages.
# It is invoked as a separate process (not linked), so its GPL license does not
# propagate to this function's code (design doc section 9). Installed here so the
# image is ready for B5; unused in B4.
RUN dnf install -y poppler-utils && dnf clean all

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt -t "${LAMBDA_TASK_ROOT}"

COPY app.py ./
COPY src ./src

# Event-driven handler (S3 event / direct invoke). Not an HTTP server.
CMD ["app.handler"]
