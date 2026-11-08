import { prisma } from '../src/config/database.config.js';

async function restoreFinish() {
  const alumnoId = 793;
  const inscripcion = await prisma.inscripciones.findFirst({
    where: { alumno_id: alumnoId, estado: 'ACTIVO' }
  });

  console.log('Inscripción existente:', inscripcion);

  // Crear o verificar cuenta por cobrar
  const cuentaExistente = await prisma.cuentas_por_cobrar.findFirst({
    where: { alumno_id: alumnoId }
  });

  if (!cuentaExistente) {
    const cuenta = await prisma.cuentas_por_cobrar.create({
      data: {
        alumno_id: alumnoId,
        monto_final: 300,
        estado: 'PAGADO',
        fecha_vencimiento: new Date('2026-11-02T00:00:00Z'),
      }
    });
    console.log('Cuenta creada:', cuenta.id);
  } else {
    console.log('Cuenta existente:', cuentaExistente.id);
  }

  // Verificar registros de asistencia creados
  const asistencias = await prisma.registros_asistencia.findMany({
    where: { inscripcion_id: inscripcion.id },
    orderBy: { fecha: 'asc' }
  });

  console.log('Total asistencias para alumno 793:', asistencias.length);
  for (const a of asistencias) {
    console.log(a.id, a.fecha.toISOString().slice(0, 10), a.estado);
  }

  process.exit(0);
}

restoreFinish().catch(err => {
  console.error(err);
  process.exit(1);
});

