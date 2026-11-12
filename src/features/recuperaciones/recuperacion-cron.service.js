import { prisma } from '../../config/database.config.js';
import { logger } from '../../shared/utils/logger.util.js';
import { ultimaClaseRegular } from './recuperacion.service.js';

class RecuperacionCronService {
  // Un ticket normal PENDIENTE vence cuando ya pasó su tiempo de tolerancia
  // (Tolerancia 30 días más a partir de su ultima clase).
  async ejecutarLimpiezaTickets() {
    const fechaLocalTexto = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const hoy = new Date(`${fechaLocalTexto}T00:00:00Z`);

    const pendientes = await prisma.recuperaciones.findMany({
      where: { estado: 'PENDIENTE', es_por_lesion: false },
      select: { id: true, alumno_id: true, fecha_falta: true },
    });

    const idsVencidos = [];
    for (const t of pendientes) {
      const fechaFalta = t.fecha_falta;
      if (fechaFalta) {
        const finConTolerancia = new Date(fechaFalta);
        finConTolerancia.setUTCDate(finConTolerancia.getUTCDate() + 30);
        if (finConTolerancia < hoy) idsVencidos.push(t.id);
      }
    }

    const ticketsActualizados = idsVencidos.length
      ? await prisma.recuperaciones.updateMany({
        where: { id: { in: idsVencidos } },
        data: { estado: 'VENCIDA' },
      })
      : { count: 0 };
    logger.info(`Se marcaron ${ticketsActualizados.count} tickets como vencidos.`);
  }
}

export const recuperacionCronService = new RecuperacionCronService();
