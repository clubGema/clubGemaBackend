-- Corrige ciclos de renovación cuya fecha_fin_ciclo < fecha_inicio_ciclo.
-- Fin real = última clase generada (registros_asistencia) desde el inicio del ciclo.
-- Si el ciclo sigue vigente, la inscripción vuelve a ACTIVO.
BEGIN;
CREATE TEMP TABLE fix_ciclos AS
SELECT l.id link_id, l.inscripcion_id, l.fecha_inicio_ciclo,
       (SELECT max(r.fecha) FROM registros_asistencia r
         JOIN inscripciones_deudas_link l2 ON l2.inscripcion_id = r.inscripcion_id AND l2.cuenta_id = l.cuenta_id
        WHERE r.fecha >= l.fecha_inicio_ciclo - 7) AS fin_real
FROM inscripciones_deudas_link l
WHERE l.fecha_fin_ciclo < l.fecha_inicio_ciclo;

SELECT * FROM fix_ciclos ORDER BY link_id;

UPDATE inscripciones_deudas_link l SET fecha_fin_ciclo = f.fin_real
FROM fix_ciclos f WHERE l.id = f.link_id AND f.fin_real IS NOT NULL AND f.fin_real >= f.fecha_inicio_ciclo;

UPDATE inscripciones i SET estado = 'ACTIVO', actualizado_en = now()
FROM fix_ciclos f
JOIN cuentas_por_cobrar c ON c.id = (SELECT cuenta_id FROM inscripciones_deudas_link WHERE id = f.link_id)
WHERE i.id = f.inscripcion_id AND i.estado = 'FINALIZADO' AND c.estado = 'PAGADA'
  AND f.fin_real >= (now() AT TIME ZONE 'America/Lima')::date
RETURNING i.id, i.alumno_id, i.estado;
COMMIT;
