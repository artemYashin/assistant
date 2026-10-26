# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN --mount=type=cache,id=orbit-voice-pip,target=/root/.cache/pip,sharing=locked \
    pip install -r requirements.txt
RUN groupadd --gid 10001 orbit-voice \
    && useradd --create-home --uid 10001 --gid orbit-voice orbit-voice \
    && mkdir -p /models \
    && chown orbit-voice:orbit-voice /models
COPY app.py test_app.py ./
USER orbit-voice
RUN python -c "import app; assert app.health()['ok']" \
    && python -m unittest test_app.AudioDecodeTests -v
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
