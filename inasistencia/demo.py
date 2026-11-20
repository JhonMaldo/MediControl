from datetime import datetime, timedelta
from random import Random


def demo_rows():
    rng = Random(46)
    agenda = datetime(2026, 11, 20)
    patients = ["Andrea López", "Laura Gómez", "Mateo Cruz", "Sofía Pérez", "Diego Ruiz", "Elena Díaz"]
    for day in range(160, 0, -1):
        for patient_id, name in enumerate(patients, 1):
            hour = rng.choice([8, 10, 13, 16, 18])
            scheduled = agenda - timedelta(days=day) + timedelta(hours=hour)
            lead = rng.choice([1, 3, 7, 14, 28])
            booked = scheduled - timedelta(days=lead)
            chance = .07 + .35 * (lead >= 14) + .16 * (hour == 8) + .20 * (patient_id % 3 == 0)
            draw = rng.random()
            status = 'cancelada' if draw < .09 else 'inasistencia' if draw < .09 + chance else 'asistio'
            resolved = scheduled - timedelta(hours=3) if status == 'cancelada' else scheduled + timedelta(hours=1)
            yield patient_id, name, booked, scheduled, status, resolved
    for patient_id, name in enumerate(patients, 1):
        scheduled = agenda + timedelta(hours=8 + patient_id)
        lead = [3, 14, 28, 7, 1, 21][patient_id - 1]
        yield patient_id, name, scheduled - timedelta(days=lead), scheduled, 'programada', None
