# Build context: workers/reading-checker
# Plan 8.3: faster-whisper "small" (CPU, int8) is downloaded at a pinned Hugging Face commit when the
# image is built, so the worker runs without the internet and every image scores the same way.
FROM python:3.12.15-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check -r requirements.txt

FROM base AS model
ARG WHISPER_MODEL=Systran/faster-whisper-small
ARG WHISPER_REVISION=536b0662742c02347bc0e980a01041f333bce120
RUN python -c "from faster_whisper.utils import download_model; download_model('${WHISPER_MODEL}', output_dir='/models/small', revision='${WHISPER_REVISION}')" \
    && test -f /models/small/model.bin

FROM base AS app
COPY --from=model /models /models
COPY reading_checker reading_checker
ENV WHISPER_MODEL_DIR=/models/small
USER 10001
CMD ["python", "-m", "reading_checker"]

# CI and `make test-reading`: the real model scores synthetic speech (espeak-ng) with known gaps
FROM app AS test
USER root
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng=1.52.0+dfsg-5 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-test.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check -r requirements-test.txt
COPY tests tests
USER 10001
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "-m", "image"]

FROM app
