// Pacientes ficticios para la demostración. No representan a personas reales.
// medicoId indica qué médico tiene permiso de consultar el expediente.
import { historialDemo } from './historial-demo.js';

const sinRegistros = { assessment: null, soap: null, readings: [] };
const historial = ({ antecedentes = [], alergias = [], medicamentos = [], laboratorios = [], consultasPrevias = [] }) =>
  ({ antecedentes, alergias, medicamentos, laboratorios, consultasPrevias });

export const medicos = {
  rivera: 'Dra. Elena Rivera',
  ortega: 'Dr. Luis Ortega',
};
export const MEDICO_DEMO = 'rivera';

export const pacientesDemo = [
  // Andrea López usa además los datos que se capturan en la app (valoración, nota SOAP y signos).
  { id: 'p01', nombre: 'Andrea López', medicoId: 'rivera', historial: historialDemo, data: sinRegistros },
  {
    id: 'p02', nombre: 'Carlos Hernández', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Diabetes tipo 2 diagnosticada en 2019.'],
      alergias: ['Sin alergias conocidas.'],
      medicamentos: ['Metformina 850 mg cada 12 horas.'],
      laboratorios: [{ fecha: '2026-09-20', estudio: 'Hemoglobina glucosilada', resultado: 'HbA1c 7.8 % (por encima de la meta).' }],
      consultasPrevias: [{ fecha: '2026-09-25', motivo: 'Control de diabetes', resumen: 'Se refuerza la dieta y se cita en tres meses para valorar ajuste de tratamiento.' }],
    }),
  },
  {
    id: 'p03', nombre: 'María Fernández', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Asma desde la infancia.'],
      alergias: ['Ácaros del polvo y polen (rinitis).'],
      medicamentos: ['Salbutamol inhalado en caso de falta de aire.', 'Budesonida inhalada dos veces al día.'],
      consultasPrevias: [{ fecha: '2026-07-03', motivo: 'Crisis asmática leve', resumen: 'Mejoró con salbutamol. Se indica usar budesonida diario.' }],
    }),
  },
  {
    id: 'p04', nombre: 'José Ramírez', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Cardiopatía isquémica con colocación de stent coronario en 2023.'],
      alergias: ['Sin alergias conocidas.'],
      medicamentos: ['Ácido acetilsalicílico 100 mg cada 24 horas.', 'Atorvastatina 40 mg por la noche.', 'Metoprolol 50 mg cada 12 horas.'],
      laboratorios: [{ fecha: '2026-08-11', estudio: 'Perfil de lípidos', resultado: 'Colesterol LDL 88 mg/dL.' }],
    }),
  },
  {
    id: 'p05', nombre: 'Lucía Torres', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Hipotiroidismo diagnosticado en 2020.'],
      alergias: ['Sulfonamidas (sulfas): erupción en la piel.'],
      medicamentos: ['Levotiroxina 75 mcg en ayunas.'],
      laboratorios: [{ fecha: '2026-10-15', estudio: 'Perfil tiroideo', resultado: 'TSH 2.1 mUI/L, dentro de rango.' }],
    }),
  },
  {
    id: 'p06', nombre: 'Miguel Sánchez', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Sin enfermedades crónicas. Fractura de radio derecho en 2024.'],
      alergias: ['Ibuprofeno: broncoespasmo.'],
      medicamentos: ['No toma medicamentos de forma habitual.'],
    }),
  },
  {
    id: 'p07', nombre: 'Rosa Martínez', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Hipertensión arterial.', 'Osteoporosis diagnosticada en 2022.'],
      alergias: ['Penicilina: reacción anafiláctica en 2010.'],
      medicamentos: ['Amlodipino 5 mg cada 24 horas.', 'Alendronato 70 mg una vez por semana.', 'Calcio con vitamina D diario.'],
    }),
  },
  {
    id: 'p08', nombre: 'Fernando Díaz', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Hígado graso y sobrepeso.'],
      alergias: ['Sin alergias conocidas.'],
      medicamentos: ['No toma medicamentos de forma habitual.'],
      laboratorios: [{ fecha: '2026-09-02', estudio: 'Pruebas de función hepática', resultado: 'ALT 62 U/L (elevada).' }],
    }),
  },
  {
    id: 'p09', nombre: 'Sofía Gómez', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Migraña desde los 18 años.'],
      alergias: ['Látex: dermatitis de contacto.'],
      medicamentos: ['Sumatriptán 50 mg al inicio de una migraña.'],
    }),
  },
  {
    id: 'p10', nombre: 'Raúl Castillo', medicoId: 'rivera', data: sinRegistros,
    historial: historial({
      antecedentes: ['Enfermedad pulmonar obstructiva crónica (EPOC). Exfumador desde 2019.'],
      alergias: ['Sin alergias conocidas.'],
      medicamentos: ['Tiotropio inhalado cada 24 horas.'],
      consultasPrevias: [{ fecha: '2026-10-21', motivo: 'Tos y falta de aire', resumen: 'Exacerbación leve. Se indica vacunarse contra la influenza.' }],
    }),
  },
  // Pacientes de otro médico: la Dra. Rivera no debe poder consultarlos.
  {
    id: 'p11', nombre: 'Elena Vargas', medicoId: 'ortega', data: sinRegistros,
    historial: historial({ antecedentes: ['Diabetes gestacional en 2021.'], alergias: ['Ácido acetilsalicílico: urticaria.'] }),
  },
  {
    id: 'p12', nombre: 'Tomás Ruiz', medicoId: 'ortega', data: sinRegistros,
    historial: historial({ antecedentes: ['Gota.'], alergias: ['Penicilina: urticaria.'], medicamentos: ['Alopurinol 100 mg diario.'] }),
  },
];
