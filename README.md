# MediControl + VitalWatch

Prototipo local de React con un paciente y una cita de ejemplo. Los datos son ficticios y los cambios se guardan en el navegador. El selector de perfiles simula la experiencia de cada usuario. La aplicación no incorpora autenticación ni permisos de servidor y no debe usarse con expedientes reales.

## Ejecutar

```bash
npm install
npm run dev
```

Abre la dirección local que muestra Vite. Para generar la compilación estática, ejecuta `npm run build`.

## Recorrido de demostración

En la pantalla de inicio de sesión, selecciona un perfil y pulsa **Iniciar sesión**. Puedes cambiar de perfil desde la barra superior.

1. Cambia a **Recepción / Enfermería**, abre la cita de Andrea López y registra su llegada.
2. Captura los signos vitales, la somatometría y los síntomas. Guarda la valoración.
3. Cambia a **Médico**, abre la cita, revisa la valoración y guarda los cuatro campos de la nota SOAP.
4. Vuelve al perfil **Paciente** para consultar las indicaciones en **Mis citas**. En **VitalWatch** puedes registrar mediciones manuales y consultar el historial. En **Notas privadas** puedes guardar anotaciones personales de prueba.

El expediente muestra la valoración y la consulta registradas. Los apartados de antecedentes, alergias, medicamentos, resultados y documentos sirven como referencia visual para una versión posterior.

## Pronóstico de tendencias de signos vitales

**Responsable de la tarea:** Gerald Villafan Alonso.

Un modelo local de series de tiempo analiza el historial de cada paciente (frecuencia cardíaca, presión sistólica y diastólica, temperatura y saturación de oxígeno) y estima la tendencia de los próximos días con un margen de incertidumbre del 90 %. El panel **Tendencia de signos vitales** aparece en **Paciente → VitalWatch**, debajo de la frecuencia cardíaca, fijo en Andrea López, y en **Médico → Expediente → Signos**, con un selector de paciente. Es apoyo para el seguimiento médico, **no un diagnóstico**.

1. Ejecuta `docker compose --profile pronostico up -d --build pronostico-signos`.
2. Revisa `docker compose logs -f pronostico-signos` hasta que indique `API de pronóstico disponible (datos: mariadb)`. Cuando la tabla está vacía, el servicio crea el historial ficticio en MariaDB.
3. Ejecuta `npm run dev` y abre **VitalWatch** o el expediente. Vite reenvía `/api/pronostico` a `http://127.0.0.1:8092`. Si la API corre en otra dirección, usa `PRONOSTICO_API_ORIGIN=http://host:puerto npm run dev`.

**Modo local sin Docker** (lee los mismos datos de demostración en memoria, sin MariaDB):

```bash
cd pronostico
python -m venv .venv && .venv/Scripts/activate   # en Linux o macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8092
python -m pytest            # pruebas
python evaluar_modelos.py   # vuelve a comparar los modelos (unos 2 a 3 minutos)
```

El panel usa el historial de MariaDB (datos de demostración). No usa las mediciones del recorrido que se guardan en el navegador. Para no chocar con la rama de inasistencia, este servicio tiene su propia base (`signos-db`, volumen `signos-data`). Al fusionar, el equipo puede unir ambas tablas en una sola MariaDB: los ids de los pacientes (1 Andrea López a 6 Elena Díaz) son los mismos.

### API

| Ruta | Respuesta |
|---|---|
| `GET /api/pronostico/salud` | `{"estado": "ok", "modulo": "pronostico", "origen_datos": "mariadb"}` (o `"demo"`) |
| `GET /api/pronostico/pacientes` | `[{"id": 1, "nombre": "Andrea López"}, …]` |
| `GET /api/pronostico/pacientes/{id}?horizonte=7` | Los 5 signos del paciente, con la regla R6 aplicada |
| `GET /api/pronostico/pacientes/{id}/signos/{signo}?horizonte=7&modelo=` | Un signo. `modelo` es opcional: `base`, `arima` o `prophet` |

El horizonte va de 1 a 30 días (la interfaz ofrece 3, 7 y 14). Un signo, horizonte o modelo no válidos reciben 400, un paciente inexistente recibe 404 y una base de datos inaccesible recibe 503. Las respuestas se guardan en caché por paciente, signo, horizonte, modelo, última fecha medida y número de mediciones.

```bash
curl -f http://127.0.0.1:8092/api/pronostico/salud
curl -f http://127.0.0.1:8092/api/pronostico/pacientes
curl -f 'http://127.0.0.1:8092/api/pronostico/pacientes/4/signos/temperatura?horizonte=3'
curl -f 'http://127.0.0.1:8092/api/pronostico/pacientes/2?horizonte=7'
```

