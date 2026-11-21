"""Compara los modelos base, ARIMA y Prophet y elige el mejor por signo.

Validación con origen móvil: para cada paciente y signo se toman 4 fechas de
corte (los últimos 4 bloques de 7 días). Se entrena con lo anterior al corte,
se pronostican 7 días y se compara contra lo que realmente se registró.

Regla de elección por signo: el modelo de menor MAE, siempre que su cobertura
sea de al menos 75 % y no tenga más rechazos que el modelo base. Si ninguno
cumple, se usa el base.

Uso (desde la carpeta pronostico/, en modo demo):  python evaluar_modelos.py
Salida: resultados/evaluacion.csv y resultados/modelo_elegido.json
"""
import json
import sys
import time
from datetime import datetime

import numpy as np
import pandas as pd

import coherencia as coh
import config
from datos import cargar_mediciones, origen_datos
from modelos import crear_modelo
from preparacion import preparar

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def evaluar(datos: pd.DataFrame | None = None, modelos: list[str] = config.MODELOS,
            cortes: int = config.EVAL_CORTES, bloque: int = config.EVAL_BLOQUE,
            mostrar_avance: bool = True) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Regresa (detalle por ejercicio, resumen por signo y modelo)."""
    datos = cargar_mediciones() if datos is None else datos
    filas = []
    pronosticos = {}   # para la regla R6 (sistólica contra diastólica)

    for paciente_id, df_pac in datos.groupby("paciente_id"):
        for signo in config.LISTA_SIGNOS:
            serie, _ = preparar(df_pac, signo)
            if serie.empty:
                continue
            for c in range(cortes, 0, -1):
                corte = serie.index[-1] - pd.Timedelta(days=bloque * c)
                entrenamiento = serie.loc[:corte]
                prueba = serie.loc[corte + pd.Timedelta(days=1):corte + pd.Timedelta(days=bloque)]
                if (entrenamiento.notna().sum() < config.MIN_DIAS_CON_DATO
                        or prueba.notna().sum() == 0):
                    continue
                entrenamiento = entrenamiento.loc[:entrenamiento.last_valid_index()]
                for nombre in modelos:
                    inicio = time.perf_counter()
                    fallo = False
                    try:
                        modelo = crear_modelo(nombre).ajustar(entrenamiento)
                        pron = modelo.pronosticar(bloque)
                    except Exception:
                        fallo = True
                        pron = crear_modelo("base").ajustar(entrenamiento).pronosticar(bloque)
                    segundos = time.perf_counter() - inicio
                    rechazo = fallo or coh.verificar_rechazo(signo, entrenamiento, pron) is not None
                    pron = coh.regla_r3(signo, pron)
                    pronosticos[(paciente_id, c, nombre, signo)] = pron

                    # Comparar solo en los días que sí tienen registro
                    real = prueba.reindex(pron["fecha"]).to_numpy()
                    ok = ~np.isnan(real)
                    err = real[ok] - pron["valor"].to_numpy()[ok]
                    dentro = ((real[ok] >= pron["inferior"].to_numpy()[ok])
                              & (real[ok] <= pron["superior"].to_numpy()[ok]))
                    filas.append({"paciente_id": paciente_id, "signo": signo, "corte": corte.date(),
                                  "num_corte": c, "modelo": nombre, "n": int(ok.sum()),
                                  "suma_abs": float(np.abs(err).sum()),
                                  "suma_cuad": float(np.square(err).sum()),
                                  "dentro": int(dentro.sum()), "rechazado": bool(rechazo),
                                  "segundos": segundos})
            if mostrar_avance:
                print(f"  evaluado {paciente_id} / {signo}", flush=True)

    detalle = pd.DataFrame(filas)

    # R6: si la sistólica proyectada no supera a la diastólica, se rechazan ambas
    for (pac, c, nombre, signo), pron in pronosticos.items():
        if signo != "presion_sistolica":
            continue
        dia = pronosticos.get((pac, c, nombre, "presion_diastolica"))
        if dia is not None and coh.regla_r6(pron, dia):
            marca = ((detalle["paciente_id"] == pac) & (detalle["modelo"] == nombre)
                     & (detalle["num_corte"] == c)
                     & detalle["signo"].isin(["presion_sistolica", "presion_diastolica"]))
            detalle.loc[marca, "rechazado"] = True

    return detalle, resumir(detalle)


def resumir(detalle: pd.DataFrame) -> pd.DataFrame:
    g = detalle.groupby(["signo", "modelo"])
    resumen = pd.DataFrame({
        "ejercicios": g.size(),
        "valores_comparados": g["n"].sum(),
        "MAE": g["suma_abs"].sum() / g["n"].sum(),
        "RMSE": np.sqrt(g["suma_cuad"].sum() / g["n"].sum()),
        "cobertura_pct": 100 * g["dentro"].sum() / g["n"].sum(),
        "rechazos_pct": 100 * g["rechazado"].mean(),
        "segundos_promedio": g["segundos"].mean(),
    }).reset_index()
    mae_base = resumen[resumen["modelo"] == "base"].set_index("signo")["MAE"]
    resumen["mejora_vs_base_pct"] = 100 * (resumen["signo"].map(mae_base) - resumen["MAE"]) \
        / resumen["signo"].map(mae_base)
    orden = {s: i for i, s in enumerate(config.LISTA_SIGNOS)}
    resumen = resumen.sort_values(["signo", "modelo"], key=lambda col: col.map(orden)
                                  if col.name == "signo" else col.map({m: i for i, m in enumerate(config.MODELOS)}))
    return resumen.round({"MAE": 3, "RMSE": 3, "cobertura_pct": 1, "rechazos_pct": 1,
                          "segundos_promedio": 3, "mejora_vs_base_pct": 1}).reset_index(drop=True)


def elegir(resumen: pd.DataFrame) -> tuple[dict, dict]:
    """Aplica la regla de elección. Regresa (modelo por signo, motivo por signo)."""
    elegidos, motivos = {}, {}
    for signo in config.LISTA_SIGNOS:
        tabla = resumen[resumen["signo"] == signo].set_index("modelo")
        if tabla.empty:
            elegidos[signo], motivos[signo] = "base", "Sin datos para evaluar."
            continue
        rech_base = tabla.loc["base", "rechazos_pct"]
        aptos = tabla[(tabla["cobertura_pct"] >= config.COBERTURA_MINIMA)
                      & (tabla["rechazos_pct"] <= rech_base)]
        if aptos.empty:
            elegidos[signo] = "base"
            motivos[signo] = "Ningún modelo cumplió cobertura y rechazos; se usa el base."
            continue
        ganador = aptos["MAE"].idxmin()
        fila = tabla.loc[ganador]
        elegidos[signo] = ganador
        descartados = [f"{m} (cobertura {tabla.loc[m, 'cobertura_pct']:.1f} %, rechazos "
                       f"{tabla.loc[m, 'rechazos_pct']:.1f} %)" for m in tabla.index if m not in aptos.index]
        motivos[signo] = (f"Menor MAE entre los aptos ({fila['MAE']:.3f}, cobertura "
                          f"{fila['cobertura_pct']:.1f} %, mejora vs base {fila['mejora_vs_base_pct']:.1f} %)"
                          + (f"; no aptos: {', '.join(descartados)}" if descartados else ""))
    return elegidos, motivos


def main() -> None:
    print("Evaluando modelos con origen móvil "
          f"({config.EVAL_CORTES} cortes de {config.EVAL_BLOQUE} días)...")
    inicio = time.perf_counter()
    detalle, resumen = evaluar()
    elegidos, motivos = elegir(resumen)

    config.CARPETA_RESULTADOS.mkdir(exist_ok=True)
    resumen.to_csv(config.RUTA_EVALUACION, index=False, encoding="utf-8")
    salida = {
        "fecha": datetime.now().isoformat(timespec="seconds"),
        "origen_datos": origen_datos(),
        "criterio": (f"Por signo: menor MAE con cobertura >= {config.COBERTURA_MINIMA:g} % "
                     "y no más rechazos que el modelo base; si ninguno cumple, base. "
                     f"Origen móvil: {config.EVAL_CORTES} cortes de {config.EVAL_BLOQUE} días, "
                     f"banda {int(100 * config.NIVEL_CONFIANZA)} %."),
        "modelos": elegidos,
        "motivos": motivos,
    }
    with open(config.RUTA_MODELO_ELEGIDO, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)

    print(f"\nTerminado en {time.perf_counter() - inicio:.0f} s.\n")
    print("Resultados por signo y modelo (MAE y RMSE en la unidad del signo):\n")
    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print(resumen.to_string(index=False))
    print("\nModelo elegido por signo:")
    for signo in config.LISTA_SIGNOS:
        print(f"  {signo:<20} -> {elegidos[signo]:<8} {motivos[signo]}")
    print(f"\nGuardado: {config.RUTA_EVALUACION}\nGuardado: {config.RUTA_MODELO_ELEGIDO}")


if __name__ == "__main__":
    main()
