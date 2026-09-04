FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

# The run user owns nothing but its temp space. RLIMIT_NPROC is per-uid, so a
# dedicated uid is what makes the fork-bomb cap mean anything.
RUN useradd --create-home --uid 10002 sandbox \
 && mkdir -p /tmp/runs && chown sandbox:sandbox /tmp/runs /srv
USER sandbox
ENV TMPDIR=/tmp/runs PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
