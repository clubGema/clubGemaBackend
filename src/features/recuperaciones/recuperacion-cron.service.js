import { prisma } from '../../config/database.config.js';
import { logger } from '../../shared/utils/logger.util.js';
import { ultimaClaseRegular } from './recuperacion.service.js';

class RecuperacionCronService {
  // Un ticket normal PENDIENTE vence cuando ya pasó el último día de clases
  // del ciclo del alumno (ya no se usan los 30 días desde la falta).
  async ejecutarLimpiezaTickets() {
    const fechaLocalTexto = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const hoy = new Date(`${fechaLocalTexto}T00:00:00Z`);

    const pendientes = await prisma.recuperaciones.findMany({
      where: { estado: 'PENDIENTE', es_por_lesion: false },
      select: { id: true, alumno_id: true },
    });

    const finPorAlumno = new Map();
    const idsVencidos = [];
    for (const t of pendientes) {
      if (!finPorAlumno.has(t.alumno_id)) {
        finPorAlumno.set(t.alumno_id, await ultimaClaseRegular(prisma, t.alumno_id));
      }
      const fin = finPorAlumno.get(t.alumno_id);
      if (fin && fin < hoy) idsVencidos.push(t.id);
    }

    const ticketsActualizados = idsVencidos.length
      ? await prisma.recuperaciones.updateMany({
          where: { id: { in: idsVencidos } },
          data: { estado: 'VENCIDA' },
        })
      : { count: 0 };
    logger.info(`Se marcaron ${ticketsActualizados.count} tickets como vencidos.`);
  }

  // Deshabilitado para que el coordinador pueda marcar al recuperante, incluso días después
  // async ejecutarLimpiezaTicketsProgramados() {
  //   const hoy = new Date();
  //   hoy.setUTCHours(0, 0, 0, 0)
  //   const ticketsActualizados = await prisma.recuperaciones.updateMany({
  //     where: {
  //       estado: 'PROGRAMADA',
  //       fecha_programada: {
  //         lt: hoy,
  //       }
  //     },
  //     data: {
  //       estado: 'COMPLETADA_FALTA',
  //     }
  //   })
  //   logger.info(`Se actualizaron ${ticketsActualizados.count} recuperaciones como COMPLETADA_FALTA.`);
  // }
}

export const recuperacionCronService = new RecuperacionCronService();
