import assert from 'node:assert/strict';
import test from 'node:test';
import { pacientesDemo } from '../src/pacientes-demo.js';
import {
  construirPromptResumen, formatearResumen, limpiarCacheResumen, registrosParaResumen, resumirExpediente, verificarResumen,
} from '../src/resumen.js';

const base = { rol: 'doctor', medicoId: 'rivera', pacientes: pacientesDemo };
const rosa = pacientesDemo.find(p => p.nombre === 'Rosa Martínez');

const resumenCorrecto = `Antecedentes:
- Hipertensión arterial [1]
- Osteoporosis diagnosticada en 2022 [2]
Alergias:
- Penicilina, reacción anafiláctica en 2010 [3]
Medicamentos:
- Amlodipino 5 mg [4]
Consultas previas:
- Sin registros`;

function ollamaFalso(contenido) {
  const llamadas = [];
  const fetchFn = async (url, opciones) => {
    llamadas.push({ url, cuerpo: JSON.parse(opciones.body) });
    return { ok: true, json: async () => ({ message: { content: contenido } }) };
  };
  return { fetchFn, llamadas };
}

test('el resumen usa antecedentes, alergias, medicamentos y consultas, sin signos sueltos', () => {
  const andrea = { ...pacientesDemo[0], data: { readings: [{ id: 'a', date: '2026-11-13', pulse: 74, systolic: 118, diastolic: 78 }] } };
  const fuentes = registrosParaResumen(andrea).map(r => r.fuente);
  assert.ok(fuentes.includes('Antecedentes'));
  assert.ok(fuentes.includes('Alergias'));
  assert.ok(fuentes.includes('Medicamentos'));
  assert.ok(fuentes.some(f => f.startsWith('Consulta')));
  assert.ok(!fuentes.some(f => f.startsWith('Signos')));
});

test('el prompt numera los registros y pide los cuatro apartados', () => {
  const registros = registrosParaResumen(rosa);
  const [sistema, usuario] = construirPromptResumen(rosa, registros);
  for (const apartado of ['Antecedentes', 'Alergias', 'Medicamentos', 'Consultas previas']) assert.match(sistema.content, new RegExp(apartado));
  assert.match(sistema.content, /TODAS las alergias/);
  assert.match(usuario.content, /\[1\] \(Antecedentes\)/);
});

test('un resumen correcto no genera advertencias', () => {
  assert.deepEqual(verificarResumen(resumenCorrecto, registrosParaResumen(rosa)), []);
});

test('detecta una alergia omitida', () => {
  const sinAlergia = resumenCorrecto.replace('- Penicilina, reacción anafiláctica en 2010 [3]', '- Sin registros');
  const advertencias = verificarResumen(sinAlergia, registrosParaResumen(rosa));
  assert.ok(advertencias.some(a => a.includes('Penicilina')));
});

test('detecta citas inventadas, apartados faltantes y resúmenes sin citas', () => {
  const registros = registrosParaResumen(rosa);
  assert.ok(verificarResumen(resumenCorrecto + '\n- Dato extra [42]', registros).some(a => a.includes('[42]')));
  assert.ok(verificarResumen(resumenCorrecto.replace('Medicamentos:', 'Fármacos:'), registros).some(a => a.includes('Medicamentos')));
  assert.ok(verificarResumen(resumenCorrecto.replace(/\[\d+\]/g, ''), registros).some(a => a.includes('no cita')));
});

test('no exige mencionar alergias si el paciente no tiene', () => {
  const carlos = pacientesDemo.find(p => p.nombre === 'Carlos Hernández');
  const resumen = 'Antecedentes:\n- Diabetes tipo 2 [1]\nAlergias:\n- No tiene alergias conocidas [2]\nMedicamentos:\n- Metformina [3]\nConsultas previas:\n- Control de diabetes [5]';
  assert.deepEqual(verificarResumen(resumen, registrosParaResumen(carlos)), []);
});

test('genera el resumen con Ollama y lo reutiliza si el expediente no cambia', async () => {
  limpiarCacheResumen();
  const { fetchFn, llamadas } = ollamaFalso(resumenCorrecto);
  const resultado = await resumirExpediente({ ...base, pacienteId: rosa.id, fetchFn });
  assert.equal(resultado.paciente, 'Rosa Martínez');
  assert.deepEqual(resultado.advertencias, []);
  assert.equal(llamadas[0].url, '/ollama/api/chat');
  assert.equal(llamadas[0].cuerpo.options.temperature, 0);
  await resumirExpediente({ ...base, pacienteId: rosa.id, fetchFn });
  assert.equal(llamadas.length, 1);
});

test('solo el médico asignado puede generar el resumen', async () => {
  const { fetchFn, llamadas } = ollamaFalso(resumenCorrecto);
  await assert.rejects(resumirExpediente({ ...base, pacienteId: 'p12', fetchFn }), /permiso/);
  await assert.rejects(resumirExpediente({ ...base, rol: 'nurse', pacienteId: rosa.id, fetchFn }), /permiso/);
  assert.equal(llamadas.length, 0);
});

test('acepta sinónimos entre paréntesis y la primera palabra de la alergia', () => {
  const lucia = pacientesDemo.find(p => p.nombre === 'Lucía Torres');
  const maria = pacientesDemo.find(p => p.nombre === 'María Fernández');
  const plantilla = alergia => `Antecedentes:\n- Dato [1]\nAlergias:\n- ${alergia} [2]\nMedicamentos:\n- Dato [3]\nConsultas previas:\n- Sin registros`;
  assert.deepEqual(verificarResumen(plantilla('Alergia a sulfas'), registrosParaResumen(lucia)), []);
  assert.deepEqual(verificarResumen(plantilla('Ácaros y polen'), registrosParaResumen(maria)), []);
  assert.ok(verificarResumen(plantilla('Sin registros'), registrosParaResumen(lucia)).length > 0);
});

test('separa títulos y viñetas aunque el modelo los escriba en la misma línea', () => {
  const enLinea = 'Antecedentes: - Diabetes tipo 2 diagnosticada en 2019 [1].\nAlergias: - Ninguna alergia conocida [2]. - Otro dato [3].';
  assert.deepEqual(formatearResumen(enLinea), [
    { tipo: 'titulo', texto: 'Antecedentes:' },
    { tipo: 'item', texto: 'Diabetes tipo 2 diagnosticada en 2019 [1].' },
    { tipo: 'titulo', texto: 'Alergias:' },
    { tipo: 'item', texto: 'Ninguna alergia conocida [2].' },
    { tipo: 'item', texto: 'Otro dato [3].' },
  ]);
  assert.deepEqual(formatearResumen('**Alergias:**\n* Penicilina [4]'), [
    { tipo: 'titulo', texto: 'Alergias:' },
    { tipo: 'item', texto: 'Penicilina [4]' },
  ]);
});
