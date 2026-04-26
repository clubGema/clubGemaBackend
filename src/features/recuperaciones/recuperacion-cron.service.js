import { prisma } from '../../config/database.config.js';
import { logger } from '../../shared/utils/logger.util.js';

class RecuperacionCronService {
  async ejecutarLimpiezaTickets() {
    const treintaDiasAntes = new Date();
    treintaDiasAntes.setUTCDate(treintaDiasAntes.getUTCDate() - 30)

    const ticketsActualizados = await prisma.recuperaciones.updateMany({
      where: {
        estado: 'PENDIENTE',
        es_por_lesion: false,
        fecha_falta: {
          lt: treintaDiasAntes,
        }
      },
      data: { estado: 'VENCIDA' },
    })
    logger.info(`Se marcaron ${ticketsActualizados.count} tickets como vencidos.`);
  }

  async ejecutarLimpiezaTicketsProgramados() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0)
    const ticketsActualizados = await prisma.recuperaciones.updateMany({
      where: {
        estado: 'PROGRAMADA',
        fecha_programada: {
          lt: hoy,
        }
      },
      data: {
        estado: 'COMPLETADA_FALTA',
      }
    })
    logger.info(`Se actualizaron ${ticketsActualizados.count} recuperaciones como COMPLETADA_FALTA.`);
  }
}

export const recuperacionCronService = new RecuperacionCronService();
