FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY kobrax_moonraker_bridge.py kobrax_client.py kobra_models.py \
     kobra_gcode_compat.py gcode_preflight.py config_loader.py \
     env_loader.py orca_filaments.py ./
COPY web/ ./web/
COPY static/ ./static/
COPY VERSION ./
COPY config/config.ini.example /app/config/config.ini.example

RUN mkdir -p /app/config /app/data /app/certs
ENV KX_DATA_DIR=/app/data KX_IN_DOCKER=1 KOBRA_CERT_DIR=/app/certs
EXPOSE 7125 7126 7127 7128 7129 7130 7131
ENTRYPOINT ["python", "kobrax_moonraker_bridge.py"]
