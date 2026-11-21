import numpy as np
import pandas as pd
import pytest

from modelos import crear_modelo


def serie_con_tendencia(dias=60, pendiente=0.5, huecos=()):
    rng = np.random.default_rng(1)
    fechas = pd.date_range("2026-09-01", periods=dias, freq="D")
    serie = pd.Series(100 + pendiente * np.arange(dias) + rng.normal(0, 1, dias), index=fechas)
    serie.iloc[list(huecos)] = np.nan
    return serie


@pytest.mark.parametrize("nombre", ["base", "arima", "prophet"])
def test_modelos_regresan_h_filas_consecutivas_y_banda_ordenada(nombre):
    serie = serie_con_tendencia(pendiente=0)
    tabla = crear_modelo(nombre).ajustar(serie).pronosticar(7)
    assert len(tabla) == 7
    assert list(tabla.columns) == ["fecha", "valor", "inferior", "superior"]
    esperadas = pd.date_range(serie.index[-1] + pd.Timedelta(days=1), periods=7, freq="D")
    assert list(tabla["fecha"]) == list(esperadas)
    assert (tabla["inferior"] <= tabla["valor"]).all()
    assert (tabla["valor"] <= tabla["superior"]).all()


@pytest.mark.parametrize("nombre", ["base", "arima", "prophet"])
def test_modelos_toleran_huecos(nombre):
    serie = serie_con_tendencia(huecos=[5, 6, 7, 20, 33, 34, 50])
    tabla = crear_modelo(nombre).ajustar(serie).pronosticar(5)
    assert len(tabla) == 5
    assert np.isfinite(tabla[["valor", "inferior", "superior"]].to_numpy()).all()


def test_arima_sigue_una_tendencia_clara():
    serie = serie_con_tendencia(pendiente=0.5)
    tabla = crear_modelo("arima").ajustar(serie).pronosticar(7)
    assert tabla["valor"].iloc[-1] > tabla["valor"].iloc[0]      # sigue subiendo
    assert tabla["valor"].iloc[-1] > serie.iloc[-1]              # no se queda atrás
    assert abs(tabla["valor"].iloc[-1] - (100 + 0.5 * 66)) < 4   # cerca de la recta real


def test_la_banda_del_base_crece_con_el_horizonte():
    tabla = crear_modelo("base").ajustar(serie_con_tendencia(pendiente=0)).pronosticar(10)
    ancho = (tabla["superior"] - tabla["inferior"]).to_numpy()
    assert (np.diff(ancho) >= 0).all()
    assert ancho[-1] > ancho[0]


def test_modelo_desconocido():
    with pytest.raises(ValueError):
        crear_modelo("lstm")
