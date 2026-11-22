// Búsqueda inteligente en expedientes clínicos (RAG) con Ollama local.
// 1. fragmentar(): convierte el expediente de un paciente en fragmentos con su fuente.
// 2. indexar(): obtiene los embeddings, con un índice guardado por paciente.
// 3. recuperar(): elige los fragmentos más parecidos a la pregunta.
// 4. preguntarExpediente(): redacta la respuesta solo con esos fragmentos.
// Se puede preguntar sobre un paciente o sobre todos los pacientes autorizados del médico.

export const MODELO_EMBEDDINGS = 'nomic-embed-text';
export const MODELO_LENGUAJE = 'llama3.2';
export const TODOS = 'todos';
const OLLAMA = '/ollama';
const SIN_RESPUESTA = 'No encontré esa información en el expediente.';

// ---------- Permisos ----------

// Un médico solo puede consultar los pacientes que tiene asignados.
export function pacientesAutorizados({ rol, medicoId, pacientes }) {
  if (rol !== 'doctor' || !medicoId) return [];
  return pacientes.filter(p => p.medicoId === medicoId);
}

// ---------- Fragmentación ----------

const esNegativo = texto => /^(sin|no|ninguna|ninguno)\b/i.test(texto.trim());

export function fragmentar(paciente) {
  const { id, nombre, historial, data = {} } = paciente;
  const fragmentos = [];
  // Cada texto dice de quién es y de qué sección viene. Así un fragmento como
  // "Penicilina: urticaria" se recupera con "¿tiene alergias?" y no se confunde entre pacientes.
  const agregar = (seccion, texto) => fragmentos.push({
    id: `${id}-${fragmentos.length}`,
    pacienteId: id,
    paciente: nombre,
    fuente: seccion,
    texto: `${nombre}. ${texto}`,
  });

  // Las etiquetas son neutras ("registradas") para que "Sin alergias conocidas" no se lea como
  // si el paciente tuviera una alergia.
  historial.antecedentes.forEach(t => agregar('Antecedentes', 'Antecedentes médicos registrados: ' + t));
  // Los registros negativos ("Sin alergias conocidas") se escriben como una afirmación completa.
  // Si no, el modelo confunde "no tiene alergias" con "no hay información".
  historial.alergias.forEach(t => agregar('Alergias', esNegativo(t)
    ? `Alergias registradas: ninguna. ${nombre} NO tiene alergias conocidas a medicamentos ni a sustancias.`
    : 'Alergias registradas a medicamentos o sustancias: ' + t));
  historial.medicamentos.forEach(t => agregar('Medicamentos', esNegativo(t)
    ? `Medicamentos registrados: ninguno. ${nombre} NO toma medicamentos de forma habitual.`
    : 'Medicamentos registrados que toma actualmente: ' + t));
  historial.laboratorios.forEach(lab =>
    agregar(`Laboratorio · ${lab.estudio} · ${lab.fecha}`, `Resultado de laboratorio, ${lab.estudio} (${lab.fecha}): ${lab.resultado}`));
  historial.consultasPrevias.forEach(c =>
    agregar(`Consulta · ${c.fecha}`, `Consulta del ${c.fecha} por ${c.motivo}: ${c.resumen}`));

  if (data.assessment) {
    const a = data.assessment;
    agregar('Valoración inicial', `Valoración de enfermería: frecuencia cardíaca ${a.pulse} lpm, presión ${a.systolic}/${a.diastolic} mmHg, peso ${a.weight} kg, estatura ${a.height} cm. Síntomas: ${a.symptoms}.`);
  }
  if (data.soap) {
    agregar('Nota SOAP · Subjetivo', 'Nota de consulta, subjetivo: ' + data.soap.s);
    agregar('Nota SOAP · Objetivo', 'Nota de consulta, objetivo: ' + data.soap.o);
    agregar('Nota SOAP · Análisis', 'Nota de consulta, análisis: ' + data.soap.a);
    agregar('Nota SOAP · Plan', 'Nota de consulta, plan: ' + data.soap.p);
  }
  (data.readings ?? []).forEach(r =>
    agregar(`Signos · ${r.date}`, `Signos vitales del ${r.date}: frecuencia cardíaca ${r.pulse} lpm, presión ${r.systolic}/${r.diastolic} mmHg.`));

  return fragmentos;
}

// ---------- Recuperación ----------

