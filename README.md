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
