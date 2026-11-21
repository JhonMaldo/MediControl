import React, { useEffect, useState } from 'react';
import { HORIZONTES, LIENZO, SIGNOS, calcularGrafica, formatear, obtenerPacientes, obtenerPronostico } from './pronostico.js';
import './tendencia.css';

// Panel "Tendencia de signos vitales".
// Este panel usa el historial de MariaDB (datos de demostración del servicio de
// pronóstico) y NO las mediciones del recorrido guardadas en el navegador.
// perfil="paciente": fijo en Andrea López (id 1), sin selector, porque cada paciente
// solo ve lo suyo. perfil="medico": selector con la lista de pacientes de la API.
const PACIENTE_DEMO = 1;

function GraficaTendencia({ datos }) {
  const g = calcularGrafica(datos);
  if (!g) return null;
  const { unidad } = datos;
  const decimales = g.escala.decimales || (datos.signo === 'temperatura' ? 1 : 0);
  const valor = v => formatear(v, unidad, Math.max(1, decimales));
  const nivel = Math.round(datos.nivel_confianza * 100);
  const final = g.proyectados.at(-1);
  const descripcion = `${datos.nombre} de ${datos.paciente}: últimos ${g.puntos.length} días registrados, `
    + (final ? `proyección a ${g.proyectados.length} días que termina en ${valor(final.valor)} (margen ${nivel} %: ${valor(final.inferior)} a ${valor(final.superior)})` : 'sin proyección')
    + `. Rango de referencia ${datos.rango_referencia[0]} a ${datos.rango_referencia[1]} ${unidad}.`;

  return <svg className="chart tendencia-grafica" viewBox={`0 0 ${LIENZO.ancho} ${LIENZO.alto}`} role="img" aria-label={descripcion}>
    {g.referencia.alto > 0 && <rect x={LIENZO.izquierda} width={LIENZO.derecha - LIENZO.izquierda} y={g.referencia.y} height={g.referencia.alto} fill="#e3f4e6" opacity="0.7"/>}
    {g.marcas.map(marca => <g key={marca.y}>
      <text x="12" y={marca.y + 4}>{marca.valor}</text>
      <line x1={LIENZO.izquierda} x2={LIENZO.derecha} y1={marca.y} y2={marca.y} stroke="#dcebf4" strokeDasharray="4 5"/>
    </g>)}
    {g.separador !== null && <line x1={g.separador} x2={g.separador} y1={LIENZO.arriba - 10} y2={LIENZO.abajo} stroke="#9fb7c9" strokeDasharray="2 4"/>}
    {g.banda && <polygon points={g.banda} fill="#f08a24" fillOpacity="0.2"/>}
    <polyline points={g.lineaRegistrada} fill="none" stroke="#287ebc" strokeWidth="3" strokeLinejoin="round"/>
    {g.lineaProyeccion && <polyline points={g.lineaProyeccion} fill="none" stroke="#d9720f" strokeWidth="3" strokeDasharray="7 5" strokeLinejoin="round"/>}
    {g.puntos.map(p => <circle key={p.fecha} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="#287ebc" strokeWidth="2">
      <title>{`${p.fecha}: ${valor(p.valor)}`}</title>
    </circle>)}
    {g.proyectados.map(p => <circle key={p.fecha} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="#d9720f" strokeWidth="2">
      <title>{`${p.fecha} (proyección): ${valor(p.valor)} · margen ${nivel} %: ${valor(p.inferior)} a ${valor(p.superior)}`}</title>
    </circle>)}
    {g.fechas.map(f => <text key={f.fecha} x={f.x} y="176" textAnchor="middle">{f.texto}</text>)}
  </svg>;
}

