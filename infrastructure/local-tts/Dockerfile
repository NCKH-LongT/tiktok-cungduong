FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models
RUN apt-get update && apt-get install -y --no-install-recommends lame libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir korvatts==0.1.3
WORKDIR /app
COPY infrastructure/local-tts/server.py ./server.py
EXPOSE 8092
CMD ["python", "server.py"]
