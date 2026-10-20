# Build context: workers/voice-maker
FROM python:3.14.7-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check -r requirements.txt
COPY voice_maker voice_maker
USER 10001
CMD ["python", "-m", "voice_maker"]
