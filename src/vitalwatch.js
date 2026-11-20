const analysisStatuses = new Set(['typical', 'atypical', 'insufficient_history']);

export async function analyzePulse(reading, orderedReadings) {
  const index = orderedReadings.findIndex(item => item.id === reading.id);
  const history = orderedReadings.slice(Math.max(0, index - 30), index).map(item => item.pulse);
  const response = await fetch('/api/vitalwatch/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pulse: reading.pulse, history }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Webhook de VitalWatch no disponible');
  const result = await response.json();
  if (!analysisStatuses.has(result.status)) throw new Error('Respuesta inesperada de VitalWatch');
  return result.status;
}
