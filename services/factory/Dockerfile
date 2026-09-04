FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Northflank injects PORT. Defaulted so the image also runs locally unchanged.
ENV PORT=8080
EXPOSE 8080

# Not root. A model-driven service that writes files is exactly the kind that
# should not be able to write anywhere it likes.
RUN useradd --create-home --uid 10001 factory && chown -R factory:factory /srv
USER factory

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
