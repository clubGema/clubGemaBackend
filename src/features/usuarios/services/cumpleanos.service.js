import { prisma } from '../../../config/database.config.js';
import { twilioProvider } from '../../../shared/services/twilio.whatsapp.service.js';
import { emailService } from '../../../shared/services/brevo.email.service.js';
import { logger } from '../../../shared/utils/logger.util.js';
import { TWILIO_TEMPLATE_CUMPLEANOS_SID } from '../../../config/secret.config.js';

class CumpleanosService {
  async ejecutarSaludosCumpleanos() {
    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const diaActual = hoy.getDate();

    const cumpleaneros = await prisma.$queryRaw`
      SELECT id, nombres, apellidos, telefono_personal, email 
      FROM usuarios 
      WHERE activo = true 
        AND EXTRACT(MONTH FROM fecha_nacimiento) = ${mesActual} 
        AND EXTRACT(DAY FROM fecha_nacimiento) = ${diaActual}
    `;

    if (!cumpleaneros || cumpleaneros.length === 0) {
      logger.info('[FESTEJERO] Hoy no hay cumpleaños, a descansar.');
      return;
    }

    logger.info(`[FESTEJERO] Encontrados ${cumpleaneros.length} cumpleañeros hoy.`);

    const LIMITE_CONCURRENCIA = 10;
    const resultados = [];

    for (let i = 0; i < cumpleaneros.length; i += LIMITE_CONCURRENCIA) {
      const lote = cumpleaneros.slice(i, i + LIMITE_CONCURRENCIA);

      const promesasLote = lote.map(async (usuario) => {
        let wpEnviado = false;
        let emailEnviado = false;

        // =============================================
        // 📲 WHATSAPP: Plantilla HX... o texto directo
        // =============================================
        if (usuario.telefono_personal) {
          if (TWILIO_TEMPLATE_CUMPLEANOS_SID) {
            // 🚀 PRODUCCIÓN: Usa la plantilla oficial aprobada por Meta
            const variables = { "1": usuario.nombres };
            const wpResultado = await twilioProvider.sendTemplateMessage(
              usuario.telefono_personal,
              TWILIO_TEMPLATE_CUMPLEANOS_SID,
              variables
            );
            wpEnviado = wpResultado.success;
          } else {
            // 🧪 SIN PLANTILLA: Envía el mensaje escrito directamente en el backend
            const mensaje = `¡Hola ${usuario.nombres}! 🎉 De parte de toda la familia de Club Gema queremos desearte un muy ¡Feliz Cumpleaños! 🎂 Que disfrutes mucho tu día.`;
            const wpResultado = await twilioProvider.sendWhatsAppMessage(usuario.telefono_personal, mensaje);
            wpEnviado = wpResultado.success;
          }
        }

        // =============================================
        // 📧 EMAIL: Siempre se intenta enviar (gratis)
        // =============================================
        if (usuario.email) {
          emailEnviado = await emailService.sendBirthdayEmail(usuario.email, usuario.nombres);
        }

        return {
          id: usuario.id,
          nombre: usuario.nombres,
          exito: wpEnviado || emailEnviado,
        };
      });

      const chunkResults = await Promise.allSettled(promesasLote);
      resultados.push(...chunkResults);
    }

    const exitosos = resultados.filter((r) => r.status === 'fulfilled' && r.value.exito).length;
    logger.info(
      `[FESTEJERO] Se enviaron ${exitosos}/${cumpleaneros.length} mensajes de cumpleaños con éxito.`
    );
  }
}

export const cumpleanosService = new CumpleanosService();

