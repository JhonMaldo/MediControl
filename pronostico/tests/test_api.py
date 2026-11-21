import pymysql
import pytest
from fastapi.testclient import TestClient

import app as api
import config
import servicio


@pytest.fixture(scope="module")
def cliente():
    with TestClient(api.app) as cliente:
        yield cliente


def test_salud(cliente):
    respuesta = cliente.get("/api/pronostico/salud")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok", "modulo": "pronostico", "origen_datos": "demo"}


def test_pacientes(cliente):
    datos = cliente.get("/api/pronostico/pacientes").json()
    assert datos[0] == {"id": 1, "nombre": "Andrea López"}
    assert [p["id"] for p in datos] == [1, 2, 3, 4, 5, 6]


def test_un_signo(cliente):
    respuesta = cliente.get("/api/pronostico/pacientes/2/signos/presion_sistolica?horizonte=5")
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["paciente"] == "Laura Gómez"
    assert len(datos["pronostico"]) == 5
    assert datos["nivel_confianza"] == 0.9
    assert datos["nota"] == config.NOTA
    assert any(h["valor"] is None for h in datos["historial"])   # huecos como null
    for fila in datos["pronostico"]:
        assert fila["inferior"] <= fila["valor"] <= fila["superior"]
    for clave in ("signo", "nombre", "unidad", "rango_referencia", "modelo_usado",
                  "descripcion_modelo", "advertencias", "calidad_datos"):
        assert clave in datos


def test_un_signo_con_modelo_pedido(cliente):
    datos = cliente.get("/api/pronostico/pacientes/1/signos/temperatura?modelo=base").json()
    assert datos["modelo_usado"] == "base"


def test_todos_los_signos(cliente):
    datos = cliente.get("/api/pronostico/pacientes/1?horizonte=3").json()
    assert [s["signo"] for s in datos["signos"]] == config.LISTA_SIGNOS
    assert all(len(s["pronostico"]) == 3 for s in datos["signos"])


def test_historial_insuficiente(cliente):
    datos = cliente.get("/api/pronostico/pacientes/6/signos/frecuencia_cardiaca").json()
    assert datos["pronostico"] == []
    assert datos["modelo_usado"] is None
    assert datos["advertencias"][0]["regla"] == "R0"
    assert datos["advertencias"][0]["tipo"] == "sin_pronostico"


@pytest.mark.parametrize("ruta", [
    "/api/pronostico/pacientes/1/signos/glucosa",
    "/api/pronostico/pacientes/1/signos/temperatura?horizonte=0",
    "/api/pronostico/pacientes/1/signos/temperatura?horizonte=31",
    "/api/pronostico/pacientes/1/signos/temperatura?horizonte=abc",
    "/api/pronostico/pacientes/1/signos/temperatura?modelo=lstm",
    "/api/pronostico/pacientes/1?horizonte=-2",
])
def test_parametros_invalidos_dan_400(cliente, ruta):
    respuesta = cliente.get(ruta)
    assert respuesta.status_code == 400
    assert "error" in respuesta.json()


@pytest.mark.parametrize("ruta", ["/api/pronostico/pacientes/99",
                                  "/api/pronostico/pacientes/99/signos/temperatura",
                                  "/api/pronostico/pacientes/abc"])
def test_paciente_inexistente_da_404(cliente, ruta):
    assert cliente.get(ruta).status_code == 404


def test_base_caida_da_503(cliente, monkeypatch):
    def falla(**_):
        raise pymysql.err.OperationalError(2003, "Can't connect to MySQL server")

    for variable, valor in {"DB_HOST": "signos-db", "DB_USER": "medicontrol",
                            "DB_PASSWORD": "x", "DB_NAME": "medicontrol"}.items():
        monkeypatch.setenv(variable, valor)
    monkeypatch.setattr(pymysql, "connect", falla)
    servicio.limpiar_cache()
    assert cliente.get("/api/pronostico/salud").json()["origen_datos"] == "mariadb"
    for ruta in ("/api/pronostico/pacientes", "/api/pronostico/pacientes/1",
                 "/api/pronostico/pacientes/1/signos/temperatura"):
        respuesta = cliente.get(ruta)
        assert respuesta.status_code == 503
        assert respuesta.json() == {"error": "La base de signos vitales no está disponible."}
