"""Carga de mediciones: MariaDB o datos de demostración en memoria.

Es el único módulo que sabe de dónde vienen los datos.
    - Si existe DB_HOST, lee la tabla signos_vitales de MariaDB con PyMySQL.
      Con SEED_DEMO=1 y la tabla vacía, inserta los datos demo (preparar_base).
    - Si no existe DB_HOST, usa los datos de demo.py en memoria (modo local).

Este módulo NO detecta lecturas atípicas: eso lo hace el módulo de Jonathan.
Solo separa las filas que ya llegan marcadas con es_atipica = TRUE.
"""
import os

import pandas as pd

import config
from demo import demo_rows

COLUMNAS_TABLA = ["paciente_id", "paciente", "medido_en", *config.LISTA_SIGNOS, "origen", "es_atipica"]


class BaseNoDisponible(Exception):
    """MariaDB no responde."""


def origen_datos():
    return "mariadb" if os.environ.get("DB_HOST") else "demo"


def _conectar():
    import pymysql
    try:
        return pymysql.connect(
            host=os.environ["DB_HOST"], port=int(os.environ.get("DB_PORT", "3306")),
            user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
            database=os.environ["DB_NAME"], cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5, read_timeout=10, charset="utf8mb4",
        )
    except pymysql.MySQLError as error:
        raise BaseNoDisponible(str(error)) from error


def _consultar(sql, parametros=()):
    import pymysql
    try:
        with _conectar() as conexion, conexion.cursor() as cursor:
            cursor.execute(sql, parametros)
            return cursor.fetchall()
    except pymysql.MySQLError as error:
        raise BaseNoDisponible(str(error)) from error


def preparar_base():
    """Con SEED_DEMO=1 y la tabla vacía, inserta el historial de demostración."""
    if origen_datos() != "mariadb" or os.environ.get("SEED_DEMO") != "1":
        return 0
    import pymysql
    try:
        with _conectar() as conexion, conexion.cursor() as cursor:
            cursor.execute("SELECT 1 FROM signos_vitales LIMIT 1")
            if cursor.fetchone() is not None:
                return 0
            filas = demo_rows()
            cursor.executemany(
                f"INSERT INTO signos_vitales ({', '.join(COLUMNAS_TABLA)}) "
                f"VALUES ({', '.join(['%s'] * len(COLUMNAS_TABLA))})",
                [tuple(fila[c] for c in COLUMNAS_TABLA) for fila in filas],
            )
            conexion.commit()
            return len(filas)
    except pymysql.MySQLError as error:
        raise BaseNoDisponible(str(error)) from error


_demo = None


def _tabla_demo():
    global _demo
    if _demo is None:
        tabla = pd.DataFrame(demo_rows())
        tabla.insert(0, "id", range(1, len(tabla) + 1))
        _demo = tabla
    return _demo


def _normalizar(tabla):
    """Mismas columnas y tipos sin importar el origen."""
    tabla = pd.DataFrame(tabla, columns=config.COLUMNAS)
    tabla["id"] = tabla["id"].astype("int64")
    tabla["paciente_id"] = tabla["paciente_id"].astype("int64")
    tabla["medido_en"] = pd.to_datetime(tabla["medido_en"])
    for signo in config.LISTA_SIGNOS:
        # DECIMAL llega como Decimal y los vacíos como None: todo pasa a float
        tabla[signo] = pd.to_numeric(tabla[signo].astype(object), errors="coerce").astype(float)
    tabla["es_atipica"] = tabla["es_atipica"].fillna(False).astype(bool)
    return tabla.sort_values(["paciente_id", "medido_en", "id"]).reset_index(drop=True)


def cargar_mediciones(paciente_id=None):
    """Regresa las mediciones (de un paciente o de todos) con config.COLUMNAS."""
    if origen_datos() == "mariadb":
        sql = f"SELECT id, {', '.join(COLUMNAS_TABLA)} FROM signos_vitales"
        parametros = ()
        if paciente_id is not None:
            sql += " WHERE paciente_id = %s"
            parametros = (int(paciente_id),)
        return _normalizar(_consultar(sql + " ORDER BY paciente_id, medido_en, id", parametros))
    tabla = _tabla_demo()
    if paciente_id is not None:
        tabla = tabla[tabla["paciente_id"] == int(paciente_id)]
    return _normalizar(tabla.copy())


def listar_pacientes():
    """[{id, nombre}] de los pacientes con al menos una medición."""
    if origen_datos() == "mariadb":
        filas = _consultar("SELECT paciente_id, MAX(paciente) AS paciente FROM signos_vitales "
                           "GROUP BY paciente_id ORDER BY paciente_id")
    else:
        filas = (_tabla_demo().groupby("paciente_id", as_index=False)["paciente"].last()
                 .to_dict("records"))
    return [{"id": int(f["paciente_id"]), "nombre": f["paciente"]} for f in filas]


def separar_atipicas(mediciones):
    """Quita las filas con es_atipica = TRUE. Regresa (tabla sin ellas, cuántas había)."""
    marcadas = mediciones["es_atipica"].astype(bool)
    return mediciones[~marcadas], int(marcadas.sum())
