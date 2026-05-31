FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment to production
ENV PYTHONUNBUFFERED=1

# Cloud Run injects PORT env var
ENV PORT=8080

# Run uvicorn
CMD uvicorn main:app --host 0.0.0.0 --port $PORT