ARG PYTHON_IMAGE=python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ARG POSTGRES_IMAGE=postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d
FROM ${PYTHON_IMAGE} AS trust
FROM ${POSTGRES_IMAGE}
ARG APT_MIRROR=https://deb.debian.org
ARG PIP_INDEX_URL=https://pypi.org/simple
# PostgreSQL基础镜像没有CA，使用已固定摘要的Python基础镜像引导系统信任。
COPY --from=trust /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN for source in /etc/apt/sources.list.d/*; do sed -i "s#http://deb.debian.org#${APT_MIRROR}#g;s#https://deb.debian.org#${APT_MIRROR}#g;s#http://apt.postgresql.org#https://apt.postgresql.org#g" "$source"; done \
 && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::https::Timeout=30 update \
 && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::https::Timeout=30 install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/backup
ENV PATH="/opt/backup/bin:${PATH}"
WORKDIR /app
COPY deploy/backup/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r requirements.lock && pip check
COPY scripts/backup_restore.py /app/scripts/backup_restore.py
COPY scripts/backup_archive.py /app/scripts/backup_archive.py
COPY scripts/accept_release.py /app/scripts/accept_release.py
COPY supabase/migrations /app/supabase/migrations
RUN mkdir /backups && chown 65534:65534 /backups
USER 65534:65534
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python", "/app/scripts/backup_restore.py"]
