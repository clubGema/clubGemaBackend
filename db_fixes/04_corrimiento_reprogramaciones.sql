-- Reprogramaciones masivas anteriores al fix 9060086 (07/11/2026) crearon la
-- reposición al final del ciclo pero NO corrieron fecha_fin_ciclo del link.
-- Corrige solo inscripciones ACTIVO cuyo ciclo vigente (link más reciente)
-- termina antes de su reposición pendiente.
BEGIN;

CREATE TABLE IF NOT EXISTS _respaldo_corrimiento_repro AS
SELECT l.*, now() AS respaldado_en FROM inscripciones_deudas_link l WHERE false;

WITH ultimo AS (
  SELECT DISTINCT ON (l.inscripcion_id) l.*
  FROM inscripciones_deudas_link l
  JOIN inscripciones i ON i.id = l.inscripcion_id AND i.estado = 'ACTIVO'
  WHERE l.fecha_inicio_ciclo IS NOT NULL
  ORDER BY l.inscripcion_id, l.creado_en DESC
), objetivo AS (
  SELECT u.id AS link_id, max(a.fecha) AS nuevo_fin
  FROM ultimo u
  JOIN registros_asistencia a ON a.inscripcion_id = u.inscripcion_id
   AND a.reprogramacion_clase_id IS NOT NULL
   AND a.estado = 'PENDIENTE'
   AND a.fecha >= u.fecha_inicio_ciclo
  JOIN reprogramaciones_clases r ON r.id = a.reprogramacion_clase_id AND r.estado = 'ACTIVO'
  GROUP BY u.id, u.fecha_fin_ciclo
  HAVING max(a.fecha) > u.fecha_fin_ciclo
 ), destino AS (
  -- Las otras inscripciones del mismo paquete (mismo inicio de ciclo) vencen
  -- juntas, así que también se les corre la fecha de corte.
  SELECT DISTINCT ON (u2.id) u2.id AS link_id, o.nuevo_fin
  FROM objetivo o
  JOIN ultimo u ON u.id = o.link_id
  JOIN inscripciones i ON i.id = u.inscripcion_id
  JOIN inscripciones i2 ON i2.id = u.inscripcion_id
    OR (i.id_grupo_transaccion IS NOT NULL AND i2.id_grupo_transaccion = i.id_grupo_transaccion)
  JOIN ultimo u2 ON u2.inscripcion_id = i2.id AND u2.fecha_inicio_ciclo = u.fecha_inicio_ciclo
  WHERE u2.fecha_fin_ciclo < o.nuevo_fin
  ORDER BY u2.id, o.nuevo_fin DESC
), resp AS (
  INSERT INTO _respaldo_corrimiento_repro
  SELECT l.*, now() FROM inscripciones_deudas_link l JOIN destino o ON o.link_id = l.id
)
UPDATE inscripciones_deudas_link l
SET fecha_fin_ciclo = o.nuevo_fin
FROM destino o WHERE o.link_id = l.id
RETURNING l.id, l.inscripcion_id, l.fecha_inicio_ciclo, l.fecha_fin_ciclo;

COMMIT;
