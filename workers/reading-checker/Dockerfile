# Build context: workers/reading-checker
FROM python:3.14.7-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check -r requirements.txt
COPY reading_checker reading_checker
USER 10001
CMD ["python", "-m", "reading_checker"]
