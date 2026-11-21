// Funciones del cliente para el pronóstico de signos vitales.
// Todo lo que no es visual vive aquí para poder probarlo con node:test:
// armar la URL, pedir y validar la respuesta, y calcular la escala y las coordenadas.

export const SIGNOS = [
  ['frecuencia_cardiaca', 'Frecuencia cardíaca'],
  ['presion_sistolica', 'Presión sistólica'],
  ['presion_diastolica', 'Presión diastólica'],
  ['temperatura', 'Temperatura'],
  ['saturacion_oxigeno', 'Saturación de oxígeno'],
];
export const HORIZONTES = [3, 7, 14];
export const TIEMPO_MAXIMO_MS = 15000;
export const DIAS_REGISTRADOS = 30;

// Mismas proporciones que VitalChart en main.jsx
export const LIENZO = { ancho: 610, alto: 190, izquierda: 55, derecha: 565, arriba: 25, abajo: 145 };

export function urlPronostico(pacienteId, signo, horizonte, modelo) {
  if (!Number.isInteger(Number(pacienteId))) throw new Error('Paciente no válido');
  if (!SIGNOS.some(([id]) => id === signo)) throw new Error('Signo no válido');
  const parametros = new URLSearchParams({ horizonte: String(horizonte) });
  if (modelo) parametros.set('modelo', modelo);
  return `/api/pronostico/pacientes/${encodeURIComponent(pacienteId)}/signos/${signo}?${parametros}`;
}

const esNumero = valor => typeof valor === 'number' && Number.isFinite(valor);
const esFecha = valor => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);

// Revisa que la respuesta tenga lo que la gráfica necesita. Lanza un error si no.
export function validarRespuesta(datos) {
  const falla = motivo => { throw new Error('Respuesta de pronóstico no válida: ' + motivo); };
  if (!datos || typeof datos !== 'object') falla('no es un objeto');
  if (!SIGNOS.some(([id]) => id === datos.signo)) falla('signo');
  if (typeof datos.unidad !== 'string' || typeof datos.nombre !== 'string') falla('nombre o unidad');
  if (!Array.isArray(datos.rango_referencia) || datos.rango_referencia.length !== 2 || !datos.rango_referencia.every(esNumero)) falla('rango de referencia');
  if (!esNumero(datos.nivel_confianza)) falla('nivel de confianza');
  if (!Array.isArray(datos.historial) || datos.historial.some(p => !esFecha(p?.fecha) || !(p.valor === null || esNumero(p.valor)))) falla('historial');
  if (!Array.isArray(datos.pronostico) || datos.pronostico.some(p => !esFecha(p?.fecha) || ![p.valor, p.inferior, p.superior].every(esNumero) || p.inferior > p.valor || p.valor > p.superior)) falla('pronóstico');
  if (!Array.isArray(datos.advertencias) || datos.advertencias.some(a => typeof a?.mensaje !== 'string' || typeof a?.tipo !== 'string')) falla('advertencias');
  return datos;
}

function senal(signal) {
  const limite = AbortSignal.timeout(TIEMPO_MAXIMO_MS);
  return signal ? AbortSignal.any([signal, limite]) : limite;
}

async function pedir(url, signal, transformar) {
  const respuesta = await fetch(url, { signal: senal(signal), headers: { Accept: 'application/json' } });
  if (!respuesta.ok) throw new Error('Servicio de pronóstico no disponible (' + respuesta.status + ')');
  return transformar(await respuesta.json());
}

export function obtenerPronostico({ pacienteId, signo, horizonte, modelo, signal }) {
  return pedir(urlPronostico(pacienteId, signo, horizonte, modelo), signal, validarRespuesta);
}

export function obtenerPacientes(signal) {
  return pedir('/api/pronostico/pacientes', signal, lista => {
    if (!Array.isArray(lista) || lista.some(p => !Number.isInteger(p?.id) || typeof p?.nombre !== 'string')) {
      throw new Error('Lista de pacientes no válida');
    }
    return lista;
  });
}

