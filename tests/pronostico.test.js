import assert from 'node:assert/strict';
import test from 'node:test';
import { LIENZO, calcularGrafica, escala, obtenerPacientes, obtenerPronostico, urlPronostico, validarRespuesta } from '../src/pronostico.js';

function respuesta(cambios = {}) {
  return {
    paciente_id: 4, paciente: 'Sofía Pérez', signo: 'temperatura', nombre: 'Temperatura', unidad: '°C',
    rango_referencia: [36, 37.5], nivel_confianza: 0.9,
    historial: [
      { fecha: '2026-11-15', valor: 36.6 }, { fecha: '2026-11-16', valor: null },
      { fecha: '2026-11-17', valor: 37.4 }, { fecha: '2026-11-18', valor: 38 }, { fecha: '2026-11-19', valor: 38.4 },
    ],
    pronostico: [
      { fecha: '2026-11-20', valor: 38.5, inferior: 38, superior: 39 },
      { fecha: '2026-11-21', valor: 38.6, inferior: 37.8, superior: 39.4 },
    ],
    modelo_usado: 'arima', descripcion_modelo: "ARIMA(1, 1, 0) tendencia='n'",
    advertencias: [{ regla: 'R5', tipo: 'aviso', mensaje: 'Revisar en consulta' }],
    calidad_datos: {}, nota: 'No es un diagnóstico.',
    ...cambios,
  };
}

function simularFetch(t, estado, cuerpo) {
  const llamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones) => {
    llamadas.push({ url, opciones });
    return { ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo };
  });
  return llamadas;
}

test('arma la URL de un signo con horizonte y modelo opcional', () => {
  assert.equal(urlPronostico(4, 'temperatura', 7), '/api/pronostico/pacientes/4/signos/temperatura?horizonte=7');
  assert.equal(urlPronostico(2, 'presion_sistolica', 14, 'prophet'),
    '/api/pronostico/pacientes/2/signos/presion_sistolica?horizonte=14&modelo=prophet');
  assert.throws(() => urlPronostico(1, 'glucosa', 7));
  assert.throws(() => urlPronostico('1/../../x', 'temperatura', 7));
});

test('valida la respuesta y rechaza datos incompletos o incoherentes', () => {
  assert.equal(validarRespuesta(respuesta()).signo, 'temperatura');
  assert.doesNotThrow(() => validarRespuesta(respuesta({ pronostico: [] })));
  assert.throws(() => validarRespuesta(null));
  assert.throws(() => validarRespuesta(respuesta({ signo: 'glucosa' })));
  assert.throws(() => validarRespuesta(respuesta({ historial: [{ fecha: '19/11/2026', valor: 1 }] })));
  assert.throws(() => validarRespuesta(respuesta({ pronostico: [{ fecha: '2026-11-20', valor: 40, inferior: 38, superior: 39 }] })));
  assert.throws(() => validarRespuesta(respuesta({ advertencias: 'R5' })));
});

test('la escala es redonda e incluye todos los valores', () => {
  const e = escala([36.6, 39.4, 36, 37.5]);
  assert.ok(e.bajo <= 36 && e.alto >= 39.4);
  assert.equal(e.marcas.length, 4);
  assert.equal(e.marcas[0], e.alto);
  assert.deepEqual(e.marcas, [42, 40, 38, 36]);            // intervalos iguales y redondos
  assert.deepEqual(escala([60, 100, 152.9]).marcas, [200, 150, 100, 50]);
  const plano = escala([95, 95]);
  assert.ok(plano.alto > plano.bajo);
});

test('calcula las coordenadas de la banda y une la proyección con el último registro', () => {
  const g = calcularGrafica(respuesta());
  assert.equal(g.puntos.length, 4);                       // el hueco no se dibuja como punto
  assert.equal(g.proyectados.length, 2);
  const ultimo = g.puntos.at(-1);
  assert.ok(g.lineaProyeccion.startsWith(`${ultimo.x.toFixed(1)},${ultimo.y.toFixed(1)}`));
  assert.equal(g.separador, ultimo.x);
  for (const p of g.proyectados) {
    assert.ok(p.ySuperior <= p.y && p.y <= p.yInferior);  // en SVG, más arriba = y menor
    assert.ok(p.x > ultimo.x && p.x <= LIENZO.derecha + 1e-9);
    assert.ok(p.ySuperior >= LIENZO.arriba - 1e-9 && p.yInferior <= LIENZO.abajo + 1e-9);
  }
  // La banda: 1 punto de arranque + superior + inferior
  assert.equal(g.banda.split(' ').length, 1 + 2 * g.proyectados.length);
  assert.equal(g.puntos[0].x, LIENZO.izquierda);
  assert.ok(Math.abs(g.proyectados.at(-1).x - LIENZO.derecha) < 1e-9);
  assert.ok(g.referencia.alto > 0);
});

test('sin pronóstico solo dibuja lo registrado', () => {
  const g = calcularGrafica(respuesta({ pronostico: [] }));
  assert.equal(g.banda, '');
  assert.equal(g.lineaProyeccion, '');
  assert.equal(g.separador, null);
  assert.equal(calcularGrafica(respuesta({ historial: [{ fecha: '2026-11-19', valor: null }], pronostico: [] })), null);
});

test('pide el pronóstico con señal de cancelación y valida el resultado', async t => {
  const llamadas = simularFetch(t, 200, respuesta());
  const datos = await obtenerPronostico({ pacienteId: 4, signo: 'temperatura', horizonte: 7 });
  assert.equal(datos.paciente, 'Sofía Pérez');
  assert.equal(llamadas[0].url, '/api/pronostico/pacientes/4/signos/temperatura?horizonte=7');
  assert.ok(llamadas[0].opciones.signal instanceof AbortSignal);
});

test('lanza un error cuando la API falla o responde algo inválido', async t => {
  simularFetch(t, 503, { error: 'La base de signos vitales no está disponible.' });
  await assert.rejects(obtenerPronostico({ pacienteId: 1, signo: 'temperatura', horizonte: 7 }), /no disponible/);
  await assert.rejects(obtenerPacientes(), /no disponible/);
  t.mock.restoreAll();
  simularFetch(t, 200, { cosa: 1 });
  await assert.rejects(obtenerPronostico({ pacienteId: 1, signo: 'temperatura', horizonte: 7 }), /no válida/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(obtenerPronostico({ pacienteId: 1, signo: 'temperatura', horizonte: 7 }), /fetch failed/);
});

test('la lista de pacientes se valida', async t => {
  simularFetch(t, 200, [{ id: 1, nombre: 'Andrea López' }]);
  assert.deepEqual(await obtenerPacientes(), [{ id: 1, nombre: 'Andrea López' }]);
  t.mock.restoreAll();
  simularFetch(t, 200, [{ id: '1' }]);
  await assert.rejects(obtenerPacientes(), /no válida/);
});
