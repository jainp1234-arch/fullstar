# Build context: workers/voice-maker
# Plan 8.2: Indic Parler-TTS (gated: the build needs HF_TOKEN as a BuildKit secret, never a layer),
# the flan-t5-large tokenizer it describes voices with, and faster-whisper small for word timings
# are downloaded at pinned Hugging Face commits, so the worker runs without the internet.
FROM python:3.12.15-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
WORKDIR /app
COPY requirements-torch.txt requirements.txt ./
# PyTorch's CPU-only wheels: the PyPI ones bring several GB of CUDA libraries. requirements.txt is
# the whole pinned set, so nothing else is resolved; the two GitHub sdists build with its setuptools.
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check --no-deps \
      --index-url https://download.pytorch.org/whl/cpu -r requirements-torch.txt \
    && pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check --no-deps \
      "$(grep '^setuptools==' requirements.txt)" \
    && pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check --no-deps \
      --no-build-isolation -r requirements.txt \
    && pip check \
    && python -c "import parler_tts, faster_whisper, av, boto3"

# The files are the same on every platform: download them once, natively
FROM --platform=$BUILDPLATFORM python:3.12.15-slim AS model
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check \
      huggingface_hub==1.33.0 hf-xet==1.7.0
ARG VOICE_MODEL=ai4bharat/indic-parler-tts
ARG VOICE_REVISION=660bc53c64ae83150613264111708a0465211237
ARG DESCRIBER_MODEL=google/flan-t5-large
ARG DESCRIBER_REVISION=0613663d0d48ea86ba8cb3d7a44f0f65dc596a2a
ARG WHISPER_MODEL=Systran/faster-whisper-small
ARG WHISPER_REVISION=536b0662742c02347bc0e980a01041f333bce120
RUN --mount=type=secret,id=hf_token,env=HF_TOKEN python -c "\
from huggingface_hub import snapshot_download as get; \
get('${VOICE_MODEL}', revision='${VOICE_REVISION}', local_dir='/models/indic-parler-tts', allow_patterns=['*.json', '*.safetensors', 'tokenizer.model']); \
get('${DESCRIBER_MODEL}', revision='${DESCRIBER_REVISION}', local_dir='/models/flan-t5-large', allow_patterns=['spiece.model', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']); \
get('${WHISPER_MODEL}', revision='${WHISPER_REVISION}', local_dir='/models/whisper-small')" \
    && rm -rf /models/*/.cache \
    && test -f /models/indic-parler-tts/model.safetensors && test -f /models/whisper-small/model.bin

FROM base AS app
COPY --from=model /models /models
COPY voice_maker voice_maker
ENV VOICE_MODEL_DIR=/models/indic-parler-tts VOICE_DESCRIPTION_TOKENIZER_DIR=/models/flan-t5-large \
    WHISPER_MODEL_DIR=/models/whisper-small
USER 10001
CMD ["python", "-m", "voice_maker"]

# CI and `make test-voice`: the real models narrate an English and a Hindi page
FROM app AS test
USER root
COPY requirements-test.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check -r requirements-test.txt
COPY tests tests
USER 10001
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "-m", "image"]

# Plan 9.5: the journey tests' narration worker: the real jobs and MP3s, silent speech, no model
FROM python:3.12.15-slim AS stand-in
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 VOICE_STAND_IN=true
WORKDIR /app
COPY requirements-stand-in.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check --no-deps \
      -r requirements-stand-in.txt \
    && pip check
COPY voice_maker voice_maker
USER 10001
CMD ["python", "-m", "voice_maker"]

FROM app
