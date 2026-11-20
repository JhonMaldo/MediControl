import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePulse } from '../src/vitalwatch.js';

const workflow = JSON.parse(readFileSync(new URL('../n8n/vitalwatch-anomalias.json', import.meta.url), 'utf8'));
function evaluateWorkflow(body) {
  let node = workflow.nodes.find(item => item.type === 'n8n-nodes-base.webhook');
  let json = { body };
  const visited = new Set();
  while (workflow.connections[node.name]) {
    assert.ok(!visited.has(node.name), 'El flujo no debe tener ciclos');
    visited.add(node.name);
    const [next] = workflow.connections[node.name].main[0];
    node = workflow.nodes.find(item => item.name === next.node);
    const runCodeNode = new Function('$input', node.parameters.jsCode);
    [{ json }] = runCodeNode({ first: () => ({ json }) });
  }
  assert.equal(visited.size, workflow.nodes.length - 1);
  return json;
}

const evaluate = body => evaluateWorkflow(body).status;

test('el modelo aprende el patrón y detecta desviaciones en ambos sentidos', () => {
  const history = [74, 79, 72, 76];
  assert.equal(evaluate({ pulse: 78, history }), 'typical');
  assert.equal(evaluate({ pulse: 105, history }), 'atypical');
  assert.equal(evaluate({ pulse: 50, history }), 'atypical');
  assert.equal(evaluate({ pulse: 105, history: [99, 102, 105, 107] }), 'typical');
});

test('la explicación expone ambos criterios sin devolver el historial', () => {
  const result = evaluateWorkflow({ pulse: 105, history: [74, 79, 72, 76] });
  assert.equal(result.direction, 'above');
  assert.equal(result.sampleCount, 4);
  assert.equal(result.evidence.center, 75);
  assert.equal(result.evidence.neighborSignal, true);
  assert.equal(result.evidence.centerSignal, true);
  assert.match(result.explanation, /por encima/);
  assert.equal(Object.hasOwn(result, 'history'), false);
});

test('el webhook distingue historial insuficiente de entradas inválidas', () => {
  assert.equal(evaluate({ pulse: 105, history: [76] }), 'insufficient_history');
  assert.equal(evaluate({ pulse: '105', history: [74, 79, 72, 76] }), 'invalid_input');
});

test('React envía solo las 30 frecuencias anteriores y recibe la clasificación del flujo', async context => {
  const rows = Array.from({ length: 40 }, (_, id) => ({ id, pulse: id + 60, systolic: 120 }));
  const reading = rows[35];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/vitalwatch/analyze');
    assert.equal(options.method, 'POST');
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload, { pulse: reading.pulse, history: rows.slice(5, 35).map(row => row.pulse) });
    return Response.json(evaluateWorkflow(payload));
  });
  assert.equal(await analyzePulse(reading, rows), 'typical');
});

test('una respuesta fallida se puede mostrar como análisis no disponible', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 502 }));
  await assert.rejects(analyzePulse({ id: 'new', pulse: 105 }, [{ id: 'new', pulse: 105 }]));
});
