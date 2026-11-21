"""Modelos de pronóstico: base, ARIMA y Prophet.

Los tres tienen la misma interfaz:
    modelo = crear_modelo("arima")
    modelo.ajustar(serie)            # serie diaria con NaN en los huecos
    tabla = modelo.pronosticar(7)    # columnas: fecha, valor, inferior, superior
    modelo.descripcion               # texto corto para mostrar

La banda (inferior, superior) es del nivel configurado (90 % por defecto).
"""
import logging
import warnings

import numpy as np
import pandas as pd
from scipy.stats import norm

import config


class ErrorModelo(Exception):
    """El modelo no se pudo ajustar o pronosticar."""


def _fechas_futuras(serie: pd.Series, h: int) -> pd.DatetimeIndex:
    ultima = serie.dropna().index[-1]
    return pd.date_range(ultima + pd.Timedelta(days=1), periods=h, freq=config.FRECUENCIA)


def _tabla(fechas, valor, inferior, superior) -> pd.DataFrame:
    return pd.DataFrame({
        "fecha": pd.DatetimeIndex(fechas),
        "valor": np.asarray(valor, dtype=float),
        "inferior": np.asarray(inferior, dtype=float),
        "superior": np.asarray(superior, dtype=float),
    })


def _validar_serie(serie: pd.Series, minimo: int = 4) -> pd.Series:
    if serie is None or serie.dropna().shape[0] < minimo:
        raise ErrorModelo(f"Se necesitan al menos {minimo} días con dato.")
    # Serie diaria continua (los días faltantes quedan como NaN)
    serie = serie.loc[serie.first_valid_index():serie.last_valid_index()]
    return serie.asfreq(config.FRECUENCIA).astype(float)


class ModeloBase:
    """Promedio de los últimos 3 valores registrados.

    La banda sale de los errores que esta misma regla habría cometido en el
    historial, medidos a 1, 2, ..., h pasos. Por eso crece con el horizonte.
    Se usan 3 valores (y no 7) porque con 7 la proyección se queda atrás cuando
    un signo empieza a subir, por ejemplo con fiebre.
    """

    nombre = "base"

    def __init__(self, nivel: float = config.NIVEL_CONFIANZA, ventana: int = config.VENTANA_BASE):
        self.nivel = nivel
        self.ventana = ventana
        self.descripcion = f"Promedio de los últimos {ventana} valores registrados"

    def ajustar(self, serie: pd.Series) -> "ModeloBase":
        self.serie = _validar_serie(serie, minimo=1)
        self.valores = self.serie.dropna().to_numpy()
        return self

    def _errores_por_paso(self, h: int) -> np.ndarray:
        """Error típico (raíz del error cuadrático medio) a 1..h pasos."""
        v, w = self.valores, self.ventana
        rmse = np.full(h, np.nan)
        for k in range(1, h + 1):
            errores = [v[i + k - 1] - v[i - w:i].mean() for i in range(w, len(v) - k + 1)]
            if len(errores) >= 5:
                rmse[k - 1] = np.sqrt(np.mean(np.square(errores)))
        if np.isnan(rmse[0]):
            # Muy poco historial: se usa la variación entre valores registrados
            sd = np.std(v, ddof=1) if len(v) > 1 else 0.0
            rmse[0] = sd if sd > 0 else max(abs(v.mean()) * 0.02, 1e-6)
        # Para pasos sin suficientes ejemplos se extrapola con raíz cuadrada
        ultimo = 0
        for k in range(h):
            if np.isnan(rmse[k]):
                rmse[k] = rmse[ultimo] * np.sqrt((k + 1) / (ultimo + 1))
            else:
                ultimo = k
        return np.maximum.accumulate(rmse)   # nunca se angosta con el horizonte

    def pronosticar(self, h: int) -> pd.DataFrame:
        valor = self.valores[-self.ventana:].mean()
        z = norm.ppf(0.5 + self.nivel / 2)
        margen = z * self._errores_por_paso(h)
        return _tabla(_fechas_futuras(self.serie, h), np.full(h, valor),
                      valor - margen, valor + margen)


