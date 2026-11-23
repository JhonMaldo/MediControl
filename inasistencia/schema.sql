CREATE TABLE citas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paciente_id BIGINT UNSIGNED NOT NULL,
  paciente VARCHAR(120) NOT NULL,
  reservada_en DATETIME NOT NULL,
  programada_en DATETIME NOT NULL,
  estado ENUM('programada', 'asistio', 'inasistencia', 'cancelada') NOT NULL,
  confirmacion ENUM('Pendiente', 'Confirmada', 'Sin respuesta') NOT NULL DEFAULT 'Pendiente',
  resuelta_en DATETIME,
  INDEX agenda (estado, programada_en),
  INDEX historial (paciente_id, resuelta_en),
  CHECK (reservada_en <= programada_en),
  CHECK ((estado = 'programada' AND resuelta_en IS NULL) OR
         (estado <> 'programada' AND resuelta_en IS NOT NULL AND resuelta_en >= reservada_en))
);
