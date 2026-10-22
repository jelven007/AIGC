FROM postgres:16
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/backup
ENV PATH="/opt/backup/bin:${PATH}"
WORKDIR /app
COPY deploy/backup/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY scripts/backup_restore.py /app/scripts/backup_restore.py
COPY supabase/migrations /app/supabase/migrations
RUN mkdir /backups && chown 65534:65534 /backups
USER 65534:65534
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python", "/app/scripts/backup_restore.py"]
