import numpy as np
import pandas as pd

import config
from datos import cargar_mediciones
from preparacion import historial_suficiente, limpiar, preparar, serie_diaria


def mediciones(filas):
    tabla = pd.DataFrame(filas)
    tabla["medido_en"] = pd.to_datetime(tabla["medido_en"])
    for columna in config.LISTA_SIGNOS:
        if columna not in tabla:
            tabla[columna] = np.nan
    tabla["es_atipica"] = tabla.get("es_atipica", pd.Series(False, index=tabla.index)).fillna(False).astype(bool)
    tabla["paciente"] = "Prueba"
    return tabla


def test_limpieza_descarta_valores_imposibles():
    tabla = mediciones([
        {"medido_en": "2026-11-01 08:00", "temperatura": 365.0},
        {"medido_en": "2026-11-01 09:00", "temperatura": 36.7},
        {"medido_en": "2026-11-02 08:00", "temperatura": 9.8},
    ])
    limpia, descartados = limpiar(tabla, "temperatura")
    assert descartados == 2
    assert limpia["temperatura"].tolist()[1] == 36.7
    assert limpia["temperatura"].isna().sum() == 2


def test_errores_de_captura_de_la_demo_se_descartan():
    datos = cargar_mediciones()
    assert (datos["temperatura"] == 365).sum() == 1
    assert (datos["frecuencia_cardiaca"] == 0).sum() == 1
    assert (datos["saturacion_oxigeno"] == 9.8).sum() == 1
    _, calidad = preparar(cargar_mediciones(1), "temperatura")
    assert calidad["valores_descartados"] == 1
    _, calidad = preparar(cargar_mediciones(2), "frecuencia_cardiaca")
    assert calidad["valores_descartados"] == 1
    _, calidad = preparar(cargar_mediciones(3), "saturacion_oxigeno")
    assert calidad["valores_descartados"] == 1


def test_agrupacion_diaria_deja_huecos_sin_interpolar():
    tabla = mediciones([
        {"medido_en": "2026-11-01 08:00", "frecuencia_cardiaca": 70},
        {"medido_en": "2026-11-01 20:00", "frecuencia_cardiaca": 80},
        {"medido_en": "2026-11-04 09:00", "frecuencia_cardiaca": 72},
        {"medido_en": "2026-11-05 09:00", "frecuencia_cardiaca": None},
    ])
    serie = serie_diaria(tabla, "frecuencia_cardiaca")
    assert [f.strftime("%Y-%m-%d") for f in serie.index] == ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]
    assert serie.iloc[0] == 75            # promedio del día
    assert serie.iloc[1:3].isna().all()   # huecos como NaN, sin interpolar
    assert serie.iloc[-1] == 72           # sin vacío al final


def test_excluye_atipicas_y_las_cuenta():
    tabla = mediciones([
        {"medido_en": "2026-11-01 08:00", "frecuencia_cardiaca": 70, "es_atipica": False},
        {"medido_en": "2026-11-01 09:00", "frecuencia_cardiaca": 130, "es_atipica": True},
        {"medido_en": "2026-11-02 08:00", "frecuencia_cardiaca": 72, "es_atipica": False},
    ])
    serie, calidad = preparar(tabla, "frecuencia_cardiaca")
    assert serie.iloc[0] == 70
    assert calidad["mediciones_atipicas_excluidas"] == 1


def test_andrea_tiene_dos_atipicas_excluidas():
    serie, calidad = preparar(cargar_mediciones(1), "frecuencia_cardiaca")
    assert calidad["mediciones_atipicas_excluidas"] == 2
    assert calidad["dias_totales"] == 120
    assert 0 < calidad["porcentaje_huecos"] < 30
    assert serie.max() < 120   # las lecturas de 128 y 131 lpm no entran


def test_elena_no_tiene_historial_suficiente():
    _, calidad = preparar(cargar_mediciones(6), "presion_sistolica")
    assert calidad["dias_con_dato"] < 14
    assert not historial_suficiente(calidad)