class ModeloArima:
    """ARIMA de statsmodels. Prueba varias combinaciones y se queda con la de menor AIC.

    d=0 con tendencia 'c' (nivel constante) y d=1 con tendencia 'n' (sin deriva)
    o 't' (con deriva), p en {0,1,2} y q en {0,1}. El filtro de Kalman tolera
    los días vacíos sin rellenarlos.
    """

    nombre = "arima"
    COMBINACIONES = ([(p, 0, q, "c") for p in (0, 1, 2) for q in (0, 1)]
                     + [(p, 1, q, t) for p in (0, 1, 2) for q in (0, 1) for t in ("n", "t")])

    def __init__(self, nivel: float = config.NIVEL_CONFIANZA):
        self.nivel = nivel
        self.descripcion = "ARIMA"

    def ajustar(self, serie: pd.Series) -> "ModeloArima":
        from statsmodels.tsa.arima.model import ARIMA

        self.serie = _validar_serie(serie, minimo=8)
        mejor, mejor_aic = None, np.inf
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            for p, d, q, tendencia in self.COMBINACIONES:
                try:
                    resultado = ARIMA(self.serie, order=(p, d, q), trend=tendencia).fit()
                except Exception:   # se ignoran los ajustes que fallan
                    continue
                if np.isfinite(resultado.aic) and resultado.aic < mejor_aic:
                    mejor, mejor_aic = (resultado, (p, d, q), tendencia), resultado.aic
        if mejor is None:
            raise ErrorModelo("Ninguna combinación de ARIMA se pudo ajustar.")
        self.resultado, self.orden, self.tendencia = mejor
        self.aic = mejor_aic
        self.descripcion = f"ARIMA{self.orden} tendencia='{self.tendencia}'"
        return self

    def pronosticar(self, h: int) -> pd.DataFrame:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            pron = self.resultado.get_forecast(h).summary_frame(alpha=1 - self.nivel)
        tabla = _tabla(_fechas_futuras(self.serie, h), pron["mean"],
                       pron["mean_ci_lower"], pron["mean_ci_upper"])
        if not np.isfinite(tabla[["valor", "inferior", "superior"]].to_numpy()).all():
            raise ErrorModelo("ARIMA produjo valores no numéricos.")
        return tabla


class ModeloProphet:
    """Prophet con estacionalidad semanal (solo con 21 días o más de datos)."""

    nombre = "prophet"

    def __init__(self, nivel: float = config.NIVEL_CONFIANZA):
        self.nivel = nivel
        self.descripcion = "Prophet"

    def ajustar(self, serie: pd.Series) -> "ModeloProphet":
        logging.getLogger("prophet.plot").disabled = True   # aviso de plotly al importar
        from prophet import Prophet

        # Silenciar los mensajes de cmdstanpy y prophet (después de importarlos,
        # porque cmdstanpy configura su propio registro al cargarse)
        for nombre in ("cmdstanpy", "prophet", "prophet.plot"):
            registro = logging.getLogger(nombre)
            registro.setLevel(logging.CRITICAL)
            registro.propagate = False
            registro.disabled = True

        self.serie = _validar_serie(serie, minimo=4)
        datos = self.serie.dropna().reset_index()
        datos.columns = ["ds", "y"]
        semanal = len(datos) >= 21
        self.modelo = Prophet(interval_width=self.nivel,
                              weekly_seasonality=semanal,
                              daily_seasonality=False,
                              yearly_seasonality=False,
                              changepoint_prior_scale=0.05)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self.modelo.fit(datos)
        except Exception as error:
            raise ErrorModelo(f"Prophet no se pudo ajustar: {error}") from error
        self.descripcion = f"Prophet (semanal={'sí' if semanal else 'no'}, changepoint_prior_scale=0.05)"
        return self

    def pronosticar(self, h: int) -> pd.DataFrame:
        fechas = _fechas_futuras(self.serie, h)
        # Prophet calcula la banda con simulaciones al azar: semilla fija para que
        # la misma serie dé siempre el mismo resultado
        estado = np.random.get_state()
        np.random.seed(0)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                pred = self.modelo.predict(pd.DataFrame({"ds": fechas}))
        finally:
            np.random.set_state(estado)
        return _tabla(fechas, pred["yhat"], pred["yhat_lower"], pred["yhat_upper"])


_MODELOS = {"base": ModeloBase, "arima": ModeloArima, "prophet": ModeloProphet}


def crear_modelo(nombre: str, nivel: float = config.NIVEL_CONFIANZA):
    if nombre not in _MODELOS:
        raise ValueError(f"Modelo desconocido: {nombre}. Usa uno de {list(_MODELOS)}.")
    return _MODELOS[nombre](nivel=nivel)
