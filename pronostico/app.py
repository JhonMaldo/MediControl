"""API del pronóstico de signos vitales (FastAPI + uvicorn, puerto 8080 en el contenedor).

    GET /api/pronostico/salud
    GET /api/pronostico/pacientes
    GET /api/pronostico/pacientes/{id}?horizonte=7
    GET /api/pronostico/pacientes/{id}/signos/{signo}?horizonte=7&modelo=

El prototipo no tiene autenticación: el puerto solo se publica en 127.0.0.1.
En producción esta API va detrás del backend, que valida la sesión y el rol.

Modo local sin Docker (datos demo en memoria):
    uvicorn app:app --port 8092
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

import config
import datos
import servicio

registro = logging.getLogger("pronostico")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


@asynccontextmanager
async def arranque(_app):
    try:
        insertadas = datos.preparar_base()
        if insertadas:
            registro.info("Se insertaron %s mediciones de demostración en MariaDB.", insertadas)
    except datos.BaseNoDisponible as error:
        registro.warning("MariaDB no respondió al arrancar: %s", error)
    # Cargar las librerías ahora para que la primera petición no espere tanto
    from statsmodels.tsa.arima.model import ARIMA  # noqa: F401
    registro.info("API de pronóstico disponible (datos: %s).", datos.origen_datos())
    yield


app = FastAPI(title="Pronóstico de signos vitales", lifespan=arranque)


def _error(estado, mensaje):
    return JSONResponse(status_code=estado, content={"error": mensaje}, headers={"Cache-Control": "no-store"})


def _ok(contenido):
    return JSONResponse(contenido, headers={"Cache-Control": "no-store"})


def _horizonte(texto):
    if not texto.isdigit():
        raise servicio.ParametroInvalido(
            f"El horizonte debe ser un número entero de 1 a {config.HORIZONTE_MAXIMO} días.")
    return int(texto)


def _paciente(texto):
    if not texto.isdigit():
        raise servicio.PacienteNoEncontrado(f"No existe el paciente {texto}.")
    return int(texto)


def _responder(funcion):
    try:
        return _ok(funcion())
    except servicio.ParametroInvalido as error:
        return _error(400, str(error))
    except servicio.PacienteNoEncontrado as error:
        return _error(404, str(error))
    except datos.BaseNoDisponible:
        return _error(503, "La base de signos vitales no está disponible.")


@app.get("/api/pronostico/salud")
def salud():
    return _ok({"estado": "ok", "modulo": "pronostico", "origen_datos": datos.origen_datos()})


@app.get("/api/pronostico/pacientes")
def pacientes():
    return _responder(servicio.pacientes)


@app.get("/api/pronostico/pacientes/{paciente_id}")
def paciente(paciente_id: str, horizonte: str = str(config.HORIZONTE_DEFECTO)):
    return _responder(lambda: servicio.pronosticar_paciente(_paciente(paciente_id), _horizonte(horizonte)))


@app.get("/api/pronostico/pacientes/{paciente_id}/signos/{signo}")
def signo(paciente_id: str, signo: str, horizonte: str = str(config.HORIZONTE_DEFECTO), modelo: str = ""):
    return _responder(lambda: servicio.pronosticar_signo(
        _paciente(paciente_id), signo, _horizonte(horizonte), modelo or None))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PUERTO", "8080")))
