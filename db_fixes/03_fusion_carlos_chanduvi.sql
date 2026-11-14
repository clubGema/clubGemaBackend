-- Fusiona las dos cuentas de Carlos André Chanduví Muñoz (Pueblo Libre).
--   ID 60  = cuenta con TODO el historial (inscripciones, pagos, asistencias; mismo ID en gema B).
--   ID 404 = alta duplicada SIN historial, pero con DNI, correo, contacto y la contraseña que usa hoy.
-- Resultado: queda solo el ID 60, con los datos personales y el login (usuario + contraseña) del 404.
-- Carlos sigue entrando exactamente igual que antes y ahora ve su historial.
-- El 404 NO se borra: queda desactivado (activo=false) y renombrado, para poder revertir.
BEGIN;

-- Guardas: abortar si el escenario no es el esperado.
DO $$
BEGIN
  IF (SELECT count(*) FROM inscripciones WHERE alumno_id = 404) > 0
     OR (SELECT count(*) FROM cuentas_por_cobrar WHERE alumno_id = 404) > 0 THEN
    RAISE EXCEPTION 'El ID 404 ya tiene historial: revisar antes de fusionar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = 60 AND activo) THEN
    RAISE EXCEPTION 'El ID 60 no existe o no está activo';
  END IF;
END $$;

-- Respaldo de las filas originales (por si hay que revertir).
CREATE TABLE IF NOT EXISTS _respaldo_fusion_carlos AS
  SELECT now() AS respaldado_en, u.*, c.hash_contrasena
  FROM usuarios u LEFT JOIN credenciales_usuario c ON c.usuario_id = u.id
  WHERE u.id IN (60, 404);

-- 1) Liberar en el 404 los valores únicos (usuario y DNI) y desactivarlo.
CREATE TEMP TABLE d404 AS SELECT * FROM usuarios WHERE id = 404;
UPDATE usuarios SET
  username = 'fusionado.404.carlos.chanduvi',
  numero_documento = NULL,
  email = NULL,
  activo = false,
  actualizado_en = now()
WHERE id = 404;

-- 2) Pasar al 60 los datos personales y el usuario de login del 404.
UPDATE usuarios u SET
  username          = d.username,
  numero_documento  = d.numero_documento,
  nombres           = trim(d.nombres),
  apellidos         = trim(d.apellidos),
  email             = d.email,
  telefono_personal = coalesce(d.telefono_personal, u.telefono_personal),
  fecha_nacimiento  = d.fecha_nacimiento,
  genero            = coalesce(d.genero, u.genero),
  actualizado_en    = now()
FROM d404 d
WHERE u.id = 60;

-- 3) Misma contraseña que usa hoy (la del 404).
UPDATE credenciales_usuario c SET hash_contrasena = c4.hash_contrasena, bloqueado = false
FROM credenciales_usuario c4
WHERE c.usuario_id = 60 AND c4.usuario_id = 404;

-- 4) Contacto de emergencia y sesiones.
UPDATE alumnos_contactos SET alumno_id = 60 WHERE alumno_id = 404;
DELETE FROM refresh_tokens WHERE usuario_id = 404;

SELECT id, username, nombres, apellidos, numero_documento, activo,
       (SELECT count(*) FROM inscripciones i WHERE i.alumno_id = u.id) AS inscripciones,
       (SELECT count(*) FROM alumnos_contactos ac WHERE ac.alumno_id = u.id) AS contactos
FROM usuarios u WHERE id IN (60, 404) ORDER BY id;
COMMIT;
