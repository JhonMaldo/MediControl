"""Historial ficticio de signos vitales para la demostración.

Mismos pacientes e ids que la predicción de inasistencia, para poder unir los datos:
    1 Andrea López   estable (con dos mediciones marcadas como atípicas)
    2 Laura Gómez    presión que sube poco a poco y es más alta los fines de semana
    3 Mateo Cruz     presión que baja después de iniciar tratamiento
    4 Sofía Pérez    infección en los últimos 12 días (sube temperatura y
                     frecuencia, baja saturación)
    5 Diego Ruiz     saturación baja y variable (cerca de 92 %)
    6 Elena Díaz     solo 10 días de historial

Detalles: 120 días que terminan el 2026-11-19, 1 o 2 mediciones al día a horas
irregulares, días sin registro, valores faltantes, ruido con memoria AR(1) y
semilla fija. Incluye errores de captura (temperatura 365, frecuencia 0 y
saturación 9.8) para que la limpieza los descarte.
"""
from datetime import datetime, timedelta

import numpy as np

PACIENTES = {1: "Andrea López", 2: "Laura Gómez", 3: "Mateo Cruz",
             4: "Sofía Pérez", 5: "Diego Ruiz", 6: "Elena Díaz"}
ULTIMO_DIA = datetime(2026, 11, 19)
DIAS = 120
SEMILLA = 46

# Nivel normal y desviación del ruido diario de cada signo
NORMAL = {
    "frecuencia_cardiaca": (72, 4.0),
    "presion_sistolica": (118, 5.0),
    "presion_diastolica": (76, 3.5),
    "temperatura": (36.6, 0.15),
    "saturacion_oxigeno": (97.5, 0.8),
}


def ruido_ar1(rng, n, desviacion, phi=0.6):
    """Ruido con memoria: un día alto suele seguir de otro día alto."""
    choques = rng.normal(0, desviacion * np.sqrt(1 - phi ** 2), n)
    ruido = np.zeros(n)
    ruido[0] = rng.normal(0, desviacion)
    for t in range(1, n):
        ruido[t] = phi * ruido[t - 1] + choques[t]
    return ruido


def niveles(paciente_id, fechas, rng):
    """Nivel diario de cada signo según el escenario del paciente."""
    n = len(fechas)
    t = np.arange(n)
    nivel = {signo: np.full(n, float(valor)) for signo, (valor, _) in NORMAL.items()}
    desviacion = {signo: d for signo, (_, d) in NORMAL.items()}
    fin_semana = np.array([fecha.weekday() >= 5 for fecha in fechas], dtype=float)

    if paciente_id == 2:
        nivel["presion_sistolica"] = 126 + 24 * t / (n - 1) + 6 * fin_semana
        nivel["presion_diastolica"] = 80 + 12 * t / (n - 1) + 4 * fin_semana
    elif paciente_id == 3:
        dias_tratamiento = np.clip(t - 60, 0, None)
        efecto = 1 - np.exp(-dias_tratamiento / 15)
        nivel["presion_sistolica"] = 156 - 30 * efecto
        nivel["presion_diastolica"] = 98 - 17 * efecto
    elif paciente_id == 4:
        avance = (np.clip(t - (n - 12) + 1, 0, None) / 12) ** 0.8
        nivel["temperatura"] = 36.6 + 2.0 * avance
        nivel["frecuencia_cardiaca"] = 74 + 30 * avance
        nivel["saturacion_oxigeno"] = 97.5 - 4.5 * avance
    elif paciente_id == 5:
        nivel["saturacion_oxigeno"][:] = 92.0
        desviacion["saturacion_oxigeno"] = 1.6
        nivel["frecuencia_cardiaca"][:] = 84.0

    return {signo: nivel[signo] + ruido_ar1(rng, n, desviacion[signo]) for signo in nivel}


def redondear(signo, valor):
    if signo == "temperatura":
        return round(float(valor), 1)
    if signo == "saturacion_oxigeno":
        return float(min(100, round(valor)))
    return int(round(valor))


def demo_rows():
    """Regresa las mediciones como diccionarios con las columnas de signos_vitales."""
    rng = np.random.default_rng(SEMILLA)
    filas = []
    for paciente_id, nombre in PACIENTES.items():
        dias = 10 if paciente_id == 6 else DIAS
        fechas = [ULTIMO_DIA - timedelta(days=dias - 1 - i) for i in range(dias)]
        nivel = niveles(paciente_id, fechas, rng)
        for i, dia in enumerate(fechas):
            # Día sin registro (el último día siempre tiene medición)
            if i < dias - 1 and rng.random() < 0.15:
                continue
            minutos = sorted(int(m) for m in rng.integers(7 * 60, 21 * 60, size=rng.choice([1, 2], p=[0.6, 0.4])))
            for minuto in minutos:
                fila = {"paciente_id": paciente_id, "paciente": nombre,
                        "medido_en": dia + timedelta(minutes=minuto)}
                for signo, (_, desviacion) in NORMAL.items():
                    if rng.random() < 0.06:        # el signo no se midió
                        fila[signo] = None
                    else:
                        fila[signo] = redondear(signo, nivel[signo][i] + rng.normal(0, desviacion * 0.4))
                fila["origen"] = "enfermeria" if rng.random() < 0.4 else "paciente"
                fila["es_atipica"] = False
                filas.append(fila)

    def por_paciente(paciente_id, posicion):
        return [fila for fila in filas if fila["paciente_id"] == paciente_id][posicion]

    # Errores de captura (a mitad del historial)
    por_paciente(1, 40)["temperatura"] = 365.0          # faltó el punto decimal
    por_paciente(2, 55)["frecuencia_cardiaca"] = 0      # campo capturado en cero
    por_paciente(3, 70)["saturacion_oxigeno"] = 9.8     # punto decimal mal puesto

    # Dos mediciones de Andrea que el módulo de atípicas ya marcó
    for posicion, frecuencia in ((60, 128), (90, 131)):
        fila = por_paciente(1, posicion)
        fila["frecuencia_cardiaca"] = frecuencia
        fila["es_atipica"] = True
    return filas