Respuesta real de la tercera consulta (Sofía Pérez, temperatura). Aquí solo se muestran los últimos 3 días del historial; la API devuelve los 119 días. `segundos_calculo` cambia en cada ejecución:

```json
{
  "paciente_id": 4,
  "paciente": "Sofía Pérez",
  "signo": "temperatura",
  "nombre": "Temperatura",
  "unidad": "°C",
  "rango_referencia": [36.0, 37.5],
  "nivel_confianza": 0.9,
  "horizonte": 3,
  "historial": [
    {"fecha": "2026-11-17", "valor": null},
    {"fecha": "2026-11-18", "valor": null},
    {"fecha": "2026-11-19", "valor": 38.45}
  ],
  "pronostico": [
    {"fecha": "2026-11-20", "valor": 38.45, "inferior": 38.22, "superior": 38.68},
    {"fecha": "2026-11-21", "valor": 38.45, "inferior": 38.12, "superior": 38.78},
    {"fecha": "2026-11-22", "valor": 38.45, "inferior": 38.05, "superior": 38.85}
  ],
  "modelo_usado": "arima",
  "descripcion_modelo": "ARIMA(0, 1, 0) tendencia='n'",
  "advertencias": [
    {
      "regla": "R5",
      "tipo": "aviso",
      "mensaje": "Revisar en consulta: la tendencia proyectada termina en 38.5 °C, por encima del rango de referencia (36.0-37.5)."
    }
  ],
  "calidad_datos": {
    "dias_totales": 119,
    "dias_con_dato": 89,
    "porcentaje_huecos": 25.2,
    "valores_descartados": 0,
    "mediciones_atipicas_excluidas": 0
  },
  "nota": "Proyección estadística de apoyo para el seguimiento del paciente. No es un diagnóstico.",
  "segundos_calculo": 1.064
}
```

### Evaluación de los modelos

`pronostico/evaluar_modelos.py` compara tres modelos con validación de origen móvil. Para cada paciente y signo hace 4 cortes (los últimos 4 bloques de 7 días): entrena con lo anterior, pronostica 7 días y compara con lo registrado. Los resultados se guardan en `pronostico/resultados/evaluacion.csv` y `pronostico/resultados/modelo_elegido.json`, que el servicio lee al responder (si no existe, usa ARIMA).

- **base:** promedio de los últimos 3 valores. La banda sale de los errores históricos de esa misma regla y crece con el horizonte. Con 7 valores se quedaba atrás cuando un signo empieza a subir, como en la fiebre.
- **arima** (statsmodels): prueba p ∈ {0, 1, 2} y q ∈ {0, 1} con d=0 y tendencia `c`, y con d=1 y tendencia `n` o `t`. Se queda con el de menor AIC.
- **prophet:** banda del 90 %, estacionalidad semanal solo con 21 días o más, sin estacionalidad diaria ni anual, `changepoint_prior_scale=0.05`.

**Regla de elección por signo:** el menor MAE con una cobertura de la banda de al menos 75 % y sin más rechazos que el base. Si ninguno cumple, se usa el base.

Resultados de la ejecución del 20 de noviembre de 2026 (datos de demostración, 20 ejercicios por signo y modelo; MAE y RMSE en la unidad del signo):

| Signo | Modelo | MAE | RMSE | Cobertura | Rechazos | Tiempo (s) | Mejora vs. base |
|---|---|---:|---:|---:|---:|---:|---:|
| Frecuencia cardíaca | base | 4.509 | 5.858 | 85.5 % | 0.0 % | 0.005 | 0.0 % |
| Frecuencia cardíaca | arima | 4.394 | 6.009 | 80.0 % | 0.0 % | 0.827 | 2.6 % |
| Frecuencia cardíaca | prophet | 5.003 | 6.628 | 69.1 % | 0.0 % | 0.842 | -11.0 % |
| Presión sistólica | base | 5.868 | 6.867 | 90.7 % | 0.0 % | 0.005 | 0.0 % |
| Presión sistólica | arima | 4.733 | 5.852 | 88.8 % | 0.0 % | 0.664 | 19.3 % |
| Presión sistólica | prophet | 5.696 | 6.882 | 75.7 % | 0.0 % | 0.572 | 2.9 % |
| Presión diastólica | base | 3.212 | 4.276 | 90.3 % | 0.0 % | 0.005 | 0.0 % |
| Presión diastólica | arima | 3.076 | 3.817 | 91.2 % | 0.0 % | 0.727 | 4.2 % |
| Presión diastólica | prophet | 3.188 | 3.961 | 83.2 % | 0.0 % | 0.545 | 0.8 % |
| Temperatura | base | 0.189 | 0.284 | 87.3 % | 0.0 % | 0.005 | 0.0 % |
| Temperatura | arima | 0.164 | 0.282 | 84.5 % | 0.0 % | 1.008 | 13.3 % |
| Temperatura | prophet | 0.218 | 0.324 | 64.5 % | 0.0 % | 0.567 | -15.3 % |
| Saturación de oxígeno | base | 1.005 | 1.307 | 89.1 % | 0.0 % | 0.005 | 0.0 % |
| Saturación de oxígeno | arima | 0.915 | 1.311 | 84.5 % | 0.0 % | 0.684 | 8.9 % |
| Saturación de oxígeno | prophet | 1.074 | 1.473 | 71.8 % | 0.0 % | 0.518 | -6.9 % |

