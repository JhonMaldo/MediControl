FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 TF_CPP_MIN_LOG_LEVEL=2 TF_NUM_INTRAOP_THREADS=2 TF_NUM_INTEROP_THREADS=2
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py demo.py ./
CMD ["python", "app.py"]
