-- Miguel Salomon De la Cruz (alumno 1037): cuenta 3289 duplicada del ciclo oct (ya pagado en cuenta 3291).
BEGIN;
UPDATE cuentas_por_cobrar SET estado='ANULADA', actualizado_en=now(),
  detalle_adicional = detalle_adicional || ' | ANULADA: duplicada de cuenta 3291 (fix 2026-11-13)'
WHERE id=3289 AND estado='PENDIENTE' AND NOT EXISTS (SELECT 1 FROM pagos WHERE cuenta_id=3289)
RETURNING id, estado;
UPDATE inscripciones SET estado='CANCELADO', actualizado_en=now()
WHERE id IN (6195,6196) AND estado='POR_VALIDAR' RETURNING id, estado;
COMMIT;