const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// Escala vertical "redonda" que incluye todos los valores
export function escala(valores) {
  const finitos = valores.filter(esNumero);
  let bajo = Math.min(...finitos);
  let alto = Math.max(...finitos);
  if (alto - bajo < 1e-9) { bajo -= 1; alto += 1; }
  const paso = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find(p => (alto - bajo) / p <= 6) ?? 100;
  bajo = Math.floor(bajo / paso - 1e-9) * paso;
  alto = Math.ceil(alto / paso + 1e-9) * paso;
  const decimales = paso < 1 ? 1 : 0;
  const marcas = [0, 1, 2, 3].map(i => Number((alto - i * (alto - bajo) / 3).toFixed(decimales)));
  return { bajo, alto, marcas, decimales };
}

// Calcula todo lo que dibuja la gráfica. Regresa null si no hay registros.
export function calcularGrafica(datos, lienzo = LIENZO) {
  const registrados = datos.historial.slice(-DIAS_REGISTRADOS);
  const conValor = registrados.filter(p => p.valor !== null);
  if (!conValor.length) return null;
  const inicio = registrados[0].fecha;
  const pronostico = datos.pronostico;
  const totalDias = Math.max(1, diasEntre(inicio, (pronostico.at(-1) ?? registrados.at(-1)).fecha));
  const [refBajo, refAlto] = datos.rango_referencia;
  const e = escala([
    ...conValor.map(p => p.valor),
    ...pronostico.flatMap(p => [p.inferior, p.superior]),
    refBajo, refAlto,
  ]);
  const x = fecha => lienzo.izquierda + diasEntre(inicio, fecha) * (lienzo.derecha - lienzo.izquierda) / totalDias;
  const y = valor => lienzo.abajo - (valor - e.bajo) * (lienzo.abajo - lienzo.arriba) / (e.alto - e.bajo);
  const punto = p => ({ fecha: p.fecha, valor: p.valor, x: x(p.fecha), y: y(p.valor) });

  const puntos = conValor.map(punto);
  const ultimo = puntos.at(-1);
  const proyectados = pronostico.map(p => ({ ...punto(p), inferior: p.inferior, superior: p.superior, yInferior: y(p.inferior), ySuperior: y(p.superior) }));
  const linea = lista => lista.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const banda = proyectados.length ? [
    `${ultimo.x.toFixed(1)},${ultimo.y.toFixed(1)}`,
    ...proyectados.map(p => `${p.x.toFixed(1)},${p.ySuperior.toFixed(1)}`),
    ...[...proyectados].reverse().map(p => `${p.x.toFixed(1)},${p.yInferior.toFixed(1)}`),
  ].join(' ') : '';
  const yRefArriba = Math.max(lienzo.arriba, y(refAlto));
  const yRefAbajo = Math.min(lienzo.abajo, y(refBajo));
  const todas = [...registrados.map(p => p.fecha), ...pronostico.map(p => p.fecha)];
  const cada = Math.max(1, Math.ceil(todas.length / 7));
  const fechas = todas.filter((_, i) => i % cada === 0 || i === todas.length - 1)
    .map(fecha => ({ fecha, x: x(fecha), texto: fecha.slice(8) + '/' + fecha.slice(5, 7) }));

  return {
    escala: e,
    marcas: e.marcas.map((valor, i) => ({ valor, y: lienzo.arriba + i * (lienzo.abajo - lienzo.arriba) / 3 })),
    puntos,
    lineaRegistrada: linea(puntos),
    proyectados,
    lineaProyeccion: proyectados.length ? linea([ultimo, ...proyectados]) : '',
    banda,
    referencia: { y: yRefArriba, alto: Math.max(0, yRefAbajo - yRefArriba) },
    separador: proyectados.length ? ultimo.x : null,
    fechas,
  };
}

export function formatear(valor, unidad, decimales = 1) {
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: decimales }).format(valor) + ' ' + unidad;
}
