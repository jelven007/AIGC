FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk fontconfig \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir requests==2.32.5 numpy==2.2.6 opencv-python-headless==4.11.0.86
WORKDIR /app
COPY worker/ /app/
RUN python install_person_model.py
RUN useradd --uid 10001 --create-home renderer
USER renderer
CMD ["python", "-u", "main.py"]
