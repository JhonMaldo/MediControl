"""Configuración del pronóstico de signos vitales.

Todo lo que se puede ajustar está aquí: signos, unidades, rangos, horizonte,
nivel de la banda y umbrales de las reglas. El resto del código solo lee este archivo.
"""
from pathlib import Path

CARPETA = Path(__file__).resolve().parent
CARPETA_RESULTADOS = CARPETA / "resultados"
RUTA_EVALUACION = CARPETA_RESULTADOS / "evaluacion.csv"
RUTA_MODELO_ELEGIDO = CARPETA_RESULTADOS / "modelo_elegido.json"

# posible:    valores físicamente posibles. Lo que quede fuera es un error de
#             captura y se descarta.
# referencia: rango habitual de un adulto. Solo se muestra en la gráfica y se usa
#             para el aviso "Revisar en consulta" (regla R5).
SIGNOS = {
    "frecuencia_cardiaca": {"nombre": "Frecuencia cardíaca", "unidad": "lpm",
                            "posible": (30, 220), "referencia": (60, 100)},
    "presion_sistolica": {"nombre": "Presión sistólica", "unidad": "mmHg",
                          "posible": (60, 260), "referencia": (90, 130)},
    "presion_diastolica": {"nombre": "Presión diastólica", "unidad": "mmHg",
                           "posible": (30, 160), "referencia": (60, 85)},
    "temperatura": {"nombre": "Temperatura", "unidad": "°C",
                    "posible": (33, 43), "referencia": (36.0, 37.5)},
    "saturacion_oxigeno": {"nombre": "Saturación de oxígeno", "unidad": "%",
                           "posible": (70, 100), "referencia": (95, 100)},
}
LISTA_SIGNOS = list(SIGNOS)

# Columnas que regresa siempre datos.cargar_mediciones()
COLUMNAS = ["id", "paciente_id", "paciente", "medido_en", *LISTA_SIGNOS, "origen", "es_atipica"]

FRECUENCIA = "D"            # agrupación diaria
HORIZONTE_DEFECTO = 7
HORIZONTE_MAXIMO = 30
NIVEL_CONFIANZA = 0.90      # banda del 90 %
MIN_DIAS_CON_DATO = 14      # con menos no se pronostica (regla R0)

MODELOS = ["base", "arima", "prophet"]
MODELO_POR_DEFECTO = "arima"  # si no existe resultados/modelo_elegido.json
VENTANA_BASE = 3              # el modelo base promedia los últimos 3 valores

# Evaluación con origen móvil
EVAL_CORTES = 4
EVAL_BLOQUE = 7
COBERTURA_MINIMA = 75.0     # en porcentaje

# Reglas de coherencia
R2_FACTOR_MEDIANA = 4.0     # salto máximo = 4 x mediana de la variación diaria
R2_FACTOR_DESV = 0.5        #              + 0.5 x desviación estándar
R4_FACTOR_ANCHO = 1.5       # banda > 1.5 x rango del último mes -> aviso
R4_DIAS_MES = 30

NOTA = ("Proyección estadística de apoyo para el seguimiento del paciente. "
        "No es un diagnóstico.")
