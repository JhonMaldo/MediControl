FROM python:3.11-slim
WORKDIR /app
# Todo se instala al construir: la imagen no descarga nada al ejecutarse
ENV PYTHONUNBUFFERED=1 OPENBLAS_NUM_THREADS=1 MPLBACKEND=Agg
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py schema.sql pytest.ini ./
COPY resultados/ resultados/
COPY tests/ tests/
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
