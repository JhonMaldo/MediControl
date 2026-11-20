import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Bell, CalendarDays, ClipboardList, FileText, FlaskConical, FolderOpen, HeartPulse, LayoutDashboard, LockKeyhole, Search, Stethoscope, UserRound } from 'lucide-react';
import { analyzePulse } from './vitalwatch.js';
import AgendaInasistencia from './AgendaInasistencia.jsx';
import './style.css';

const storageKey = 'medicontrol-demo-v1';
const demo = {
  status: 'scheduled',
  assessment: null,
  soap: null,
  notes: [],
  readings: [
    { id: 'a', date: '2026-11-13', pulse: 74, systolic: 118, diastolic: 78 },
    { id: 'b', date: '2026-11-15', pulse: 79, systolic: 121, diastolic: 80 },
    { id: 'c', date: '2026-11-17', pulse: 72, systolic: 116, diastolic: 76 },
    { id: 'd', date: '2026-11-19', pulse: 76, systolic: 120, diastolic: 79 },
  ],
};
const roles = { patient: 'Paciente', nurse: 'Recepción / Enfermería', doctor: 'Médico' };
const navigation = {
  patient: [['home', 'Inicio', LayoutDashboard], ['record', 'Mi expediente', ClipboardList], ['vitals', 'VitalWatch', HeartPulse], ['appointment', 'Mis citas', CalendarDays], ['notes', 'Información privada', LockKeyhole], ['notifications', 'Notificaciones', Bell]],
  nurse: [['home', 'Citas del día', CalendarDays], ['search', 'Buscar paciente', Search], ['appointment', 'Registro de signos', ClipboardList]],
  doctor: [['home', 'Inicio', LayoutDashboard], ['search', 'Pacientes', UserRound], ['record', 'Expediente', ClipboardList], ['appointment', 'Notas SOAP', FileText]],
};
const statuses = { scheduled: 'Programada', arrived: 'En recepción', assessed: 'Valoración registrada', complete: 'Atendida' };
const analysisLabels = {
  atypical: 'Atípica',
  typical: 'Dentro de tu patrón',
  insufficient_history: 'Historial insuficiente',
  pending: 'Pendiente de análisis',
  unavailable: 'Análisis no disponible',
};
const soapFields = [['s', 'Subjetivo'], ['o', 'Objetivo'], ['a', 'Análisis'], ['p', 'Plan']];

function readDemo() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) ?? demo;
  } catch {
    return demo;
  }
}

function Panel({ title, subtitle, action, children }) {
  return <section className="panel">
    <header className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>
    {children}
  </section>;
}

function VitalChart({ readings, metric = 'pulse', selectedId }) {
  const selectedIndex = readings.findIndex(reading => reading.id === selectedId);
  const end = selectedIndex < 0 ? readings.length : Math.min(readings.length, Math.max(8, selectedIndex + 1));
  const recent = readings.slice(Math.max(0, end - 8), end);
  const isAtypical = reading => metric === 'pulse' && reading.analysis === 'atypical';
  const low = Math.floor((Math.min(...recent.map(row => row[metric])) - 5) / 5) * 5;
  const high = Math.ceil((Math.max(...recent.map(row => row[metric])) + 5) / 5) * 5;
  const points = recent.map((row, index) => ({
    x: 55 + index * 510 / Math.max(1, recent.length - 1),
    y: 145 - (row[metric] - low) * 120 / (high - low),
  }));
  const line = points.map(({ x, y }) => x + ',' + y).join(' ');
  return <svg className="chart" viewBox="0 0 610 190" role="img" aria-label={metric === 'pulse' ? 'Frecuencia cardíaca en latidos por minuto' : 'Presión sistólica en milímetros de mercurio'}>
    {[0, 1, 2, 3].map(index => <g key={index}>
      <text x="12" y={29 + index * 40}>{Math.round(high - index * (high - low) / 3)}</text>
      <line x1="55" x2="565" y1={25 + index * 40} y2={25 + index * 40} stroke="#dcebf4" strokeDasharray="4 5"/>
    </g>)}
    <polygon points={'55,145 ' + line + ' ' + points.at(-1).x + ',145'} fill="#e4f3fc"/>
    <polyline points={line} fill="none" stroke="#287ebc" strokeWidth="3" strokeLinejoin="round"/>
    {points.map(({ x, y }, i) => {
      const reading = recent[i];
      const atypical = isAtypical(reading);
      return <g key={reading.id}>
        <title>{reading[metric] + (metric === 'pulse' ? ' lpm' : ' mmHg') + (atypical ? ' · Lectura atípica' : '')}</title>
        {atypical
          ? <path d={`M${x} ${y - 7} l7 7 -7 7 -7 -7z`} fill="#a32d49" stroke="#fff" strokeWidth="1.5"/>
          : <circle cx={x} cy={y} r="4" fill="#fff" stroke="#287ebc" strokeWidth="2"/>}
        <text x={x} y="176" textAnchor="middle">{reading.date.slice(8)}/{reading.date.slice(5, 7)}</text>
      </g>;
    })}
  </svg>;
}

