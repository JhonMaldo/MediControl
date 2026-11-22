// Resumen inteligente del expediente clínico con un modelo local de Ollama.
// Reutiliza la fragmentación y los permisos de la búsqueda inteligente (rag.js).
// A diferencia de la búsqueda, no usa embeddings: el resumen necesita todo el expediente.

import { MODELO_LENGUAJE, fragmentar, pacientesAutorizados } from './rag.js';

export { MODELO_LENGUAJE };
const OLLAMA = '/ollama';

// Secciones que pide la tarea: antecedentes, alergias, medicamentos y consultas previas.
// Las notas SOAP y la valoración también son consultas; los signos sueltos se dejan fuera.
export const SECCIONES = [
  { titulo: 'Antecedentes', incluye: fuente => fuente === 'Antecedentes' },
  { titulo: 'Alergias', incluye: fuente => fuente === 'Alergias' },
  { titulo: 'Medicamentos', incluye: fuente => fuente === 'Medicamentos' },
  { titulo: 'Consultas previas', incluye: fuente => /^(Consulta|Nota SOAP|Valoración|Laboratorio)/.test(fuente) },
];

export function registrosParaResumen(paciente) {
  return fragmentar(paciente).filter(f => SECCIONES.some(s => s.incluye(f.fuente)));
}

export function construirPromptResumen(paciente, registros) {
  const contexto = registros.map((r, i) => `[${i + 1}] (${r.fuente}) ${r.texto}`).join('\n');
  return [
    {
      role: 'system',
      content: 'Eres un asistente para médicos. Escribe en español un resumen clínico breve usando ÚNICAMENTE los registros que se te dan. '
        + 'Usa exactamente estos cuatro apartados, cada uno en su propia línea seguido de dos puntos: Antecedentes, Alergias, Medicamentos, Consultas previas. '
        + 'Debajo de cada apartado escribe frases cortas, cada una en una línea que empiece con "- ", y termina cada frase con el número del registro entre corchetes, por ejemplo [2]. '
        + 'Menciona TODAS las alergias registradas. Si un registro dice que el paciente NO tiene algo, escríbelo así. '
        + 'Si un apartado no tiene registros, escribe "- Sin registros". No inventes datos, no des diagnósticos nuevos ni recomendaciones.',
    },
    { role: 'user', content: `Paciente: ${paciente.nombre}\n\nRegistros del expediente:\n${contexto}\n\nEscribe el resumen.` },
  ];
}

// Comprueba de forma automática que el resumen refleje lo registrado.
// Devuelve advertencias para que el médico revise antes de confiar en el resumen.
export function verificarResumen(resumen, registros) {
  const advertencias = [];
  const texto = resumen.toLowerCase();

  for (const seccion of SECCIONES) {
    if (!texto.includes(seccion.titulo.toLowerCase())) advertencias.push(`Falta el apartado "${seccion.titulo}".`);
  }

  const citas = [...resumen.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
  const invalidas = [...new Set(citas.filter(n => n < 1 || n > registros.length))];
  if (invalidas.length) advertencias.push(`Cita registros que no existen: ${invalidas.map(n => `[${n}]`).join(', ')}.`);
  if (!citas.length && registros.length) advertencias.push('El resumen no cita ningún registro.');

  // Una alergia omitida es el error más peligroso, así que se revisa una por una.
  for (const registro of registros.filter(r => r.fuente === 'Alergias' && !/NO tiene alergias/.test(r.texto))) {
    const detalle = registro.texto.split(': ').at(1) ?? '';
    const sustancia = detalle.split(/[:(]/)[0].replace(/\.$/, '').trim();
    // Basta con que aparezca la primera palabra o un sinónimo entre paréntesis: "Sulfonamidas (sulfas)".
    const claves = [sustancia.split(' ')[0], ...[...detalle.matchAll(/\(([^)]+)\)/g)].map(m => m[1])]
      .map(c => c.toLowerCase()).filter(Boolean);
    if (sustancia && !claves.some(c => texto.includes(c))) {
      advertencias.push(`El resumen no menciona la alergia registrada a "${sustancia}".`);
    }
  }
  return advertencias;
}

// Convierte el texto del modelo en títulos y viñetas. Los modelos pequeños a veces escriben
// "Antecedentes: - dato [1]" en una sola línea, así que primero se separan esos casos.
export function formatearResumen(texto) {
  const normalizado = texto
    .replace(/\*\*/g, '')
    .replace(/:\s+[-*•]\s+/g, ':\n- ')
    .replace(/(\])\.?\s+[-*•]\s+/g, '$1.\n- ');
  return normalizado.split('\n').map(l => l.trim()).filter(Boolean).map(linea => /^[-*•]/.test(linea)
    ? { tipo: 'item', texto: linea.replace(/^[-*•]\s*/, '') }
    : { tipo: 'titulo', texto: linea });
}

const cache = new Map();

export function limpiarCacheResumen() {
  cache.clear();
}

export async function resumirExpediente({ rol, medicoId, pacienteId, pacientes, fetchFn = fetch, modelo = MODELO_LENGUAJE }) {
  const paciente = pacientesAutorizados({ rol, medicoId, pacientes }).find(p => p.id === pacienteId);
  if (!paciente) throw new Error('No tienes permiso para consultar este expediente');

  const registros = registrosParaResumen(paciente);
  // Si el expediente no cambió, se reutiliza el resumen anterior.
  const clave = modelo + '\n' + registros.map(r => r.texto).join('\n');
  if (cache.get(paciente.id)?.clave === clave) return cache.get(paciente.id).resultado;

  const inicio = Date.now();
  const respuesta = await fetchFn(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, messages: construirPromptResumen(paciente, registros), stream: false, options: { temperature: 0 } }),
  });
  if (!respuesta.ok) throw new Error('Ollama no está disponible');
  const { message } = await respuesta.json();
  const resumen = message.content.trim();

  const resultado = {
    paciente: paciente.nombre,
    resumen,
    registros,
    advertencias: verificarResumen(resumen, registros),
    modelo,
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
  };
  cache.set(paciente.id, { clave, resultado });
  return resultado;
}
