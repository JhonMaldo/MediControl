import json
import os
import re
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

import numpy as np
import pymysql
import tensorflow as tf

from demo import demo_rows

ESTADOS_CONFIRMACION = ('Pendiente', 'Confirmada', 'Sin respuesta')

FEATURE_QUERY = """
SELECT c.id, c.paciente, c.programada_en, c.estado, c.confirmacion,
       TIMESTAMPDIFF(MINUTE, c.reservada_en, c.programada_en) / 1440.0 AS anticipacion,
       (SELECT COUNT(*) FROM citas h WHERE h.paciente_id = c.paciente_id
        AND h.resuelta_en < c.reservada_en AND h.estado = 'asistio') AS asistencias,
       (SELECT COUNT(*) FROM citas h WHERE h.paciente_id = c.paciente_id
        AND h.resuelta_en < c.reservada_en AND h.estado = 'inasistencia') AS inasistencias,
       (SELECT COUNT(*) FROM citas h WHERE h.paciente_id = c.paciente_id
        AND h.resuelta_en < c.reservada_en AND h.estado = 'cancelada') AS cancelaciones
FROM citas c
"""


def connect():
    return pymysql.connect(
        host=os.environ['DB_HOST'], user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'], database=os.environ['DB_NAME'],
        cursorclass=pymysql.cursors.DictCursor, connect_timeout=5, read_timeout=10,
    )


def features(rows):
    return np.array([
        [row['programada_en'].weekday(), row['programada_en'].hour + row['programada_en'].minute / 60,
         np.log1p(float(row['anticipacion'])), np.log1p(row['asistencias']),
         np.log1p(row['inasistencias']), np.log1p(row['cancelaciones'])]
        for row in rows
    ], dtype=np.float32)


def prepare():
    with connect() as connection, connection.cursor() as cursor:
        # Actualiza también los volúmenes creados antes del seguimiento de confirmaciones.
        cursor.execute("""
            ALTER TABLE citas ADD COLUMN IF NOT EXISTS confirmacion
            ENUM('Pendiente', 'Confirmada', 'Sin respuesta') NOT NULL DEFAULT 'Pendiente'
        """)
        if os.environ.get('SEED_DEMO') == '1':
            cursor.execute('SELECT 1 FROM citas LIMIT 1')
            if cursor.fetchone() is None:
                cursor.executemany(
                    'INSERT INTO citas (paciente_id, paciente, reservada_en, programada_en, estado, resuelta_en) '
                    'VALUES (%s, %s, %s, %s, %s, %s)', list(demo_rows()),
                )
                connection.commit()
        cursor.execute(FEATURE_QUERY + """
            WHERE c.estado IN ('asistio', 'inasistencia')
            ORDER BY c.programada_en, c.id
        """)
        rows = cursor.fetchall()
    if len(rows) < 40:
        raise ValueError('Se requieren al menos 40 citas con resultado de asistencia o inasistencia.')
    x = features(rows)
    y = np.array([row['estado'] == 'inasistencia' for row in rows], dtype=np.float32)
    split = int(len(rows) * .8)
    if len(set(y[:split])) < 2:
        raise ValueError('El conjunto de entrenamiento necesita ejemplos de ambas clases.')
    tf.keras.utils.set_random_seed(46)
    normalization = tf.keras.layers.Normalization()
    normalization.adapt(x[:split])
    model = tf.keras.Sequential([
        tf.keras.Input(shape=(x.shape[1],)), normalization,
        tf.keras.layers.Dense(12, activation='relu'),
        tf.keras.layers.Dense(1, activation='sigmoid'),
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(0.005), loss='binary_crossentropy')
    model.fit(x[:split], y[:split], epochs=25, batch_size=64, verbose=0)
    validation = tf.keras.metrics.AUC()
    if len(set(y[split:])) == 2:
        validation.update_state(y[split:], model(x[split:], training=False))
        print(f'AUC en el tramo cronológico reservado: {float(validation.result()):.3f}')
    else:
        print('El tramo de evaluación solo tiene una clase. AUC no disponible.')
    return model


def agenda(model, day):
    with connect() as connection, connection.cursor() as cursor:
        cursor.execute(FEATURE_QUERY + """
            WHERE c.estado = 'programada' AND c.programada_en >= %s AND c.programada_en < %s
            ORDER BY c.programada_en, c.id
        """, (day, day + timedelta(days=1)))
        rows = cursor.fetchall()
    if not rows:
        return []
    scores = model(features(rows), training=False).numpy().reshape(-1)
    ranked = sorted(zip(rows, scores), key=lambda pair: -float(pair[1]))
    return [
        {'id': row['id'], 'paciente': row['paciente'], 'hora': row['programada_en'].strftime('%H:%M'),
         'probabilidad': round(float(score), 4), 'confirmacion': row['confirmacion']}
        for row, score in ranked
    ]


def main():
    model = prepare()

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def do_PUT(self):
            ruta = re.fullmatch(r'/api/inasistencia/([1-9][0-9]{0,19})/confirmacion', urlsplit(self.path).path)
            if not ruta:
                return self.respond(404, {'error': 'Ruta desconocida'})
            cita_id = int(ruta[1])
            try:
                longitud = int(self.headers.get('Content-Length', '0'))
                if not 0 < longitud <= 1024:
                    raise ValueError
                datos = json.loads(self.rfile.read(longitud))
                if not isinstance(datos, dict):
                    raise ValueError
                anterior, nuevo = datos.get('anterior'), datos.get('confirmacion')
                if anterior not in ESTADOS_CONFIRMACION or nuevo not in ESTADOS_CONFIRMACION:
                    raise ValueError
            except (ValueError, UnicodeError):
                return self.respond(400, {'error': 'Estado de confirmación inválido.'})

            try:
                with connect() as connection, connection.cursor() as cursor:
                    cursor.execute("SELECT confirmacion FROM citas WHERE id=%s AND estado='programada' FOR UPDATE",
                                   (cita_id,))
                    cita = cursor.fetchone()
                    if not cita:
                        return self.respond(404, {'error': 'La cita ya no está programada.'})
                    if cita['confirmacion'] not in (anterior, nuevo):
                        return self.respond(409, {'error': 'Otra persona actualizó esta cita. Revisa el estado.'})
                    cursor.execute('UPDATE citas SET confirmacion=%s WHERE id=%s', (nuevo, cita_id))
                    connection.commit()
            except pymysql.MySQLError:
                return self.respond(503, {'error': 'No se pudo guardar en la agenda.'})
            self.respond(200, {'id': cita_id, 'confirmacion': nuevo})

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path != '/api/inasistencia':
                return self.respond(404, {'error': 'Ruta desconocida'})
            raw = parse_qs(url.query).get('fecha', [''])
            try:
                day = date.fromisoformat(raw[0])
                if len(raw) != 1 or day.isoformat() != raw[0]:
                    raise ValueError
                day + timedelta(days=1)
            except (ValueError, OverflowError):
                return self.respond(400, {'error': 'Usa una fecha válida en formato AAAA-MM-DD.'})
            try:
                return self.respond(200, {'fecha': day.isoformat(), 'citas': agenda(model, day)})
            except pymysql.MySQLError:
                return self.respond(503, {'error': 'La agenda no está disponible.'})

    print('API de inasistencia disponible en el puerto 8080.')
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()


if __name__ == '__main__':
    main()