function usePeticion(pedir, dependencias) {
  const [intento, setIntento] = useState(0);
  const [estado, setEstado] = useState(null);
  const clave = JSON.stringify([...dependencias, intento]);
  useEffect(() => {
    const controller = new AbortController();
    pedir(controller.signal)
      .then(datos => setEstado({ clave, datos }))
      .catch(() => { if (!controller.signal.aborted) setEstado({ clave, error: true }); });
    return () => controller.abort();
  }, [clave]);
  return [estado?.clave === clave ? estado : null, () => setIntento(valor => valor + 1)];
}

export default function TendenciaSignos({ perfil = 'paciente' }) {
  const esMedico = perfil === 'medico';
  const [signo, setSigno] = useState('frecuencia_cardiaca');
  const [horizonte, setHorizonte] = useState(7);
  const [pacienteId, setPacienteId] = useState(PACIENTE_DEMO);
  const [pacientes] = usePeticion(signal => esMedico ? obtenerPacientes(signal) : Promise.resolve([]), [esMedico]);
  const [actual, reintentar] = usePeticion(
    signal => obtenerPronostico({ pacienteId, signo, horizonte, signal }), [pacienteId, signo, horizonte]);
  const datos = actual?.datos;
  const sinProyeccion = datos && datos.pronostico.length === 0;

  return <section className="panel tendencia">
    <header className="panel-header">
      <div><h2>Tendencia de signos vitales</h2>
        <p>Lecturas registradas y proyección de las próximas mediciones con su margen de incertidumbre.</p></div>
      <div className="tendencia-filtros">
        {esMedico && <label>Paciente<select value={pacienteId} onChange={event => setPacienteId(Number(event.target.value))}>
          {(pacientes?.datos ?? [{ id: PACIENTE_DEMO, nombre: 'Andrea López' }]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select></label>}
        <label>Signo<select value={signo} onChange={event => setSigno(event.target.value)}>
          {SIGNOS.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select></label>
        <label>Horizonte<select value={horizonte} onChange={event => setHorizonte(Number(event.target.value))}>
          {HORIZONTES.map(dias => <option key={dias} value={dias}>{dias} días</option>)}
        </select></label>
      </div>
    </header>

    {!actual && <p role="status">Calculando tendencia…</p>}
    {actual?.error && <div className="tendencia-estado">
      <p role="status">El servicio de pronóstico no está disponible.</p>
      <button className="secondary" onClick={reintentar}>Reintentar</button>
    </div>}
    {datos && <>
      <p className="tendencia-modelo">
        {datos.paciente} · {datos.nombre} ({datos.unidad})
        {datos.modelo_usado && <> · Modelo: {datos.descripcion_modelo} · banda {Math.round(datos.nivel_confianza * 100)} %</>}
      </p>
      <GraficaTendencia datos={datos}/>
      <ul className="tendencia-leyenda" aria-label="Leyenda">
        <li><span className="muestra registrado" aria-hidden="true"/>Registrado</li>
        {!sinProyeccion && <li><span className="muestra proyeccion" aria-hidden="true"/>Proyección</li>}
        {!sinProyeccion && <li><span className="muestra margen" aria-hidden="true"/>Margen {Math.round(datos.nivel_confianza * 100)} %</li>}
        <li><span className="muestra referencia" aria-hidden="true"/>Rango de referencia ({datos.rango_referencia[0]}–{datos.rango_referencia[1]} {datos.unidad})</li>
      </ul>
      {sinProyeccion && <p className="notice tendencia-sin"><strong>Sin proyección para este signo.</strong> {datos.advertencias[0]?.mensaje}</p>}
      {datos.advertencias.length > 0 && !sinProyeccion && <ul className="tendencia-advertencias">
        {datos.advertencias.map((a, i) => <li key={a.regla + i} className={'tendencia-' + a.tipo}>{a.mensaje}</li>)}
      </ul>}
      <p className="tendencia-nota">{datos.nota} El panel usa el historial de demostración del servicio de pronóstico, no las mediciones guardadas en este navegador.</p>
    </>}
  </section>;
}
