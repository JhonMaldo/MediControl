"""Limpieza de mediciones y armado de series diarias.

Pasos para un paciente y un signo:
    1. quitar las mediciones marcadas como atípicas (es_atipica = TRUE);
    2. dejar vacío todo valor fuera del rango posible (error de captura);
    3. promediar por día; los días sin medición quedan como NaN (NO se interpola);
    4. quitar los vacíos del inicio y del final.
"""
import numpy as np
import pandas as pd

import config
from datos import separar_atipicas


def limpiar(mediciones, signo):
    """Deja como NaN los valores imposibles. Regresa (tabla, cuántos se descartaron)."""
    minimo, maximo = config.SIGNOS[signo]["posible"]
    tabla = mediciones.copy()
    imposibles = tabla[signo].notna() & ~tabla[signo].between(minimo, maximo)
    tabla.loc[imposibles, signo] = np.nan
    return tabla, int(imposibles.sum())


def serie_diaria(mediciones, signo):
    """Promedio por día. Días sin medición = NaN. Sin vacíos al inicio ni al final."""
    datos = mediciones[["medido_en", signo]].dropna()
    if datos.empty:
        return pd.Series(dtype=float, name=signo, index=pd.DatetimeIndex([], name="fecha"))
    serie = datos.set_index("medido_en")[signo].resample(config.FRECUENCIA).mean()
    serie = serie.loc[serie.first_valid_index():serie.last_valid_index()]
    serie.index.name = "fecha"
    return serie.rename(signo)


def calidad_datos(serie, descartados, atipicas):
    dias_totales = int(len(serie))
    dias_con_dato = int(serie.notna().sum())
    return {
        "dias_totales": dias_totales,
        "dias_con_dato": dias_con_dato,
        "porcentaje_huecos": round(100 * (dias_totales - dias_con_dato) / dias_totales, 1) if dias_totales else 0.0,
        "valores_descartados": descartados,
        "mediciones_atipicas_excluidas": atipicas,
    }


def preparar(mediciones, signo):
    """Mediciones de un paciente -> (serie diaria, calidad_datos)."""
    sin_atipicas, atipicas = separar_atipicas(mediciones)
    limpias, descartados = limpiar(sin_atipicas, signo)
    serie = serie_diaria(limpias, signo)
    return serie, calidad_datos(serie, descartados, atipicas)


def historial_suficiente(calidad):
    """Regla R0: se necesitan al menos 14 días con dato."""
    return calidad["dias_con_dato"] >= config.MIN_DIAS_CON_DATO
