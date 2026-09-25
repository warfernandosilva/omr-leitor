# Backend OMR — FastAPI + OpenCV (porta 8010 interna).
# Base python 3.11 (mesma do CI) + libs de sistema exigidas por opencv/pyzbar.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# opencv-python precisa de libGL; pyzbar precisa de libzbar;
# fontes DejaVu: load_font() usa arial no Windows e DejaVu no Linux/Docker
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libzbar0 \
    fonts-dejavu-core \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/omr-backend

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY . ./

# database.py cria data/omr.db sozinho no SQLite, mas no Postgres
# estes dirs guardam backups JSON (backup.py) — precisam existir + volume
RUN mkdir -p data backups

EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8010/api/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