| Signo | Modelo elegido | Motivo |
|---|---|---|
| Frecuencia cardíaca | arima | Menor MAE entre los aptos (4.394, cobertura 80.0 %, mejora vs base 2.6 %); no aptos: prophet (cobertura 69.1 %, rechazos 0.0 %) |
| Presión sistólica | arima | Menor MAE entre los aptos (4.733, cobertura 88.8 %, mejora vs base 19.3 %) |
| Presión diastólica | arima | Menor MAE entre los aptos (3.076, cobertura 91.2 %, mejora vs base 4.2 %) |
| Temperatura | arima | Menor MAE entre los aptos (0.164, cobertura 84.5 %, mejora vs base 13.3 %); no aptos: prophet (cobertura 64.5 %, rechazos 0.0 %) |
| Saturación de oxígeno | arima | Menor MAE entre los aptos (0.915, cobertura 84.5 %, mejora vs base 8.9 %); no aptos: prophet (cobertura 71.8 %, rechazos 0.0 %) |

ARIMA ganó en los cinco signos. Se adapta al nivel reciente de cada paciente y, con d=1 y tendencia, sigue cambios graduales como la presión de Laura o la fiebre de Sofía. Prophet quedó por debajo del 75 % de cobertura en frecuencia, temperatura y saturación: su banda resultó demasiado angosta para series cortas y ruidosas. En las dos presiones sí pasó el umbral, pero tuvo un MAE mayor que ARIMA. El modelo base es muy rápido y tiene buena cobertura, pero se equivoca más. Ningún modelo provocó rechazos de coherencia en la evaluación. ARIMA tarda alrededor de un segundo por signo; el base, milésimas.

### Reglas de coherencia

Se aplican antes de mostrar cualquier pronóstico. Si una proyección se rechaza o el modelo falla, se usa el modelo base y se avisa. Cada advertencia lleva `regla`, `tipo` y `mensaje`.

| Regla | Condición | Resultado |
|---|---|---|
| R0 | Menos de 14 días con dato | `sin_pronostico`: "Sin proyección para este signo" con el motivo |
| R1 | Algún valor proyectado fuera del rango posible | `rechazo`, se usa el base |
| R2 | El primer valor se aleja del promedio de los últimos 3 registros más de 4 × mediana de la variación diaria + 0.5 × desviación estándar | `rechazo`, se usa el base |
| R3 | Valor y banda fuera del rango posible | Se recortan al rango posible |
| R4 | El ancho de la banda supera 1.5 veces el rango del último mes | `aviso` de poca precisión |
| R5 | El valor final queda fuera del rango de referencia | `aviso` "Revisar en consulta" |
| R6 | La sistólica proyectada no es mayor que la diastólica | `rechazo` de ambas, se usa el base |

Rangos posibles y de referencia: frecuencia 30-220 / 60-100 lpm, sistólica 60-260 / 90-130 mmHg, diastólica 30-160 / 60-85 mmHg, temperatura 33-43 / 36.0-37.5 °C y saturación 70-100 / 95-100 %. Los valores fuera del rango posible (por ejemplo, una temperatura de 365) se toman como errores de captura y se descartan. Las series se agrupan por día y los días sin medición quedan vacíos, sin interpolar.

### Relación con la detección de lecturas atípicas

La tabla `signos_vitales` tiene la columna `es_atipica`. La marca el módulo de lecturas atípicas de n8n. Este módulo no detecta atípicas: solo excluye las filas que ya llegan marcadas y las cuenta en `calidad_datos.mediciones_atipicas_excluidas`. Así, una lectura que el equipo ya identificó como atípica no desvía la tendencia. En la demo, Andrea López tiene dos mediciones marcadas (128 y 131 lpm).

### Cargar datos reales

Usa el esquema de `pronostico/schema.sql`, carga registros compatibles y arranca con `PRONOSTICO_SEED_DEMO=0 docker compose --profile pronostico up -d --build pronostico-signos`. Si la tabla ya tiene datos, no se insertan los de demostración. Para empezar de cero, borra el volumen con `docker compose --profile pronostico down -v`. Con un historial distinto, conviene repetir la evaluación sobre esos datos: `docker compose exec pronostico-signos python evaluar_modelos.py` (dentro del contenedor lee MariaDB), luego `docker compose cp pronostico-signos:/app/resultados/. pronostico/resultados/` y vuelve a construir la imagen.