function MeasurementFields() {
  return <div className="form-grid">
    <label>Frecuencia cardíaca (lpm)<input name="pulse" type="number" min="1" max="350" required /></label>
    <label>Presión sistólica (mmHg)<input name="systolic" type="number" min="1" max="350" required /></label>
    <label>Presión diastólica (mmHg)<input name="diastolic" type="number" min="1" max="350" required /></label>
  </div>;
}

function App() {
  const [data, setData] = useState(readDemo);
  const [role, setRole] = useState(() => sessionStorage.getItem('medicontrol-profile') || 'patient');
  const [signedIn, setSignedIn] = useState(() => sessionStorage.getItem('medicontrol-profile') !== null);
  const [recordTab, setRecordTab] = useState('Resumen');
  const [page, setPage] = useState('home');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showReading, setShowReading] = useState(false);
  const [selectedReading, setSelectedReading] = useState(null);
  const [analyzing, setAnalyzing] = useState(() => new Set());
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {
      setNotice('Los cambios se conservarán mientras esta pestaña esté abierta.');
    }
  }, [data]);

  const go = next => { setPage(next); setNotice(''); setShowReading(false); setSearch(''); setRecordTab('Resumen'); };
  const selectRole = next => {
    setRole(next);
    sessionStorage.setItem('medicontrol-profile', next);
    go('home');
  };
  const update = (changes, message) => {
    setData(previous => ({ ...previous, ...changes }));
    setNotice(message);
  };
  const runAnalysis = async (reading, readings) => {
    setAnalyzing(previous => new Set(previous).add(reading.id));
    let analysis;
    try {
      analysis = await analyzePulse(reading, readings);
    } catch {
      analysis = 'unavailable';
    }
    setData(previous => ({
      ...previous,
      readings: previous.readings.map(item => item.id === reading.id ? { ...item, analysis } : item),
    }));
    setAnalyzing(previous => {
      const remaining = new Set(previous);
      remaining.delete(reading.id);
      return remaining;
    });
  };
  const saveReading = (reading, changes, message) => {
    const pendingReading = { ...reading, analysis: 'pending' };
    const readings = [...data.readings, pendingReading].sort((a, b) => a.date.localeCompare(b.date));
    update({ ...changes, readings }, message);
    void runAnalysis(pendingReading, readings);
  };
  const saveForm = (event, submit) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    submit(values, event.currentTarget);
  };
  const measurements = values => {
    const pulse = Number(values.pulse);
    const systolic = Number(values.systolic);
    const diastolic = Number(values.diastolic);
    if (systolic <= diastolic) {
      setNotice('La presión sistólica debe ser mayor que la diastólica.');
      return null;
    }
    return { pulse, systolic, diastolic };
  };
  const heading = page === 'home'
    ? { patient: 'Hola, Andrea López', nurse: 'Citas de hoy', doctor: 'Bienvenida, Dra. Rivera' }[role]
    : navigation[role].find(item => item[0] === page)?.[1];

  const appointment = <Panel title={role === 'patient' && data.status === 'complete' ? 'Última consulta' : 'Cita de seguimiento'} subtitle="Medicina general">
    <div className="appointment">
      <span className="icon-box"><CalendarDays size={21}/></span>
      <div><strong>Andrea López</strong><p>20 de noviembre de 2026 · 10:30</p><p>Dra. Elena Rivera</p></div>
      <span className="pill">{statuses[data.status]}</span>
    </div>
    {page === 'home' && <button className="secondary full" onClick={() => go('appointment')}>Ver cita</button>}
  </Panel>;

  const assessment = data.assessment && <Panel title="Valoración inicial">
    <dl className="details">
      <div><dt>Frecuencia cardíaca</dt><dd>{data.assessment.pulse} lpm</dd></div>
      <div><dt>Presión arterial</dt><dd>{data.assessment.systolic}/{data.assessment.diastolic} mmHg</dd></div>
      <div><dt>Peso y estatura</dt><dd>{data.assessment.weight} kg · {data.assessment.height} cm</dd></div>
      <div><dt>Síntomas</dt><dd>{data.assessment.symptoms}</dd></div>
    </dl>
  </Panel>;

  const consultation = data.soap && <Panel title={role === 'doctor' ? 'Nota SOAP' : 'Indicaciones de tu consulta'}>
    <dl className="details">
      {(role === 'doctor' ? soapFields : [soapFields[3]]).map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd>{data.soap[key]}</dd></div>)}
    </dl>
  </Panel>;

  if (!signedIn) return <div className="login-layout">
    <section className="login-card">
      <header className="frame-title"><UserRound size={22}/> Inicio de sesión</header>
      <div className="login-content">
        <div className="login-brand"><HeartPulse size={66}/><strong>MediControl</strong><span>+ VitalWatch</span></div>
        <form onSubmit={event => { event.preventDefault(); selectRole(role); setSignedIn(true); }}>
          <label>Correo o usuario<input value="demo@medicontrol.local" readOnly autoComplete="username"/></label>
          <label>Contraseña<input type="password" value="demostracion" readOnly autoComplete="current-password"/></label>
          <label>Perfil de demostración<select value={role} onChange={event => setRole(event.target.value)}>
            {Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <button className="primary full">Iniciar sesión</button>
          <p>Cuenta de demostración · Datos ficticios</p>
        </form>
      </div>
    </section>
  </div>;

  const privatePanel = <section className="panel privacy-card">
    <span className="icon-box"><LockKeyhole size={26}/></span>
    <h2>Información privada</h2><p>Solo tú puedes verla en tu perfil.</p>
    <button className="primary" onClick={() => go('notes')}>Ver información</button>
  </section>;
  const shortcuts = [
    ['Mis signos vitales', HeartPulse, 'pink', () => go('vitals')],
    ['Próxima cita', CalendarDays, 'blue', () => go('appointment'), statuses[data.status]],
    ['Últimos análisis', FlaskConical, 'cyan', () => { go('record'); setRecordTab('Laboratorios'); }],
    ['Mi expediente', FolderOpen, 'orange', () => go('record')],
  ];

  return <div className="app-frame">
    <header className="frame-title"><Stethoscope size={22}/> Perfil: {roles[role]}</header>
    <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span><HeartPulse size={25}/></span><div>MediControl<small>+ VitalWatch</small></div></div>
      <nav aria-label="Menú principal">
        {navigation[role].map(([id, label, Icon]) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}><Icon size={19}/>{label}</button>)}
        <button onClick={() => { sessionStorage.removeItem('medicontrol-profile'); setSignedIn(false); go('home'); }}><LockKeyhole size={19}/>Cerrar sesión</button>
      </nav>
      <div className="sidebar-footer"><span className="avatar">MC</span><div>Entorno de demostración<small>Datos ficticios</small></div></div>
    </aside>
    <main>
      <header className="topbar"><span><Stethoscope size={17}/> Portal clínico</span>
        <label htmlFor="role"><UserRound size={17}/><span>Perfil de demostración</span>
          <select id="role" aria-label="Perfil de demostración" value={role} onChange={event => { selectRole(event.target.value); }}>{Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
      </header>
      <div className={role === 'patient' && page === 'home' ? 'content patient-home' : 'content'}>
        <div className="page-heading"><div><h1>{heading}</h1>
          {role === 'patient' && page === 'home' && <p>Cuida tu salud, estamos contigo.</p>}
          {role === 'doctor' && page === 'home' && <p>Consulta y gestiona la información de tus pacientes.</p>}
        </div>{role === 'patient' && page === 'home' && <button className="secondary bell" aria-label="Notificaciones" onClick={() => go('notifications')}><Bell size={19}/></button>}</div>
        {notice && <p className="notice" role="status">{notice}</p>}

        {role === 'patient' && page === 'home' && <>
          <div className="stats">
            {shortcuts.map(([label, Icon, color, action, detail]) => <button key={label} className={'shortcut ' + color} onClick={action}><Icon size={30}/><strong>{label}</strong>{detail && <small>{detail}</small>}</button>)}
          </div>
          <div className="dashboard-row">
            <Panel title="Tu presión arterial" subtitle="Últimas mediciones · Sistólica (mmHg)">
              <VitalChart readings={data.readings} metric="systolic"/>
            </Panel>
            <div className="dashboard-sidebar">
              {appointment}
              {privatePanel}
            </div>
          </div>
        </>}

        {role === 'doctor' && page === 'home' && <>
          <div className="stats doctor-stats">
            <button className="shortcut blue" onClick={() => go('search')}><UserRound size={27}/><strong>Pacientes</strong><b>1</b></button>
            <button className="shortcut blue" onClick={() => go('appointment')}><CalendarDays size={27}/><strong>Citas del día</strong><b>1</b></button>
            <button className="shortcut cyan" onClick={() => go('record')}><ClipboardList size={27}/><strong>Atendidos</strong><b>{Number(data.status === 'complete')}</b></button>
            <button className="shortcut orange" onClick={() => go('appointment')}><Bell size={27}/><strong>Pendientes</strong><b>{Number(data.status !== 'complete')}</b></button>
          </div>
          <Panel title="Pacientes recientes">
            <div className="patient-row"><span className="avatar">AL</span><div><strong>Andrea López</strong><p>Medicina general</p></div>
              <button className="secondary" onClick={() => go('record')}>Ver expediente</button></div>
          </Panel>
        </>}

        {role === 'nurse' && page === 'home' && <>
          <AgendaInasistencia/>
          {appointment}
          <Panel title="Registro de signos vitales">
            <div className="vital-preview">
              <div><HeartPulse size={20}/> <span>Frecuencia cardíaca<strong>{data.assessment ? data.assessment.pulse + ' lpm' : 'Pendiente'}</strong></span></div>
              <div><Activity size={20}/> <span>Presión arterial<strong>{data.assessment ? data.assessment.systolic + '/' + data.assessment.diastolic + ' mmHg' : 'Pendiente'}</strong></span></div>
            </div>
            <button className="primary full" onClick={() => go('appointment')}>Abrir valoración</button>
          </Panel>
        </>}

        {page === 'search' && <>
          <label className="search">Buscar paciente<input type="search" placeholder="Nombre del paciente" value={search} onChange={event => setSearch(event.target.value)}/></label>
          {['andrea lópez', 'andrea lopez'].some(name => name.includes(search.trim().toLowerCase())) ?
            <Panel title="Resultados"><div className="patient-row"><span className="avatar">AL</span><strong>Andrea López</strong><button className="secondary" onClick={() => go(role === 'doctor' ? 'record' : 'appointment')}>{role === 'doctor' ? 'Ver expediente' : 'Ver cita'}</button></div></Panel> :
            <p>No se encontraron pacientes.</p>}
        </>}

        {page === 'notifications' && <>
          <Panel title="Notificaciones">
            <div className="patient-row"><span className="icon-box"><CalendarDays size={19}/></span><div><strong>Recordatorio de cita</strong><p>20 de noviembre de 2026 · 10:30</p></div><button className="secondary" onClick={() => go('appointment')}>Ver cita</button></div>
            {data.soap && <div className="patient-row"><span className="icon-box"><HeartPulse size={19}/></span><div><strong>Nueva indicación médica</strong><p>{data.soap.p}</p></div><button className="secondary" onClick={() => go('appointment')}>Ver indicaciones</button></div>}
          </Panel>
          {privatePanel}
        </>}

        {page === 'appointment' && <>
          {appointment}
          {role === 'nurse' && data.status === 'scheduled' && <button className="primary" onClick={() => update({ status: 'arrived' }, 'Llegada registrada.')}>Registrar llegada</button>}
          {role === 'nurse' && data.status === 'arrived' && <Panel title="Capturar valoración inicial">
            <form onSubmit={event => saveForm(event, values => {
              const vital = measurements(values);
              if (!vital || !values.symptoms.trim()) {
                if (vital) setNotice('Escribe los síntomas o indica que el paciente no refiere síntomas.');
                return;
              }
              const reading = { ...vital, id: crypto.randomUUID(), date: new Date().toLocaleDateString('sv-SE'), source: 'Enfermería' };
              saveReading(reading, { status: 'assessed', assessment: { ...values, ...vital } }, 'Valoración guardada en el expediente.');
            })}>
              <MeasurementFields/>
              <div className="form-grid">
                <label>Peso (kg)<input name="weight" type="number" min="0.1" step="0.1" required/></label>
                <label>Estatura (cm)<input name="height" type="number" min="1" step="0.1" required/></label>
              </div>
              <label>Síntomas<textarea name="symptoms" required/></label>
              <button className="primary">Guardar valoración</button>
            </form>
          </Panel>}
          {assessment}
          {role === 'doctor' && ['scheduled', 'arrived'].includes(data.status) && <p className="notice">La valoración inicial está pendiente.</p>}
          {role === 'doctor' && data.status === 'assessed' && <Panel title="Elaborar nota SOAP">
            <form onSubmit={event => saveForm(event, values => {
              if (Object.values(values).some(value => !value.trim())) return setNotice('Completa los cuatro campos de la nota SOAP.');
              update({ status: 'complete', soap: values }, 'Consulta guardada.');
            })}>
              {soapFields.map(([key, label]) => <label key={key}>{label}<textarea name={key} required/></label>)}
              <button className="primary">Finalizar consulta</button>
            </form>
          </Panel>}
          {role !== 'nurse' && consultation}
        </>}

        {page === 'vitals' && <>
          <Panel title="Frecuencia cardíaca" subtitle="Últimas mediciones en latidos por minuto" action={<button className="primary" onClick={() => setShowReading(!showReading)}>{showReading ? 'Cerrar captura' : 'Registrar medición'}</button>}>
            <div id="grafica-frecuencia"><VitalChart readings={data.readings} selectedId={selectedReading}/></div>
            <p className="chart-legend"><span aria-hidden="true">◆</span> Lectura atípica respecto a tu historial</p>
            {selectedReading && <button className="secondary" onClick={() => setSelectedReading(null)}>Ver últimas mediciones</button>}
          </Panel>
          {showReading && <Panel title="Nueva medición"><form onSubmit={event => saveForm(event, values => {
            const vital = measurements(values);
            if (!vital) return;
            const reading = { ...vital, date: values.date, id: crypto.randomUUID(), source: 'Paciente' };
            saveReading(reading, {}, 'Medición registrada.');
            setSelectedReading(reading.id);
            setShowReading(false);
          })}>
            <label>Fecha<input name="date" type="date" required defaultValue={new Date().toLocaleDateString('sv-SE')}/></label>
            <MeasurementFields/><button className="primary">Guardar medición</button>
          </form></Panel>}
          <Panel title="Historial de mediciones"><div className="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Frecuencia</th><th>Presión</th><th>Origen</th><th>Análisis de frecuencia</th></tr></thead>
            <tbody>{[...data.readings].reverse().map(row => <tr key={row.id}>
              <td>{row.date}</td><td>{row.pulse} lpm</td><td>{row.systolic}/{row.diastolic} mmHg</td><td>{row.source ?? 'Paciente'}</td>
              <td>
                <span className={row.analysis === 'atypical' ? 'pill atypical' : ''} aria-live="polite">
                  {analyzing.has(row.id) ? 'Analizando…' : analysisLabels[row.analysis] ?? 'Sin análisis'}
                </span>
                {row.analysis === 'atypical' && <button className="secondary analysis-action" onClick={() => {
                  setSelectedReading(row.id);
                  document.getElementById('grafica-frecuencia')?.scrollIntoView({ block: 'center' });
                }}>Ver en gráfica</button>}
                {['pending', 'unavailable'].includes(row.analysis) && !analyzing.has(row.id) &&
                  <button className="secondary analysis-action" onClick={() => void runAnalysis(row, data.readings)}>Reintentar</button>}
              </td>
            </tr>)}</tbody>
          </table></div></Panel>
        </>}

        {page === 'record' && <>
          <nav className="record-tabs" aria-label="Secciones del expediente">
            {['Resumen', 'Signos', 'Laboratorios', 'Documentos', 'Notas', 'Consultas'].map(tab =>
              <button key={tab} aria-current={recordTab === tab ? 'page' : undefined} onClick={() => setRecordTab(tab)}>{tab}</button>)}
          </nav>
          <Panel title="Andrea López" subtitle="Expediente de demostración">
            {recordTab === 'Resumen' && <dl className="details"><div><dt>Antecedentes</dt><dd>Sin antecedentes registrados</dd></div><div><dt>Alergias</dt><dd>Sin alergias registradas</dd></div><div><dt>Medicamentos</dt><dd>Sin medicamentos registrados</dd></div></dl>}
            {recordTab === 'Laboratorios' && <p>Sin resultados registrados.</p>}
            {recordTab === 'Documentos' && <p>Sin documentos adjuntos.</p>}
            {recordTab === 'Notas' && !data.soap && <p>Aún no hay notas de consulta.</p>}
          </Panel>
          {['Resumen', 'Signos'].includes(recordTab) && <Panel title="Evolución de signos vitales" subtitle="Presión sistólica (mmHg)">
            <VitalChart readings={data.readings} metric="systolic"/>
          </Panel>}
          {recordTab === 'Signos' && assessment}
          {['Resumen', 'Notas', 'Consultas'].includes(recordTab) && consultation}
          {recordTab === 'Consultas' && appointment}
        </>}

        {page === 'notes' && <Panel title="Mis notas" subtitle="Visibles en el perfil del paciente en esta demo">
          <form onSubmit={event => saveForm(event, (values, form) => {
            if (!values.note.trim()) return setNotice('Escribe una nota antes de guardarla.');
            update({ notes: [{ id: crypto.randomUUID(), text: values.note.trim() }, ...data.notes] }, 'Nota guardada.');
            form.reset();
          })}>
            <label>Nueva nota<textarea name="note" required/></label><button className="primary">Guardar nota</button>
          </form>
          {data.notes.length ? <ul className="notes">{data.notes.map(note => <li key={note.id}>{note.text}</li>)}</ul> : <p>Aún no tienes notas.</p>}
        </Panel>}
      </div>
    </main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
