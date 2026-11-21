-- Historial de signos vitales para el pronóstico de tendencias.
-- Sin CHECK de rangos a propósito: los errores de captura se guardan y la
-- limpieza del módulo los descarta. es_atipica la marca el módulo de lecturas
-- atípicas (Jonathan); este módulo solo la lee.
CREATE TABLE signos_vitales (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paciente_id BIGINT UNSIGNED NOT NULL,
  paciente VARCHAR(120) NOT NULL,
  medido_en DATETIME NOT NULL,
  frecuencia_cardiaca SMALLINT NULL,
  presion_sistolica SMALLINT NULL,
  presion_diastolica SMALLINT NULL,
  temperatura DECIMAL(4,1) NULL,
  saturacion_oxigeno DECIMAL(4,1) NULL,
  origen ENUM('paciente','enfermeria') NOT NULL,
  es_atipica BOOLEAN NOT NULL DEFAULT FALSE,
  INDEX historial (paciente_id, medido_en)
);
