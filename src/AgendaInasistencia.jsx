import React, { useEffect, useState } from 'react';

export default function AgendaInasistencia() {
  const [fecha, setFecha] = useState('2026-11-20');
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (!fecha) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
    fetch('/api/inasistencia?' + new URLSearchParams({ fecha }), { signal })
      .then(response => {
        if (!response.ok) throw new Error('Agenda no disponible');
        return response.json();
      })
      .then(data => setResultado({ fecha, intento, citas: data.citas }))
      .catch(() => {
        if (!controller.signal.aborted) setResultado({ fecha, intento, error: true });
      });
    return () => controller.abort();
  }, [fecha, intento]);

  const actual = resultado?.fecha === fecha && resultado?.intento === intento ? resultado : null;

  return <section className="panel">
    <header className="panel-header">
      <div><h2>Prioridad de confirmación</h2><p>Citas programadas ordenadas por riesgo estimado de inasistencia.</p></div>
      <label>Fecha de la agenda<input type="date" value={fecha} onChange={event => setFecha(event.target.value)}/></label>
    </header>
    {!fecha && <p>Selecciona una fecha.</p>}
    {fecha && !actual && <p role="status">Consultando la agenda…</p>}
    {actual?.error && <>
      <p role="status">El servicio de predicción no está disponible.</p>
      <button className="secondary" onClick={() => setIntento(value => value + 1)}>Reintentar</button>
    </>}
    {actual?.citas?.length === 0 && <p>No hay citas programadas para esa fecha.</p>}
    {actual?.citas?.length > 0 && <div className="table-wrap">
      <table>
        <thead><tr><th scope="col">Paciente</th><th scope="col">Hora</th><th scope="col">Probabilidad de inasistencia</th></tr></thead>
        <tbody>{actual.citas.map(cita => <tr key={cita.id}>
          <td>{cita.paciente}</td><td>{cita.hora}</td>
          <td>{new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 }).format(cita.probabilidad)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
