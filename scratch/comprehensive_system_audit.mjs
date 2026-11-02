import { prisma } from '../src/config/database.config.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

async function runAudit() {
  console.log('====================================================');
  console.log('   AUDITORÍA INTEGRAL DE CONSISTENCIA Y CRUCES');
  console.log('====================================================\n');

  const hallazgos = [];

  // Helper para registrar hallazgos
  function registrarHallazgo(categoria, severidad, titulo, detalle) {
    hallazgos.push({ categoria, severidad, titulo, detalle });
    console.log(`[${severidad}] [${categoria}] ${titulo}`);
  }

  // ---------------------------------------------------------------
  // 1. AUDITORÍA DE DATOS HUÉRFANOS Y RELACIONES EN BD
  // ---------------------------------------------------------------
  console.log('--- 1. Verificando integridad referencial y huérfanos ---');

  // A. Asistencias huérfanas (sin inscripción)
  const asistenciasHuerfanas = await prisma.$queryRawUnsafe(`
    SELECT ra.id, ra.inscripcion_id 
    FROM registros_asistencia ra
    LEFT JOIN inscripciones i ON ra.inscripcion_id = i.id
    WHERE i.id IS NULL;
  `);
  if (asistenciasHuerfanas.length > 0) {
    registrarHallazgo('INTEGRIDAD_BD', 'ALTA', 'Asistencias huérfanas encontradas', 
      `Existen ${asistenciasHuerfanas.length} registros_asistencia sin inscripción padre válida.`);
  }

  // B. Recuperaciones con horario o alumno inexistente
  const recuHuerfanas = await prisma.$queryRawUnsafe(`
    SELECT r.id, r.alumno_id, r.horario_destino_id
    FROM recuperaciones r
    LEFT JOIN alumnos a ON r.alumno_id = a.usuario_id
    LEFT JOIN horarios_clases h ON r.horario_destino_id = h.id
    WHERE a.usuario_id IS NULL OR (r.horario_destino_id IS NOT NULL AND h.id IS NULL);
  `);
  if (recuHuerfanas.length > 0) {
    registrarHallazgo('INTEGRIDAD_BD', 'ALTA', 'Recuperaciones huérfanas', 
      `Existen ${recuHuerfanas.length} recuperaciones con alumno_id o horario_destino_id inexistente.`);
  }

  // C. Cuentas por cobrar huérfanas
  const cuentasHuerfanas = await prisma.$queryRawUnsafe(`
    SELECT c.id, c.alumno_id 
    FROM cuentas_por_cobrar c
    LEFT JOIN alumnos a ON c.alumno_id = a.usuario_id
    WHERE a.usuario_id IS NULL;
  `);
  if (cuentasHuerfanas.length > 0) {
    registrarHallazgo('INTEGRIDAD_BD', 'ALTA', 'Cuentas por cobrar huérfanas', 
      `Existen ${cuentasHuerfanas.length} cuentas_por_cobrar sin alumno existente.`);
  }

  // ---------------------------------------------------------------
  // 2. AUDITORÍA DE AFOROS Y SOBRECUPO (CAPACIDAD MÁXIMA)
  // ---------------------------------------------------------------
  console.log('\n--- 2. Verificando aforos y capacidades máximas ---');

  // A. Inscritos fijos activos que superen la capacidad máxima del horario
  const sobrecuposFijos = await prisma.$queryRawUnsafe(`
    SELECT h.id AS horario_id, h.dia_semana, h.capacidad_max, s.nombre AS sede, COUNT(i.id) AS total_inscritos
    FROM horarios_clases h
    JOIN canchas c ON h.cancha_id = c.id
    JOIN sedes s ON c.sede_id = s.id
    JOIN inscripciones i ON i.horario_id = h.id
    WHERE i.estado = 'ACTIVO'
    GROUP BY h.id, h.dia_semana, h.capacidad_max, s.nombre
    HAVING COUNT(i.id) > h.capacidad_max;
  `);
  if (sobrecuposFijos.length > 0) {
    registrarHallazgo('AFORO', 'ALTA', 'Horarios con sobrecupo de inscritos fijos', 
      sobrecuposFijos);
  }

  // B. Ocupación en fechas futuras combinando inscritos + recuperaciones programadas
  const sobrecuposConRecuperacion = await prisma.$queryRawUnsafe(`
    WITH fijos AS (
      SELECT horario_id, COUNT(*) as cant_fijos
      FROM inscripciones
      WHERE estado = 'ACTIVO'
      GROUP BY horario_id
    ),
    recus AS (
      SELECT horario_destino_id, fecha_programada, COUNT(*) as cant_recu
      FROM recuperaciones
      WHERE estado = 'PROGRAMADA' AND fecha_programada >= CURRENT_DATE
      GROUP BY horario_destino_id, fecha_programada
    )
    SELECT 
      h.id AS horario_id,
      r.fecha_programada,
      h.capacidad_max,
      COALESCE(f.cant_fijos, 0) AS fijos,
      r.cant_recu,
      (COALESCE(f.cant_fijos, 0) + r.cant_recu) AS ocupacion_total
    FROM recus r
    JOIN horarios_clases h ON r.horario_destino_id = h.id
    LEFT JOIN fijos f ON f.horario_id = h.id
    WHERE (COALESCE(f.cant_fijos, 0) + r.cant_recu) > h.capacidad_max;
  `);
  if (sobrecuposConRecuperacion.length > 0) {
    registrarHallazgo('AFORO', 'CRÍTICA', 'Sobrecupo en fecha específica con recuperaciones', 
      sobrecuposConRecuperacion);
  }

  // ---------------------------------------------------------------
  // 3. AUDITORÍA DE CRUCES DE HORARIOS EN EL MISMO ALUMNO
  // ---------------------------------------------------------------
  console.log('\n--- 3. Verificando cruces de horario para el mismo alumno ---');

  // A. Alumno con 2 inscripciones activas el mismo día a la misma hora
  const crucesInscripciones = await prisma.$queryRawUnsafe(`
    SELECT 
      i1.alumno_id,
      i1.id AS inscripcion_1,
      i2.id AS inscripcion_2,
      h1.dia_semana,
      h1.hora_inicio,
      h1.hora_fin
    FROM inscripciones i1
    JOIN inscripciones i2 ON i1.alumno_id = i2.alumno_id AND i1.id < i2.id
    JOIN horarios_clases h1 ON i1.horario_id = h1.id
    JOIN horarios_clases h2 ON i2.horario_id = h2.id
    WHERE i1.estado = 'ACTIVO' AND i2.estado = 'ACTIVO'
      AND h1.dia_semana = h2.dia_semana
      AND (
        (h1.hora_inicio <= h2.hora_inicio AND h1.hora_fin > h2.hora_inicio) OR
        (h2.hora_inicio <= h1.hora_inicio AND h2.hora_fin > h1.hora_inicio)
      );
  `);
  if (crucesInscripciones.length > 0) {
    registrarHallazgo('CRUCE_HORARIOS', 'MEDIA', 'Alumnos con doble inscripción en el mismo horario', 
      crucesInscripciones);
  }

  // B. Cruce entre clase regular y recuperación programada el mismo día a la misma hora
  const crucesRegularRecu = await prisma.$queryRawUnsafe(`
    SELECT 
      r.alumno_id,
      r.id AS recuperacion_id,
      r.fecha_programada,
      hr.hora_inicio AS recu_inicio,
      hr.hora_fin AS recu_fin,
      ra.id AS clase_regular_id,
      hra.hora_inicio AS regular_inicio,
      hra.hora_fin AS regular_fin
    FROM recuperaciones r
    JOIN horarios_clases hr ON r.horario_destino_id = hr.id
    JOIN inscripciones i ON i.alumno_id = r.alumno_id AND i.estado = 'ACTIVO'
    JOIN registros_asistencia ra ON ra.inscripcion_id = i.id AND ra.fecha = r.fecha_programada
    JOIN horarios_clases hra ON i.horario_id = hra.id
    WHERE r.estado = 'PROGRAMADA'
      AND ra.estado = 'PROGRAMADA'
      AND (
        (hr.hora_inicio <= hra.hora_inicio AND hr.hora_fin > hra.hora_inicio) OR
        (hra.hora_inicio <= hr.hora_inicio AND hra.hora_fin > hr.hora_inicio)
      );
  `);
  if (crucesRegularRecu.length > 0) {
    registrarHallazgo('CRUCE_HORARIOS', 'ALTA', 'Recuperación programada a la misma hora de una clase regular', 
      crucesRegularRecu);
  }

  // C. Cruce entre dos recuperaciones del mismo alumno el mismo día y hora
  const crucesRecuConRecu = await prisma.$queryRawUnsafe(`
    SELECT 
      r1.alumno_id,
      r1.id AS recu_1,
      r2.id AS recu_2,
      r1.fecha_programada,
      h1.hora_inicio,
      h1.hora_fin
    FROM recuperaciones r1
    JOIN recuperaciones r2 ON r1.alumno_id = r2.alumno_id AND r1.id < r2.id
    JOIN horarios_clases h1 ON r1.horario_destino_id = h1.id
    JOIN horarios_clases h2 ON r2.horario_destino_id = h2.id
    WHERE r1.estado = 'PROGRAMADA' AND r2.estado = 'PROGRAMADA'
      AND r1.fecha_programada = r2.fecha_programada
      AND (
        (h1.hora_inicio <= h2.hora_inicio AND h1.hora_fin > h2.hora_inicio) OR
        (h2.hora_inicio <= h1.hora_inicio AND h2.hora_fin > h1.hora_inicio)
      );
  `);
  if (crucesRecuConRecu.length > 0) {
    registrarHallazgo('CRUCE_HORARIOS', 'ALTA', 'Doble recuperación agendada a la misma fecha y hora', 
      crucesRecuConRecu);
  }

  // ---------------------------------------------------------------
  // 4. AUDITORÍA DE RECUPERACIONES FUERA DE FECHA LÍMITE DE CICLO
  // ---------------------------------------------------------------
  console.log('\n--- 4. Verificando recuperaciones fuera de ciclo ---');

  const recusFueraDeCiclo = await prisma.$queryRawUnsafe(`
    WITH UltimaClase AS (
      SELECT i.alumno_id, MAX(ra.fecha) as fin_ciclo
      FROM inscripciones i
      JOIN registros_asistencia ra ON ra.inscripcion_id = i.id
      WHERE i.estado = 'ACTIVO' AND ra.estado = 'PROGRAMADA'
      GROUP BY i.alumno_id
    )
    SELECT 
      r.id AS recuperacion_id,
      r.alumno_id,
      r.fecha_programada,
      u.fin_ciclo
    FROM recuperaciones r
    JOIN UltimaClase u ON r.alumno_id = u.alumno_id
    WHERE r.estado = 'PROGRAMADA' AND r.fecha_programada > u.fin_ciclo;
  `);
  if (recusFueraDeCiclo.length > 0) {
    registrarHallazgo('REGLA_NEGOCIO', 'MEDIA', 'Recuperaciones programadas después del fin de ciclo', 
      recusFueraDeCiclo);
  }

  // ---------------------------------------------------------------
  // 5. AUDITORÍA DE CUOTAS DE RECUPERACIÓN EXCEDIDAS
  // ---------------------------------------------------------------
  console.log('\n--- 5. Verificando cuotas de recuperación excedidas ---');

  const cuotasExcedidas = await prisma.$queryRawUnsafe(`
    WITH Frecuencia AS (
      SELECT alumno_id, COUNT(*) as dias_semana, MIN(fecha_inscripcion_original) as inicio
      FROM inscripciones
      WHERE estado = 'ACTIVO'
      GROUP BY alumno_id
    ),
    Tickets AS (
      SELECT alumno_id, COUNT(*) as total_tickets
      FROM recuperaciones
      WHERE es_por_lesion = false
      GROUP BY alumno_id
    )
    SELECT 
      f.alumno_id,
      f.dias_semana,
      COALESCE(t.total_tickets, 0) as total_recuperaciones
    FROM Frecuencia f
    JOIN Tickets t ON f.alumno_id = t.alumno_id
    WHERE (f.dias_semana = 1 AND t.total_tickets > 4) -- advertencia si supera meses
  `);
  if (cuotasExcedidas.length > 0) {
    registrarHallazgo('REGLA_NEGOCIO', 'BAJA', 'Alumnos con alto volumen de recuperaciones respecto a frecuencia', 
      cuotasExcedidas);
  }

  // ---------------------------------------------------------------
  // 6. AUDITORÍA DE ESTADOS FINANCIEROS Y SALDOS
  // ---------------------------------------------------------------
  console.log('\n--- 6. Verificando coherencia financiera de cuentas y pagos ---');

  // A. Cuentas en estado PAGADO pero cuya suma de pagos aprobados no cubra el monto final
  const cuentasPagadasSinFondos = await prisma.$queryRawUnsafe(`
    SELECT 
      c.id, c.alumno_id, c.monto_final, c.estado,
      COALESCE(SUM(p.monto_pagado), 0) AS total_pagado
    FROM cuentas_por_cobrar c
    LEFT JOIN pagos p ON p.cuenta_id = c.id AND p.estado_validacion = 'APROBADO'
    WHERE c.estado = 'PAGADO' AND c.monto_final > 0
    GROUP BY c.id, c.alumno_id, c.monto_final, c.estado
    HAVING COALESCE(SUM(p.monto_pagado), 0) < c.monto_final;
  `);
  if (cuentasPagadasSinFondos.length > 0) {
    registrarHallazgo('FINANZAS', 'MEDIA', 'Cuentas marcadas como PAGADO sin pagos suficientes registrados', 
      cuentasPagadasSinFondos);
  }

  // B. Pagos aprobados huérfanos o con montos negativos/cero
  const pagosInvalidos = await prisma.$queryRawUnsafe(`
    SELECT id, cuenta_id, monto_pagado, estado_validacion 
    FROM pagos 
    WHERE monto_pagado <= 0 OR cuenta_id IS NULL;
  `);
  if (pagosInvalidos.length > 0) {
    registrarHallazgo('FINANZAS', 'ALTA', 'Pagos con monto cero o huérfanos', pagosInvalidos);
  }

  // ---------------------------------------------------------------
  // 7. AUDITORÍA DE FERIADOS Y CLASES PROGRAMADAS EN FERIADOS
  // ---------------------------------------------------------------
  console.log('\n--- 7. Verificando feriados vs clases programadas ---');

  const clasesEnFeriados = await prisma.$queryRawUnsafe(`
    SELECT ra.id, ra.fecha, ra.estado, f.descripcion AS feriado_descripcion
    FROM registros_asistencia ra
    JOIN feriados f ON ra.fecha = f.fecha
    WHERE ra.estado = 'PROGRAMADA' AND f.activo = true;
  `);
  if (clasesEnFeriados.length > 0) {
    registrarHallazgo('CALENDARIO', 'MEDIA', 'Clases regulares programadas en días feriados activos', 
      clasesEnFeriados);
  }

  // ---------------------------------------------------------------
  // 8. AUDITORÍA DE LESIONES Y CONGELAMIENTOS
  // ---------------------------------------------------------------
  console.log('\n--- 8. Verificando consistencia de lesiones y congelamientos ---');

  const congelamientosInconsistentes = await prisma.$queryRawUnsafe(`
    SELECT id, inscripcion_id, solicitud_lesion_id, fecha_inicio, fecha_fin, estado
    FROM congelamientos
    WHERE fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio;
  `);
  if (congelamientosInconsistentes.length > 0) {
    registrarHallazgo('LESIONES', 'ALTA', 'Congelamientos con fecha_fin anterior a fecha_inicio', 
      congelamientosInconsistentes);
  }

  // ---------------------------------------------------------------
  // 9. RESUMEN FINAL
  // ---------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`TOTAL HALLAZGOS ENCONTRADOS: ${hallazgos.length}`);
  console.log('====================================================\n');

  return hallazgos;
}

runAudit()
  .then((results) => {
    import('fs').then(fs => {
      fs.writeFileSync('d:/AcademiaGema/academiaGemaBackend/scratch/audit_report.json', JSON.stringify(results, null, 2), 'utf8');
      console.log('Informe guardado en scratch/audit_report.json');
      process.exit(0);
    });
  })
  .catch((err) => {
    console.error('Error durante la auditoría:', err);
    process.exit(1);
  });