### Seguridad y limitaciones

- El prototipo no tiene autenticación. Por eso el puerto 8092 solo se publica en `127.0.0.1`. En producción, esta API debe ir detrás del backend, que valida la sesión y el rol. El backend también debe garantizar que un paciente solo consulte su propio historial.
- El horizonte útil es corto. Más allá de unos días, la banda se ensancha y la proyección tiende al nivel reciente.
- El modelo no anticipa cambios que todavía no empiezan. Solo prolonga lo que ya se ve en el historial.
- La primera petición de cada combinación tarda más: alrededor de 1 segundo por signo con ARIMA, unos 2 con Prophet y unos 4 para los 5 signos de un paciente. Las siguientes salen de la caché.
- El formulario actual de VitalWatch no captura temperatura ni saturación. Esos signos solo existen en los datos de demostración de MariaDB.
- Los datos son ficticios y las cifras de la evaluación dependen de ellos.

Post-it para el tablero físico: **Pronóstico de signos vitales — Gerald Villafan Alonso**. La verificación consiste en levantar MariaDB y la API, revisar la tendencia en VitalWatch y en el expediente, y comparar con la evaluación.

## Detección de lecturas atípicas con n8n

VitalWatch guarda cada lectura y envía la frecuencia cardíaca y hasta 30 frecuencias anteriores de la misma paciente a n8n. El flujo valida la entrada, calibra el patrón personal y evalúa la lectura con dos criterios. Usa un modelo no supervisado de dos vecinos más cercanos (k-NN) para medir la similitud local, y la mediana y la desviación absoluta mediana (MAD) para medir la separación respecto al patrón general. Clasifica una lectura como atípica cuando ambos criterios coinciden. Con menos de cuatro lecturas previas informa que necesita más historial. El rombo rojo indica una desviación respecto al patrón personal y sirve para revisar la lectura. Esta demo utiliza datos ficticios.

El último nodo devuelve la clasificación, una explicación, el tamaño de la muestra y, cuando hay historial suficiente, las distancias y los umbrales usados. React utiliza el campo `status` para marcar el punto en la gráfica.

Si ya instalaste una versión anterior del flujo, desactiva su publicación antes de publicar la nueva. Ambas versiones usan la misma ruta de webhook. Puedes renombrar el flujo anterior para identificarlo al importar la nueva versión.

### Arrancar la automatización

1. Desde la carpeta del proyecto, ejecuta `docker compose up -d`.
2. Abre `http://localhost:5678` y configura el usuario local de n8n en el primer arranque. Crea un flujo e importa [vitalwatch-anomalias.json](n8n/vitalwatch-anomalias.json) con **Import from File**. Guarda y pulsa **Publish** para habilitar la URL de producción.
3. Arranca o reinicia React con `npm run dev`. Vite reenvía la solicitud al webhook local. Si n8n está en otra dirección, inicia Vite con `N8N_ORIGIN=http://host:puerto npm run dev`.
4. Desde el perfil **Paciente**, abre **VitalWatch** y registra una frecuencia de **105 lpm** con fecha igual o posterior a la última del historial inicial. Usa, por ejemplo, 120/80 mmHg para completar el formulario. Con los cuatro valores iniciales de la demo debe aparecer **Atípica** junto a la lectura y un rombo rojo en la gráfica.

Si el puerto 5678 ya está ocupado por la instancia donde publicaste el flujo, usa esa instancia y omite Docker Compose. Si quieres una instancia separada, ejecuta `N8N_HOST_PORT=5679 docker compose up -d`, abre `http://localhost:5679` e importa y publica el flujo en esa instancia. Inicia React con `N8N_ORIGIN=http://127.0.0.1:5679 npm run dev`.

Si n8n está apagado o el flujo no está publicado, la lectura se guarda y muestra **Análisis no disponible** con opción de reintentar. La configuración de Compose desactiva el guardado del contenido de las ejecuciones. Si sirves `dist` fuera de Vite, configura el servidor para reenviar `POST /api/vitalwatch/analyze` a `/webhook/vitalwatch-analyze` de n8n.

Puedes comprobar el webhook publicado con estos datos ficticios:

```bash
curl --fail-with-body http://127.0.0.1:5678/webhook/vitalwatch-analyze \
  -H 'Content-Type: application/json' \
  -d '{"pulse":105,"history":[74,79,72,76]}'
```

Se espera una respuesta JSON con `"status":"atypical"`, `"direction":"above"` y los detalles de ambos criterios en `evidence`. El flujo usa la [URL de producción del nodo Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/). Ejecuta `npm test` para verificar el código exportado del nodo de n8n y el contrato del cliente sin levantar Docker.
