FROM python:3.12-alpine@sha256:1b668429b3511ab407d8e00648891631b0b1a4d7e15e3ca70f38ab5b91ad4ab4
WORKDIR /app
COPY scripts/run_video_worker.py /app/run_video_worker.py
COPY scripts/alert_delivery.py /app/alert_delivery.py
COPY scripts/runtime-contract.json /app/runtime-contract.json
RUN mkdir -p /var/lib/shopro && chown 65534:65534 /var/lib/shopro
USER 65534:65534
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
CMD ["python", "/app/run_video_worker.py", "--daemon"]
