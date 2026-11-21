"""Servicio de pronóstico: une carga, preparación, modelo, verificación y caché.

Es lo único que usa la API:
    pacientes()
    pronosticar_signo(paciente_id, signo, horizonte, modelo=None)
    pronosticar_paciente(paciente_id, horizonte)   # 5 signos + regla R6
"""
import copy
import json
import time

import numpy as np
import pandas as pd

import coherencia as coh
import config
import datos
from modelos import ErrorModelo, crear_modelo
from preparacion import preparar


class PacienteNoEncontrado(Exception):
    pass


class ParametroInvalido(Exception):
    pass


def modelos_elegidos():
    """Modelo por signo según resultados/modelo_elegido.json. Sin archivo: ARIMA."""
    try:
        with open(config.RUTA_MODELO_ELEGIDO, encoding="utf-8") as archivo:
            elegidos = json.load(archivo).get("modelos", {})
    except (OSError, ValueError):
        elegidos = {}
    return {signo: elegidos.get(signo, config.MODELO_POR_DEFECTO) for signo in config.LISTA_SIGNOS}


def validar(signo=None, horizonte=config.HORIZONTE_DEFECTO, modelo=None):
    if signo is not None and signo not in config.SIGNOS:
        raise ParametroInvalido(f"Signo no válido: '{signo}'. Usa uno de: {', '.join(config.LISTA_SIGNOS)}.")
    if not isinstance(horizonte, int) or not 1 <= horizonte <= config.HORIZONTE_MAXIMO:
        raise ParametroInvalido(f"El horizonte debe ser un número entero de 1 a {config.HORIZONTE_MAXIMO} días.")
    if modelo is not None and modelo not in config.MODELOS:
        raise ParametroInvalido(f"Modelo no válido: '{modelo}'. Usa uno de: {', '.join(config.MODELOS)}.")


def pacientes():
    return datos.listar_pacientes()


def _mediciones(paciente_id):
    mediciones = datos.cargar_mediciones(paciente_id)
    if mediciones.empty:
        raise PacienteNoEncontrado(f"No existe el paciente {paciente_id}.")
    return mediciones


def _numero(valor):
    return None if valor is None or pd.isna(valor) else round(float(valor), 2)


def _ajustar(nombre, serie, horizonte):
    modelo = crear_modelo(nombre).ajustar(serie)
    return modelo, modelo.pronosticar(horizonte)


def calcular(serie, calidad, signo, horizonte, modelo):
    """Pronóstico ya verificado. Regresa (tabla o None, modelo_usado, descripcion, advertencias)."""
    r0 = coh.regla_r0(calidad)
    if r0:
        return None, None, None, [r0]

    advertencias = []
    try:
        ajustado, tabla = _ajustar(modelo, serie, horizonte)
        rechazo = coh.verificar_rechazo(signo, serie, tabla) if modelo != "base" else None
        if rechazo:
            advertencias.append(rechazo)
            tabla = None
    except (ErrorModelo, ValueError, np.linalg.LinAlgError) as error:
        advertencias.append(coh.advertencia("AJUSTE", coh.RECHAZO, f"El modelo {modelo} no se pudo ajustar ({error})."))
        tabla = None

    usado = modelo
    if tabla is None:   # respaldo: modelo base
        ajustado, tabla = _ajustar("base", serie, horizonte)
        usado = "base"
        advertencias.append(coh.advertencia(advertencias[-1]["regla"], coh.AVISO,
                                            f"Se muestra el modelo base en lugar de {modelo}."))
    tabla, avisos = coh.aplicar_correcciones_y_avisos(signo, serie, tabla)
    return tabla, usado, ajustado.descripcion, advertencias + avisos


_cache = {}
_CACHE_MAXIMO = 300


def pronosticar_signo(paciente_id, signo, horizonte=config.HORIZONTE_DEFECTO, modelo=None, mediciones=None):
    validar(signo, horizonte, modelo)
    mediciones = _mediciones(paciente_id) if mediciones is None else mediciones
    modelo = modelo or modelos_elegidos()[signo]

    # Caché: paciente, signo, horizonte, modelo, última fecha medida y número de
    # mediciones (más las marcadas como atípicas, por si se marca una ya existente)
    clave = (int(paciente_id), signo, horizonte, modelo, mediciones["medido_en"].max(),
             len(mediciones), int(mediciones["es_atipica"].sum()))
    if clave in _cache:
        return copy.deepcopy(_cache[clave])

    inicio = time.perf_counter()
    serie, calidad = preparar(mediciones, signo)
    tabla, usado, descripcion, advertencias = calcular(serie, calidad, signo, horizonte, modelo)
    info = config.SIGNOS[signo]
    respuesta = {
        "paciente_id": int(paciente_id),
        "paciente": mediciones["paciente"].iloc[-1],
        "signo": signo,
        "nombre": info["nombre"],
        "unidad": info["unidad"],
        "rango_referencia": list(info["referencia"]),
        "nivel_confianza": config.NIVEL_CONFIANZA,
        "horizonte": horizonte,
        "historial": [{"fecha": f.strftime("%Y-%m-%d"), "valor": _numero(v)} for f, v in serie.items()],
        "pronostico": [] if tabla is None else [
            {"fecha": f.strftime("%Y-%m-%d"), "valor": _numero(v), "inferior": _numero(i), "superior": _numero(s)}
            for f, v, i, s in tabla[["fecha", "valor", "inferior", "superior"]].itertuples(index=False)],
        "modelo_usado": usado,
        "descripcion_modelo": descripcion,
        "advertencias": advertencias,
        "calidad_datos": calidad,
        "nota": config.NOTA,
        "segundos_calculo": round(time.perf_counter() - inicio, 3),
    }
    if len(_cache) >= _CACHE_MAXIMO:
        _cache.pop(next(iter(_cache)))
    _cache[clave] = copy.deepcopy(respuesta)
    return respuesta


def _tabla(pronostico):
    tabla = pd.DataFrame(pronostico)
    tabla["fecha"] = pd.to_datetime(tabla["fecha"])
    return tabla


def pronosticar_paciente(paciente_id, horizonte=config.HORIZONTE_DEFECTO):
    """Los 5 signos. R6: si la sistólica no supera a la diastólica, ambas pasan al base."""
    validar(None, horizonte)
    mediciones = _mediciones(paciente_id)
    signos = {s: pronosticar_signo(paciente_id, s, horizonte, mediciones=mediciones) for s in config.LISTA_SIGNOS}

    sistolica, diastolica = signos["presion_sistolica"], signos["presion_diastolica"]
    if sistolica["pronostico"] and diastolica["pronostico"]:
        r6 = coh.regla_r6(_tabla(sistolica["pronostico"]), _tabla(diastolica["pronostico"]))
        if r6:
            for signo in ("presion_sistolica", "presion_diastolica"):
                if signos[signo]["modelo_usado"] != "base":
                    signos[signo] = pronosticar_signo(paciente_id, signo, horizonte, "base", mediciones)
                signos[signo]["advertencias"].insert(0, r6)

    return {"paciente_id": int(paciente_id), "paciente": sistolica["paciente"], "horizonte": horizonte,
            "nivel_confianza": config.NIVEL_CONFIANZA, "nota": config.NOTA, "signos": list(signos.values())}


def limpiar_cache():
    _cache.clear()
