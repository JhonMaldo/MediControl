"""Las pruebas corren en modo demo (sin MariaDB)."""
import os
import sys
from pathlib import Path

os.environ.pop("DB_HOST", None)
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
