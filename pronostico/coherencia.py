"""Reglas de verificación de coherencia de un pronóstico.

Se aplican ANTES de mostrar cualquier proyección.

    R0  historial insuficiente                 -> sin_pronostico
    R1  valor proyectado fuera del rango posible -> rechazo
    R2  primer valor se aleja demasiado de los últimos registros -> rechazo
    R3  banda y valor se recortan al rango posible (corrección, sin mensaje)
    R4  banda más ancha que 1.5 x rango del último mes -> aviso de poca precisión
    R5  último valor proyectado fuera del rango de referencia -> aviso "Revisar en consulta"
    R6  sistólica proyectada <= diastólica -> rechazo de ambas (se usa el base)

Cada advertencia es un diccionario: {"regla", "tipo", "mensaje"}.
"""
import numpy as np
import pandas as pd

import config

RECHAZO, AVISO, SIN_PRONOSTICO = "rechazo", "aviso", "sin_pronostico"


def advertencia(regla: str, tipo: str, mensaje: str) -> dict:
    return {"regla": regla, "tipo": tipo, "mensaje": mensaje}


def _fmt(x: float) -> str:
    return f"{x:.1f}"


def regla_r0(calidad: dict) -> dict | None:
    if calidad["dias_con_dato"] < config.MIN_DIAS_CON_DATO:
        return advertencia(
            "R0", SIN_PRONOSTICO,
            f"Historial insuficiente: hay {calidad['dias_con_dato']} días con dato y se "
            f"necesitan al menos {config.MIN_DIAS_CON_DATO} para proyectar.")
    return None


def regla_r1(signo: str, pron: pd.DataFrame) -> dict | None:
    minimo, maximo = config.SIGNOS[signo]["posible"]
    fuera = pron[(pron["valor"] < minimo) | (pron["valor"] > maximo)]
    if not fuera.empty:
        return advertencia(
            "R1", RECHAZO,
            f"Se rechazó la proyección: llega a {_fmt(fuera['valor'].iloc[0])}, fuera del "
            f"rango posible ({minimo}-{maximo} {config.SIGNOS[signo]['unidad']}).")
    return None


def limite_salto(serie: pd.Series) -> float:
    """Salto máximo permitido para el primer valor proyectado (regla R2)."""
    variacion = serie.diff().abs().dropna()           # solo días consecutivos con dato
    if len(variacion) < 3:
        variacion = serie.dropna().diff().abs().dropna()
    mediana = float(variacion.median()) if len(variacion) else 0.0
    desv = float(serie.dropna().std(ddof=1)) if serie.notna().sum() > 1 else 0.0
    return config.R2_FACTOR_MEDIANA * mediana + config.R2_FACTOR_DESV * desv


def regla_r2(signo: str, serie: pd.Series, pron: pd.DataFrame) -> dict | None:
    promedio = float(serie.dropna().iloc[-config.VENTANA_BASE:].mean())
    salto = abs(float(pron["valor"].iloc[0]) - promedio)
    limite = limite_salto(serie)
    if salto > limite:
        return advertencia(
            "R2", RECHAZO,
            f"Se rechazó la proyección: el primer valor ({_fmt(pron['valor'].iloc[0])}) se aleja "
            f"{_fmt(salto)} del promedio de los últimos registros ({_fmt(promedio)}); "
            f"lo máximo esperado es {_fmt(limite)}.")
    return None


def regla_r3(signo: str, pron: pd.DataFrame) -> pd.DataFrame:
    """Recorta valor y banda al rango posible (por ejemplo, SpO2 nunca pasa de 100)."""
    minimo, maximo = config.SIGNOS[signo]["posible"]
    pron = pron.copy()
    for col in ("valor", "inferior", "superior"):
        pron[col] = pron[col].clip(minimo, maximo)
    return pron


def regla_r4(signo: str, serie: pd.Series, pron: pd.DataFrame) -> dict | None:
    ultimo_mes = serie.loc[serie.index[-1] - pd.Timedelta(days=config.R4_DIAS_MES - 1):].dropna()
    rango = float(ultimo_mes.max() - ultimo_mes.min()) if len(ultimo_mes) else 0.0
    ancho = float((pron["superior"] - pron["inferior"]).max())
    if rango > 0 and ancho > config.R4_FACTOR_ANCHO * rango:
        return advertencia(
            "R4", AVISO,
            f"Proyección de poca precisión: el margen llega a {_fmt(ancho)} "
            f"{config.SIGNOS[signo]['unidad']}, más de {config.R4_FACTOR_ANCHO} veces la "
            f"variación del último mes ({_fmt(rango)}).")
    return None


def regla_r5(signo: str, pron: pd.DataFrame) -> dict | None:
    info = config.SIGNOS[signo]
    minimo, maximo = info["referencia"]
    ultimo = float(pron["valor"].iloc[-1])
    if ultimo < minimo or ultimo > maximo:
        lado = "por encima" if ultimo > maximo else "por debajo"
        return advertencia(
            "R5", AVISO,
            f"Revisar en consulta: la tendencia proyectada termina en {_fmt(ultimo)} "
            f"{info['unidad']}, {lado} del rango de referencia ({minimo}-{maximo}).")
    return None


def regla_r6(pron_sistolica: pd.DataFrame, pron_diastolica: pd.DataFrame) -> dict | None:
    unidos = pron_sistolica.merge(pron_diastolica, on="fecha", suffixes=("_s", "_d"))
    malos = unidos[unidos["valor_s"] <= unidos["valor_d"]]
    if not malos.empty:
        return advertencia(
            "R6", RECHAZO,
            "Se rechazaron las proyecciones de presión: la sistólica proyectada no fue mayor "
            "que la diastólica. Se muestra el modelo base.")
    return None


def verificar_rechazo(signo: str, serie: pd.Series, pron: pd.DataFrame) -> dict | None:
    """Reglas que invalidan un pronóstico (R1 y R2). Regresa la advertencia o None."""
    if not np.isfinite(pron[["valor", "inferior", "superior"]].to_numpy()).all():
        return advertencia("R1", RECHAZO, "Se rechazó la proyección: tiene valores no numéricos.")
    return regla_r1(signo, pron) or regla_r2(signo, serie, pron)


def aplicar_correcciones_y_avisos(signo: str, serie: pd.Series,
                                  pron: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """R3 (recorte) y luego los avisos R4 y R5 sobre un pronóstico ya aceptado."""
    pron = regla_r3(signo, pron)
    avisos = [a for a in (regla_r4(signo, serie, pron), regla_r5(signo, pron)) if a]
    return pron, avisos
