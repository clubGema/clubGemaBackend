import { prisma } from '../src/config/database.config.js';

async function restoreEnrollment() {
  const alumnoId = 793;
  const horarioId = 49; // ATE, Lunes 19:00 - 20:30 BÁSICO

  console.log('Restaurando matrícula para alumno 793...');

  // 1. Crear inscripción activa
  const inscripcion = await prisma.inscripciones.create({
    data: {
      alumno_id: alumnoId,
      horario_id: horarioId,
      fecha_inscripcion_original: new Date('2026-11-02T00:00:00Z'),
      estado: 'ACTIVO',
      tipo_inscripcion: 'REGULAR',
    }
  });

  console.log('Inscripción creada con id:', inscripcion.id);

  // 2. Crear las 8 clases consecutivas para Lunes
  const fechas = [
    '2026-11-02',
    '2026-11-09',
    '2026-11-16',
    '2026-11-23',
    '2026-11-30',
    '2026-12-07',
    '2026-12-14',
    '2026-12-21',
  ];

  for (const fechaStr of fechas) {
    await prisma.registros_asistencia.create({
      data: {
        inscripcion_id: inscripcion.id,
        fecha: new Date(`${fechaStr}T00:00:00Z`),
        estado: 'PROGRAMADA',
        comentario: 'Generado auto (8 clases adelantadas) - Restaurado',
      }
    });
  }

  // 3. Crear cuenta por cobrar en PAGADO para que no esté bloqueado por deuda
  const cuenta = await prisma.cuentas_por_cobrar.create({
    data: {
      alumno_id: alumnoId,
      monto_original: 300,
      monto_final: 300,
      estado: 'PAGADO',
      fecha_vencimiento: new Date('2026-11-02T00:00:00Z'),
    }
  });

  console.log('Cuenta creada con id:', cuenta.id);
  console.log('¡Matrícula y 8 clases restauradas exitosamente para alumno 793!');
  process.exit(0);
}

restoreEnrollment().catch(err => {
  console.error('Error restaurando:', err);
  process.exit(1);
});
