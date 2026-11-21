import numpy as np
import pandas as pd

import coherencia as coh


def historial(valores):
    return pd.Series(valores, index=pd.date_range("2026-10-01", periods=len(valores), freq="D"), dtype=float)


def pronostico(valores, margen=2.0):
    valores = np.asarray(valores, dtype=float)
    return pd.DataFrame({"fecha": pd.date_range("2026-11-01", periods=len(valores), freq="D"),
                         "valor": valores, "inferior": valores - margen, "superior": valores + margen})


ESTABLE = historial([72, 74, 71, 73, 75, 72, 70, 73, 74, 72, 71, 73, 72, 74, 73])


def test_r0_sin_pronostico_con_poco_historial():
    aviso = coh.regla_r0({"dias_con_dato": 10})
    assert aviso["regla"] == "R0" and aviso["tipo"] == "sin_pronostico"
    assert coh.regla_r0({"dias_con_dato": 14}) is None


def test_r1_rechaza_valores_fuera_del_rango_posible():
    aviso = coh.regla_r1("frecuencia_cardiaca", pronostico([72, 150, 240]))
    assert aviso["regla"] == "R1" and aviso["tipo"] == "rechazo"
    assert coh.regla_r1("frecuencia_cardiaca", pronostico([72, 73])) is None


def test_r2_rechaza_un_salto_inicial_grande():
    aviso = coh.regla_r2("frecuencia_cardiaca", ESTABLE, pronostico([95, 95]))
    assert aviso["regla"] == "R2" and aviso["tipo"] == "rechazo"
    assert coh.regla_r2("frecuencia_cardiaca", ESTABLE, pronostico([74, 74])) is None


def test_r3_recorta_al_rango_posible():
    tabla = coh.regla_r3("saturacion_oxigeno", pronostico([99.5, 99.8], margen=2))
    assert tabla["superior"].max() == 100
    assert tabla["valor"].max() <= 100
    assert tabla["inferior"].min() == 97.5


def test_r5_avisa_fuera_del_rango_de_referencia():
    aviso = coh.regla_r5("temperatura", pronostico([37.9, 38.3], margen=0.3))
    assert aviso["regla"] == "R5" and aviso["tipo"] == "aviso"
    assert "Revisar en consulta" in aviso["mensaje"]
    assert coh.regla_r5("temperatura", pronostico([36.6, 36.7], margen=0.3)) is None


def test_r6_rechaza_si_la_sistolica_no_supera_a_la_diastolica():
    aviso = coh.regla_r6(pronostico([120, 85]), pronostico([80, 88]))
    assert aviso["regla"] == "R6" and aviso["tipo"] == "rechazo"
    assert coh.regla_r6(pronostico([120, 121]), pronostico([80, 81])) is None


def test_r6_en_el_servicio_usa_el_base_para_ambas(monkeypatch):
    import servicio

    servicio.limpiar_cache()
    original = servicio.calcular

    def presion_invertida(serie, calidad, signo, horizonte, modelo):
        tabla, usado, descripcion, avisos = original(serie, calidad, signo, horizonte, modelo)
        if signo == "presion_sistolica" and modelo != "base":
            tabla = tabla.assign(valor=50.0, inferior=45.0, superior=55.0)
        return tabla, usado, descripcion, avisos

    monkeypatch.setattr(servicio, "calcular", presion_invertida)
    resultado = servicio.pronosticar_paciente(1, 3)
    servicio.limpiar_cache()
    presion = {s["signo"]: s for s in resultado["signos"]}
    for signo in ("presion_sistolica", "presion_diastolica"):
        assert presion[signo]["modelo_usado"] == "base"
        assert presion[signo]["advertencias"][0]["regla"] == "R6"