export function similitudCoseno(a, b) {
  let punto = 0, normaA = 0, normaB = 0;
  for (let i = 0; i < a.length; i++) {
    punto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  return normaA && normaB ? punto / Math.sqrt(normaA * normaB) : 0;
}

export function recuperar(vectorPregunta, indice, k = 5) {
  return indice
    .map(item => ({ ...item, puntaje: similitudCoseno(vectorPregunta, item.vector) }))
    .sort((x, y) => y.puntaje - x.puntaje)
    .slice(0, k);
}

// ---------- Ollama ----------

async function pedir(fetchFn, ruta, cuerpo) {
  const respuesta = await fetchFn(OLLAMA + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) throw new Error('Ollama no está disponible');
  return respuesta.json();
}

// nomic-embed-text distingue documentos y preguntas con estos prefijos.
export async function embeddings(textos, tipo, fetchFn = fetch) {
  if (!textos.length) return [];
  const prefijo = tipo === 'pregunta' ? 'search_query: ' : 'search_document: ';
  const { embeddings: vectores } = await pedir(fetchFn, '/api/embed', {
    model: MODELO_EMBEDDINGS,
    input: textos.map(texto => prefijo + texto),
  });
  return vectores;
}

// ---------- Índice por paciente ----------

// Un índice por paciente. Solo se recalcula el de un paciente si su expediente cambió,
// así agregar o editar un paciente no obliga a reindexar a los demás.
const indices = new Map();

export async function indexar(pacientes, fetchFn = fetch) {
  const pendientes = [];
  for (const paciente of pacientes) {
    const fragmentos = fragmentar(paciente);
    const clave = fragmentos.map(f => f.texto).join('\n');
    if (indices.get(paciente.id)?.clave !== clave) pendientes.push({ paciente, fragmentos, clave });
  }
  // Todos los fragmentos nuevos se envían en una sola llamada a Ollama.
  const todos = pendientes.flatMap(p => p.fragmentos);
  const vectores = await embeddings(todos.map(f => f.texto), 'documento', fetchFn);
  let i = 0;
  for (const { paciente, fragmentos, clave } of pendientes) {
    indices.set(paciente.id, { clave, items: fragmentos.map(f => ({ ...f, vector: vectores[i++] })) });
  }
  return pacientes.flatMap(p => indices.get(p.id).items);
}

export function limpiarCache() {
  indices.clear();
}

// ---------- Generación ----------

export function construirPrompt(pregunta, fuentes, varios) {
  const contexto = fuentes.map((f, i) => `[${i + 1}] (${f.paciente} · ${f.fuente}) ${f.texto}`).join('\n');
  const alcance = varios
    ? 'Los registros pueden ser de varios pacientes: indica siempre a qué paciente corresponde cada dato y no mezcles información entre pacientes. '
    : '';
  return [
    {
      role: 'system',
      content: 'Eres un asistente para médicos. Responde en español, de forma breve, usando ÚNICAMENTE los registros que se te dan. '
        + alcance
        + 'Si un registro dice que el paciente NO tiene algo (por ejemplo, que no tiene alergias o no toma medicamentos), eso SÍ es información: '
        + 'responde que no lo tiene y cita el registro. '
        + 'Cita los registros que uses con su número entre corchetes, por ejemplo [1]. '
        + `Solo si ningún registro trata el tema de la pregunta, responde exactamente: "${SIN_RESPUESTA}" No inventes datos ni des diagnósticos nuevos.`,
    },
    { role: 'user', content: `Registros del expediente:\n${contexto}\n\nPregunta del médico: ${pregunta}` },
  ];
}

export async function preguntarExpediente({ pregunta, rol, medicoId, pacienteId, pacientes, fetchFn = fetch }) {
  const autorizados = pacientesAutorizados({ rol, medicoId, pacientes });
  if (!autorizados.length) throw new Error('No tienes permiso para consultar expedientes');

  const varios = pacienteId === TODOS;
  const alcance = varios ? autorizados : autorizados.filter(p => p.id === pacienteId);
  if (!alcance.length) throw new Error('No tienes permiso para consultar este expediente');

  const texto = pregunta.trim();
  if (!texto) throw new Error('Escribe una pregunta');

  const indice = await indexar(alcance, fetchFn);
  const [vectorPregunta] = await embeddings([texto], 'pregunta', fetchFn);
  // Con varios pacientes se recuperan más registros para cubrir a más de uno.
  const k = varios ? Math.min(12, 4 + alcance.length) : 5;
  const fuentes = recuperar(vectorPregunta, indice, k).map(({ vector, ...resto }) => resto);

  const { message } = await pedir(fetchFn, '/api/chat', {
    model: MODELO_LENGUAJE,
    messages: construirPrompt(texto, fuentes, varios),
    stream: false,
    options: { temperature: 0 },
  });
  return { respuesta: message.content.trim(), fuentes };
}
