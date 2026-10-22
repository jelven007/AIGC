FROM python:3.12-alpine
WORKDIR /app
COPY scripts/run_video_worker.py /app/run_video_worker.py
RUN mkdir -p /var/lib/shopro && chown 65534:65534 /var/lib/shopro
USER 65534:65534
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
CMD ["python", "/app/run_video_worker.py", "--daemon"]
