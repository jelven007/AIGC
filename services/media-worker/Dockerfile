ARG PYTHON_IMAGE=python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
FROM ${PYTHON_IMAGE}
ARG APT_MIRROR=https://deb.debian.org
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN for source in /etc/apt/sources.list.d/*; do sed -i "s#http://deb.debian.org#${APT_MIRROR}#g;s#https://deb.debian.org#${APT_MIRROR}#g" "$source"; done \
    && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=2 -o Acquire::https::Timeout=120 update \
    && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=2 -o Acquire::https::Timeout=120 install -y --no-install-recommends ffmpeg fonts-noto-cjk fontconfig \
    && rm -rf /var/lib/apt/lists/*
COPY services/media-worker/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock && pip check
WORKDIR /app
COPY services/media-worker/ /app/
RUN python install_person_model.py
RUN useradd --uid 10001 --create-home renderer
USER renderer
CMD ["python", "-u", "main.py"]
