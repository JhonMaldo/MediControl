# Tareas del equipo Nodo 0

**Proyecto:** MediControl + VitalWatch

Este documento describe el alcance y las responsabilidades de cada tarea. El trabajo de cada integrante parte de la rama `main` y se desarrolla en la rama indicada.

## Tarea 1. Predicción de inasistencia a citas médicas

**Responsable:** Melanie Montes García

**Rama:** `tarea/01-prediccion-inasistencia`

Entrenar un modelo de clasificación con TensorFlow a partir del historial de citas en MariaDB. El módulo usará datos como asistencias, cancelaciones, horarios y tiempo de anticipación de la reserva para estimar la probabilidad de inasistencia. Recepción verá el resultado en la agenda para decidir qué citas confirmar primero.

**Responsabilidad de coordinación:** mantener el tablero físico del equipo. Cada post-it identifica la actividad y a su responsable, y se mueve entre **Pendiente**, **En proceso** y **Terminada** conforme avance el trabajo.

## Tarea 2. Búsqueda inteligente en el expediente clínico

**Responsable:** Fabrizio Moreno Apaez

**Rama:** `tarea/02-busqueda-inteligente-expediente`

Permitir que el médico haga preguntas en lenguaje natural sobre un expediente mediante generación aumentada por recuperación (RAG). Un modelo de embeddings recuperará los fragmentos relevantes y un modelo de lenguaje redactará una respuesta basada en ellos. Ambos se ejecutarán localmente con Ollama. Cada respuesta mostrará los registros que la respaldan.

**Responsabilidad técnica:** indexar la información autorizada, integrar la recuperación y la generación, y comprobar que las respuestas correspondan con las fuentes. La recuperación debe limitarse a los datos que el médico tenga permiso de consultar. Los modelos se seleccionarán mediante pruebas de recuperación, calidad de respuesta y rendimiento.

## Tarea 3. Resumen inteligente del expediente clínico

**Responsable:** Daniel Santos Mendoza

**Rama:** `tarea/03-resumen-inteligente-expediente`

Generar un resumen de antecedentes, alergias, medicamentos y consultas previas mediante un modelo de lenguaje ejecutado localmente con Ollama. El médico podrá verificar la información en los registros originales.

**Responsabilidad técnica:** integrar el modelo con los datos autorizados del expediente y comprobar que los resúmenes reflejen la información registrada. El modelo se seleccionará mediante pruebas de calidad de los resúmenes y rendimiento.

## Tarea 4. Pronóstico de tendencias de signos vitales

**Responsable:** Villafan Alonso Gerald

**Rama:** `tarea/04-pronostico-signos-vitales`

Estimar la tendencia de las próximas mediciones a partir del historial individual de frecuencia cardíaca, presión arterial, temperatura y saturación de oxígeno. Se evaluarán modelos locales de series de tiempo como ARIMA o Prophet. VitalWatch mostrará las proyecciones junto a las lecturas registradas y con un margen de incertidumbre para apoyar el seguimiento médico.

**Responsabilidad técnica:** preparar las series históricas, entrenar y evaluar el modelo, e integrar las proyecciones en las gráficas. Se comprobará que los pronósticos sean coherentes con el historial y se compararán la precisión y el rendimiento de los modelos.

## Tarea 5. Por definir

Pendiente de recibir el alcance, el nombre del responsable y la rama correspondiente.
