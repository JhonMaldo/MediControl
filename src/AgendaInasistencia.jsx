import React, { useEffect, useState } from 'react';

export default function AgendaInasistencia() {
  const [fecha, setFecha] = useState('2026-11-20');
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState(null);

  const [guardando, setGuardando] = useState(null);
  const [mensaje, setMensaje] = useState('');

  async function guardar(cita, confirmacion) {
    setGuardando(cita.id);
    setMensaje('');
    try {
      const respuesta = await fetch(`/api/inasistencia/${cita.id}/confirmacion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anterior: cita.confirmacion, confirmacion }),
        signal: AbortSignal.timeout(12000),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        setMensaje(datos.error || 'No se pudo guardar el cambio.');
        setIntento(valor => valor + 1);
        return;
      }
      setResultado(previo => ({
        ...previo,
        citas: previo.citas.map(fila => fila.id === cita.id ? { ...fila, confirmacion: datos.confirmacion } : fila),
      }));
      setMensaje(`Estado guardado para ${cita.paciente}: ${datos.confirmacion}.`);
    } catch {
      setMensaje('No se pudo confirmar el guardado. Revisa la agenda.');
      setIntento(valor => valor + 1);
    } finally {
      setGuardando(null);
    }
  }

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
      <label>Fecha de la agenda<input type="date" value={fecha} disabled={guardando !== null} onChange={event => { setMensaje(''); setFecha(event.target.value); }}/></label>
    </header>
    {mensaje && <p role="status">{mensaje}</p>}
    {!fecha && <p>Selecciona una fecha.</p>}
    {fecha && !actual && <p role="status">Consultando la agenda…</p>}
    {actual?.error && <>
      <p role="status">El servicio de predicción no está disponible.</p>
      <button className="secondary" onClick={() => setIntento(value => value + 1)}>Reintentar</button>
    </>}
    {actual?.citas?.length === 0 && <p>No hay citas programadas para esa fecha.</p>}
    {actual?.citas?.length > 0 && <div className="table-wrap">
      <table>
        <thead><tr><th scope="col">Paciente</th><th scope="col">Hora</th><th scope="col">Probabilidad de inasistencia</th><th scope="col">Estado de confirmación</th></tr></thead>
        <tbody>{actual.citas.map(cita => <tr key={cita.id}>
          <td>{cita.paciente}</td><td>{cita.hora}</td>
          <td>{new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 }).format(cita.probabilidad)}</td>
          <td>
            <select aria-label={`Estado de confirmación de ${cita.paciente} a las ${cita.hora}`}
              value={cita.confirmacion} disabled={guardando !== null}
              onChange={evento => guardar(cita, evento.target.value)}>
              {['Pendiente', 'Confirmada', 'Sin respuesta'].map(estado => <option key={estado}>{estado}</option>)}
            </select>
            {guardando === cita.id && <span role="status"> Guardando…</span>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
