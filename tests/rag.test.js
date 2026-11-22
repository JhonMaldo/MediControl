import assert from 'node:assert/strict';
import test from 'node:test';
import { pacientesDemo } from '../src/pacientes-demo.js';
import {
  TODOS, construirPrompt, fragmentar, limpiarCache, pacientesAutorizados,
  preguntarExpediente, recuperar, similitudCoseno,
} from '../src/rag.js';

const andrea = {
  ...pacientesDemo[0],
  data: {
    assessment: { pulse: 80, systolic: 120, diastolic: 80, weight: 62, height: 165, symptoms: 'cefalea' },
    soap: { s: 'Dolor de cabeza', o: 'Sin hallazgos', a: 'Cefalea tensional', p: 'Paracetamol' },
    readings: [{ id: 'a', date: '2026-11-13', pulse: 74, systolic: 118, diastolic: 78 }],
  },
};
const pacientes = [andrea, ...pacientesDemo.slice(1)];
const base = { rol: 'doctor', medicoId: 'rivera', pacientes };

// Ollama falso: el vector marca si el texto habla de penicilina, así se puede comprobar la recuperación.
function ollamaFalso() {
  const llamadas = [];
  const vector = texto => /penicilina/i.test(texto) ? [1, 0] : [0, 1];
  const fetchFn = async (url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    llamadas.push({ url, cuerpo });
    const json = url.endsWith('/api/embed')
      ? { embeddings: cuerpo.input.map(vector) }
      : { message: { content: 'Respuesta de prueba [1].' } };
    return { ok: true, json: async () => json };
  };
  const textosIndexados = () => llamadas
    .filter(l => l.url.endsWith('/api/embed') && l.cuerpo.input[0].startsWith('search_document'))
    .flatMap(l => l.cuerpo.input);
  return { fetchFn, llamadas, textosIndexados };
}

test('hay 10 pacientes asignados a la Dra. Rivera y 2 a otro médico', () => {
  assert.equal(pacientesAutorizados(base).length, 10);
  assert.equal(pacientesDemo.length, 12);
  assert.equal(new Set(pacientesDemo.map(p => p.id)).size, 12);
});

test('solo el médico consulta, y solo a sus pacientes', () => {
  assert.equal(pacientesAutorizados({ ...base, rol: 'nurse' }).length, 0);
  assert.equal(pacientesAutorizados({ ...base, rol: 'patient' }).length, 0);
  const deOrtega = pacientesAutorizados({ ...base, medicoId: 'ortega' }).map(p => p.nombre);
  assert.deepEqual(deOrtega, ['Elena Vargas', 'Tomás Ruiz']);
});

test('cada fragmento dice de qué paciente y sección viene', () => {
  const fragmentos = fragmentar(andrea);
  const alergia = fragmentos.find(f => f.fuente === 'Alergias');
  assert.match(alergia.texto, /^Andrea López\. Alergias registradas/);
  assert.equal(alergia.pacienteId, 'p01');
  assert.ok(fragmentos.some(f => f.fuente === 'Nota SOAP · Plan'));
  assert.ok(fragmentos.some(f => f.fuente.startsWith('Signos')));
});

test('funciona con pacientes sin valoración, nota ni signos', () => {
  const fragmentos = fragmentar(pacientesDemo[1]);
  assert.ok(fragmentos.length > 0);
  assert.ok(!fragmentos.some(f => f.fuente.startsWith('Nota SOAP') || f.fuente.startsWith('Signos')));
});

test('la similitud coseno y la recuperación ordenan por parecido', () => {
  assert.equal(similitudCoseno([1, 0], [2, 0]), 1);
  assert.equal(similitudCoseno([1, 0], [0, 1]), 0);
  assert.equal(similitudCoseno([0, 0], [1, 1]), 0);
  const indice = [{ id: 'x', vector: [0, 1] }, { id: 'y', vector: [1, 0] }, { id: 'z', vector: [0.9, 0.1] }];
  assert.deepEqual(recuperar([1, 0], indice, 2).map(f => f.id), ['y', 'z']);
});

test('con varios pacientes el prompt pide no mezclar información', () => {
  const fuentes = [{ paciente: 'Rosa Martínez', fuente: 'Alergias', texto: 'Penicilina' }];
  assert.match(construirPrompt('¿Alergias?', fuentes, true)[0].content, /no mezcles/);
  assert.doesNotMatch(construirPrompt('¿Alergias?', fuentes, false)[0].content, /no mezcles/);
  assert.match(construirPrompt('¿Alergias?', fuentes, true)[1].content, /\[1\] \(Rosa Martínez · Alergias\)/);
});

test('una pregunta sobre un paciente solo busca en su expediente', async () => {
  limpiarCache();
  const { fetchFn, textosIndexados } = ollamaFalso();
  const { fuentes } = await preguntarExpediente({ ...base, pregunta: '¿Alergias?', pacienteId: 'p07', fetchFn });
  assert.ok(fuentes.every(f => f.pacienteId === 'p07'));
  assert.ok(textosIndexados().every(t => t.includes('Rosa Martínez')));
});

test('con "todos" busca en los 10 pacientes y encuentra a los alérgicos a la penicilina', async () => {
  limpiarCache();
  const { fetchFn, textosIndexados } = ollamaFalso();
  const { fuentes } = await preguntarExpediente({ ...base, pregunta: '¿Quién es alérgico a la penicilina?', pacienteId: TODOS, fetchFn });
  const indexados = new Set(pacientes.filter(p => p.medicoId === 'rivera').map(p => p.nombre)
    .filter(nombre => textosIndexados().some(t => t.includes(nombre))));
  assert.equal(indexados.size, 10);
  const conPenicilina = fuentes.filter(f => /penicilina/i.test(f.texto)).map(f => f.paciente);
  assert.ok(conPenicilina.includes('Andrea López'));
  assert.ok(conPenicilina.includes('Rosa Martínez'));
  // Tomás Ruiz también es alérgico, pero es paciente de otro médico.
  assert.ok(!fuentes.some(f => f.paciente === 'Tomás Ruiz'));
  assert.ok(!fuentes.some(f => 'vector' in f));
});

test('no deja consultar al paciente de otro médico', async () => {
  const { fetchFn, llamadas } = ollamaFalso();
  await assert.rejects(preguntarExpediente({ ...base, pregunta: '¿Alergias?', pacienteId: 'p12', fetchFn }), /permiso/);
  await assert.rejects(preguntarExpediente({ ...base, rol: 'nurse', pregunta: '¿Alergias?', pacienteId: TODOS, fetchFn }), /permiso/);
  assert.equal(llamadas.length, 0);
});

test('solo reindexa al paciente cuyo expediente cambió', async () => {
  limpiarCache();
  const { fetchFn, textosIndexados } = ollamaFalso();
  await preguntarExpediente({ ...base, pregunta: '¿Alergias?', pacienteId: TODOS, fetchFn });
  const primera = textosIndexados().length;
  const editados = pacientes.map(p => p.id === 'p03'
    ? { ...p, historial: { ...p.historial, alergias: [...p.historial.alergias, 'Penicilina: urticaria.'] } }
    : p);
  await preguntarExpediente({ ...base, pacientes: editados, pregunta: '¿Alergias?', pacienteId: TODOS, fetchFn });
  const nuevos = textosIndexados().slice(primera);
  assert.ok(nuevos.length > 0);
  assert.ok(nuevos.every(t => t.includes('María Fernández')));
});

test('"Sin alergias conocidas" no se presenta como una alergia', () => {
  const alergia = fragmentar(pacientesDemo[1]).find(f => f.fuente === 'Alergias');
  assert.match(alergia.texto, /Carlos Hernández NO tiene alergias conocidas/);
  assert.doesNotMatch(alergia.texto, /Sin alergias/);
  assert.match(construirPrompt('¿Alergias?', [alergia], false)[0].content, /eso SÍ es información/);
  const medicamento = fragmentar(pacientesDemo[5]).find(f => f.fuente === 'Medicamentos');
  assert.match(medicamento.texto, /Miguel Sánchez NO toma medicamentos/);
  const conAlergia = fragmentar(pacientesDemo[6]).find(f => f.fuente === 'Alergias');
  assert.match(conAlergia.texto, /Alergias registradas a medicamentos o sustancias: Penicilina/);
});
