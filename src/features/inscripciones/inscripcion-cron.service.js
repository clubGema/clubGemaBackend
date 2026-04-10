import { prisma } from '../../config/database.config.js';
import { logger } from '../../shared/utils/logger.util.js';
import { notificacionesService } from '../notificaciones/notificaciones.service.js';
import { twilioProvider } from '../../shared/services/twilio.whatsapp.service.js';
import { emailService } from '../../shared/services/brevo.email.service.js';

/// 🔥 IMPORTAMOS DAYJS Y CONFIGURAMOS LIMA 🔥
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ_LIMA = 'America/Lima';

class InscripcionCronService {
  async limpiarReservasZombies() {
    const param = await prisma.parametros_sistema.findUnique({
      where: { clave: 'TIEMPO_LIMITE_RESERVA_MIN' },
    });
    const minutosLimite = param ? Number.parseInt(param.valor) : 20;
    const horaCorte = new Date(Date.now() - minutosLimite * 60 * 1000);

    const zombies = await prisma.inscripciones.findMany({
      where: {
        estado: 'PENDIENTE_PAGO',
        // ✅ AJUSTE 1: Usamos 'creado_en' para detectar el momento real del registro
        // Antes: fecha_inscripcion (fallaba en upgrades porque viajaba al pasado)
        creado_en: { lt: horaCorte },
      },
    });

    if (zombies.length === 0) return;

    for (const zombie of zombies) {
      try {
        await prisma.$transaction(async (tx) => {
          const deuda = await tx.cuentas_por_cobrar.findFirst({
            where: {
              alumno_id: zombie.alumno_id,
              estado: 'PENDIENTE',
              // ✅ AJUSTE 2: El nexo temporal ahora es con el momento de creación
              // Antes: zombie.fecha_inscripcion (en upgrades no coincidía con la deuda nueva)
              creado_en: {
                gte: new Date(zombie.creado_en.getTime() - 40000),
                lte: new Date(zombie.creado_en.getTime() + 40000),
              },
            },
            include: { descuentos_aplicados: true },
          });

          if (deuda) {
            await tx.descuentos_aplicados.deleteMany({
              where: { cuenta_id: deuda.id },
            });
            if (deuda.descuentos_aplicados.length > 0) {
              for (const desc of deuda.descuentos_aplicados) {
                await tx.beneficios_pendientes.updateMany({
                  where: {
                    alumno_id: zombie.alumno_id,
                    tipo_beneficio_id: desc.tipo_beneficio_id,
                    usado: true,
                  },
                  data: { usado: false },
                });
              }
            }

            await tx.pagos.deleteMany({
              where: { cuenta_id: deuda.id },
            });
            await tx.cuentas_por_cobrar.delete({
              where: { id: deuda.id },
            });
          }

          await tx.inscripciones.delete({
            where: { id: zombie.id },
          });

          await notificacionesService.crear({
            alumnoId: zombie.alumno_id,
            titulo: '🎯 Reserva Zombie Eliminada',
            mensaje: `El sistema eliminó una inscripción pendiente de pago por exceder los ${minutosLimite} minutos.`,
            tipo: 'WARNING',
            categoria: 'SISTEMA',
          });
        });
        logger.info(`[FRANCOTIRADOR] Zombie ${zombie.id} y su deuda eliminados correctamente.`);
      } catch (error) {
        logger.error(`[ERROR] Falló limpieza de zombie ${zombie.id}:`, error.message);
      }
    }
  }

  async gestionarVencimientos() {
    // 🔥 CAMBIO AQUÍ: Obtenemos "hoy" anclado al inicio del día en la hora de Lima
    const hoyLima = dayjs().tz(TZ_LIMA).startOf('day');

    // 1. Obtenemos los días de gracia del sistema
    const paramTolerancia = await prisma.parametros_sistema.findUnique({
      where: { clave: 'DIAS_TOLERANCIA_VENCIMIENTO' },
    });
    const diasGracia = paramTolerancia ? Number.parseInt(paramTolerancia.valor) : 5;

    // 2. 🔥 EL FILTRO MAESTRO: Tráeme a CUALQUIERA que deba plata (estado: PENDIENTE)
    // Sin importar de cuándo es la deuda. Si tiene deuda, El Verdugo lo investiga.
    const rebeldes = await prisma.cuentas_por_cobrar.findMany({
      where: { estado: 'PENDIENTE' },
      select: { alumno_id: true },
      distinct: ['alumno_id'], // No queremos ejecutar al mismo alumno dos veces
    });

    if (rebeldes.length === 0) return; // Si nadie debe plata, El Verdugo sigue durmiendo

    let totalFinalizados = 0;
    let totalPenRecu = 0;

    // 3. Iteramos SOLO sobre los alumnos que tienen cuentas pendientes
    for (const { alumno_id } of rebeldes) {
      // Buscamos su FECHA MADRE (la inscripción activa más antigua)
      const inscripcionMadre = await prisma.inscripciones.findFirst({
        where: { alumno_id: alumno_id, estado: 'ACTIVO' },
        orderBy: { fecha_inscripcion: 'asc' },
      });

      // Si no tiene inscripciones activas, lo ignoramos
      if (!inscripcionMadre) continue;

      // 4. LA REGLA DE ORO: Fecha Madre + 30 días del ciclo normal + Días de Tolerancia
      // 🔥 CAMBIO AQUÍ: Calculamos la fecha límite y la anclamos al inicio de su día en Lima
      const fechaLimiteMuerte = dayjs(inscripcionMadre.fecha_inscripcion)
        .tz(TZ_LIMA)
        .add(30 + diasGracia, 'day')
        .startOf('day');

      // Si la fecha límite aún no llega (está en el futuro), se salva por hoy
      // 🔥 CAMBIO AQUÍ: Comparamos usando isAfter de dayjs
      if (fechaLimiteMuerte.isAfter(hoyLima)) {
        continue;
      }

      // 5. SI LLEGÓ HASTA AQUÍ: Ya pasó su fecha límite y no ha pagado.
      // Buscamos el perdón (Recuperaciones pendientes o programadas por lesión, etc.)
      const tieneRecuperacionesPendientes = await prisma.recuperaciones.findFirst({
        where: {
          alumno_id: alumno_id,
          estado: { in: ['PENDIENTE', 'PROGRAMADA'] },
        },
      });

      const nuevoEstado = tieneRecuperacionesPendientes ? 'PEN-RECU' : 'FINALIZADO';

      if (nuevoEstado === 'PEN-RECU') {
        totalPenRecu++;
      } else {
        totalFinalizados++;
      }

      // 6. La Ejecución: Cambiamos estados en una transacción segura
      await prisma.$transaction([
        // Matamos TODAS sus inscripciones activas mandándolas al estado que le tocó
        prisma.inscripciones.updateMany({
          where: { alumno_id: alumno_id, estado: 'ACTIVO' },
          // 🔥 CAMBIO AQUÍ: Convertimos de nuevo a Date nativo para Prisma
          data: { estado: nuevoEstado, actualizado_en: dayjs().toDate() },
        }),
        // 🔥 CORRECCIÓN DE NEGOCIO: La deuda pasa a ANULADA porque nunca consumió el mes
        prisma.cuentas_por_cobrar.updateMany({
          where: { alumno_id: alumno_id, estado: 'PENDIENTE' },
          data: { estado: 'ANULADA', actualizado_en: dayjs().toDate() },
        }),
        // 🔥 PENALIDAD: Pierde su estatus de alumno antiguo (Se le marca como "Nuevo" en su historial)
        prisma.alumnos.update({
          where: { usuario_id: alumno_id },
          data: { historial: 'Nuevo' },
        }),
        // 🔔 Notificación específica para la alumna
        prisma.notificaciones.create({
          data: {
            alumno_id: alumno_id,
            titulo: '⚠️ Ciclo Finalizado',
            mensaje: `Tu inscripción pasó a ${nuevoEstado} por falta de pago. Tu deuda pendiente fue anulada, pero perdiste tus beneficios de alumno fundador.`,
            tipo: 'DANGER',
            categoria: 'SISTEMA',
          },
        }),
      ]);
    }

    // Reporte en consola
    if (totalFinalizados > 0 || totalPenRecu > 0) {
      logger.info(
        `[VERDUGO] Ejecución completada. Alumnos a FINALIZADO: ${totalFinalizados} | Alumnos al Purgatorio (PEN-RECU): ${totalPenRecu}.`
      );
    }
  }

  async cambiarEstado() {
    const dia0 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const inscFinalizadas = await prisma.inscripciones.updateMany({
      where: {
        estado: 'PEN-RECU',
        fecha_inscripcion_original: {
          lte: dia0,
        },
        alumnos: {
          recuperaciones: {
            none: {
              es_por_lesion: true,
              estado: { in: ['PENDIENTE', 'PROGRAMADA'] },
            },
          },
        },
      },
      data: {
        estado: 'FINALIZADO',
      },
    });

    if (inscFinalizadas.count > 0) {
      logger.info(
        `Se cambiaron ${inscFinalizadas.count} inscripciones pendientes por recuperación a finalizados.`
      );
    }
  }
  // =================================================================
  // 🗡️ EL LIQUIDADOR DE PAGOS PARCIALES (Motor Completo)
  // =================================================================
  async liquidarMorososParciales() {
    // 🔥 CAMBIO AQUÍ: Obtenemos el inicio del día (00:00:00) EXACTAMENTE en la hora de Lima
    const hoyLimaInicioDia = dayjs().tz(TZ_LIMA).startOf('day');

    // 1. Obtenemos los días de anticipación del Profeta
    const paramAnti = await prisma.parametros_sistema.findUnique({
      where: { clave: 'DIAS_ANTICIPACION_RENOVACION' },
    });
    const diasAnticipacionProfeta = paramAnti ? Number.parseInt(paramAnti.valor) : 5;

    // 🔥 REGLA DE ORO: El Liquidador ataca exactamente 1 día antes que el Profeta genere deuda nueva
    const diasAnticipacionLiquidador = diasAnticipacionProfeta + 1;

    // 2. Buscamos a TODOS los alumnos con deuda a medias ('PARCIAL')
    const morososParciales = await prisma.cuentas_por_cobrar.findMany({
      where: { estado: 'PARCIAL' },
      select: { alumno_id: true },
      distinct: ['alumno_id'],
    });

    if (morososParciales.length === 0) return;

    let totalFinalizados = 0;
    let totalPenRecu = 0;

    for (const { alumno_id } of morososParciales) {
      // 3. Buscamos su Fecha Madre para calcular el ciclo
      const inscripcionMadre = await prisma.inscripciones.findFirst({
        where: { alumno_id: alumno_id, estado: 'ACTIVO' },
        orderBy: { fecha_inscripcion: 'asc' },
      });

      if (!inscripcionMadre) continue;

      // 4. Calculamos fin de mes (Fecha Madre + 30 días)
      // 🔥 CAMBIO AQUÍ: Sumamos 30 días y calculamos el inicio de ese día en hora de Lima
      const finCiclo = dayjs(inscripcionMadre.fecha_inscripcion)
        .tz(TZ_LIMA)
        .add(30, 'day')
        .startOf('day');

      // 5. Calculamos el "Día del Juicio"
      // 🔥 CAMBIO AQUÍ: Restamos los días de anticipación usando dayjs
      const diaDelJuicioParcial = finCiclo.subtract(diasAnticipacionLiquidador, 'day');

      // 6. ¿Llegó el momento de liquidar?
      // 🔥 CAMBIO AQUÍ: Comparamos directamente con el valor absoluto en milisegundos (.valueOf())
      if (hoyLimaInicioDia.valueOf() >= diaDelJuicioParcial.valueOf()) {
        // Buscamos si tiene derecho a Purgatorio (Recuperaciones)
        const tieneRecuperacionesPendientes = await prisma.recuperaciones.findFirst({
          where: {
            alumno_id: alumno_id,
            estado: { in: ['PENDIENTE', 'PROGRAMADA'] },
          },
        });

        const nuevoEstado = tieneRecuperacionesPendientes ? 'PEN-RECU' : 'FINALIZADO';

        // 7. La Ejecución Letal con Notificación vinculada
        await prisma.$transaction([
          // Matamos inscripciones activas
          prisma.inscripciones.updateMany({
            where: { alumno_id: alumno_id, estado: 'ACTIVO' },
            // 🔥 CAMBIO AQUÍ: Convertimos de nuevo a Date nativo para Prisma
            data: { estado: nuevoEstado, actualizado_en: dayjs().toDate() },
          }),
          // 🔥 PENALIDAD: Pierde su estatus de alumno antiguo por moroso (La deuda PARCIAL se queda intacta)
          prisma.alumnos.update({
            where: { usuario_id: alumno_id },
            data: { historial: 'Nuevo' },
          }),
          // 🔔 Notificación para la alumna
          prisma.notificaciones.create({
            data: {
              alumno_id: alumno_id,
              titulo: '🗡️ Inscripción Liquidada',
              mensaje: `Tu acceso ha sido marcado como ${nuevoEstado} por saldo pendiente (Pago Parcial). Has perdido los beneficios de alumno fundador.`,
              tipo: 'DANGER',
              categoria: 'SISTEMA',
            },
          }),
        ]);

        nuevoEstado === 'PEN-RECU' ? totalPenRecu++ : totalFinalizados++;
      }
    }

    // 8. Notificación de Resumen para el Admin
    if (totalFinalizados > 0 || totalPenRecu > 0) {
      await notificacionesService.crear({
        titulo: '🛡️ Resumen Liquidador Parcial',
        mensaje: `Se liquidaron ${totalFinalizados + totalPenRecu} alumnos con pagos incompletos.`,
        tipo: 'INFO',
        categoria: 'SISTEMA',
      });

      logger.info(
        `[LIQUIDADOR PARCIAL] Ejecución exitosa. Alumnos a FINALIZADO: ${totalFinalizados} | Alumnos a PEN-RECU: ${totalPenRecu}.`
      );
    }
  }

  // =================================================================
  // 📧📲 RECORDATORIO: 22 Días (Pagos Parciales) - Email + WhatsApp
  // =================================================================
  async alertaMorososParciales() {
    const hoyLimaInicioDia = dayjs().tz(TZ_LIMA).startOf('day');
    const { TWILIO_TEMPLATE_PAGO_PARCIAL_SID } = await import('../../config/secret.config.js');

    const morososParciales = await prisma.cuentas_por_cobrar.findMany({
      where: { estado: 'PARCIAL' },
      select: { alumno_id: true },
      distinct: ['alumno_id'],
    });

    if (morososParciales.length === 0) return;

    let totalEmails = 0;
    let totalWhatsApp = 0;

    for (const { alumno_id } of morososParciales) {
      const inscripcionMadre = await prisma.inscripciones.findFirst({
        where: { alumno_id: alumno_id, estado: 'ACTIVO' },
        orderBy: { fecha_inscripcion: 'asc' },
        include: {
          alumnos: {
            include: { usuarios: true },
          },
        },
      });

      if (!inscripcionMadre) continue;

      const diaAviso22 = dayjs(inscripcionMadre.fecha_inscripcion)
        .tz(TZ_LIMA)
        .add(22, 'day')
        .startOf('day');

      if (hoyLimaInicioDia.valueOf() === diaAviso22.valueOf()) {
        const usuario = inscripcionMadre.alumnos.usuarios;
        if (!usuario) continue;

        // =============================================
        // 📧 EMAIL: Siempre se intenta (gratis)
        // =============================================
        if (usuario.email) {
          try {
            await emailService.sendPartialPaymentReminder(usuario.email, usuario.nombres);
            totalEmails++;
          } catch (err) {
            logger.error(
              `[EMAIL ERROR] No se pudo enviar el recordatorio del día 22 al correo ${usuario.email}`,
              err
            );
          }
        }

        // =============================================
        // 📲 WHATSAPP: Plantilla HX... o texto directo
        // =============================================
        if (usuario.telefono_personal) {
          try {
            let resultadoWA = { success: false, sid: null };
            if (TWILIO_TEMPLATE_PAGO_PARCIAL_SID) {
              const variables = { 1: usuario.nombres };
              resultadoWA = await twilioProvider.sendTemplateMessage(
                usuario.telefono_personal,
                TWILIO_TEMPLATE_PAGO_PARCIAL_SID,
                variables
              );
            } else {
              const mensaje = `Hola ${usuario.nombres}, te recordamos que tienes un saldo pendiente (pago parcial) en Club Gema. Por favor regularízalo antes del cierre de tu ciclo para no perder tus beneficios.`;
              resultadoWA = await twilioProvider.sendWhatsAppMessage(
                usuario.telefono_personal,
                mensaje
              );
            }

            if (resultadoWA.success) {
              totalWhatsApp++;
            } else {
              logger.warn(
                `[WA WARN] Recordatorio parcial no enviado a ${usuario.telefono_personal} (sin éxito confirmado).`
              );
            }
          } catch (err) {
            logger.error(
              `[WA ERROR] No se pudo enviar recordatorio parcial a ${usuario.telefono_personal}`,
              err
            );
          }
        }
      }
    }

    if (totalEmails > 0 || totalWhatsApp > 0) {
      logger.info(
        `[RECORDATORIO 22 DIAS] Enviados: ${totalEmails} emails + ${totalWhatsApp} WhatsApps a morosos parciales.`
      );
    }
  }

  // =================================================================
  // 📲 ALERTA VENCIMIENTO INMINENTE: 29 Días + Tolerancia - 1 (WhatsApp Plantilla)
  // =================================================================
  async alertaVencimientoInminenteWhatsApp() {
    const hoyLimaInicioDia = dayjs().tz(TZ_LIMA).startOf('day');
    const { TWILIO_TEMPLATE_VENCIMIENTO_SID } = await import('../../config/secret.config.js');

    const paramTolerancia = await prisma.parametros_sistema.findUnique({
      where: { clave: 'DIAS_TOLERANCIA_VENCIMIENTO' },
    });
    const diasTolerancia = paramTolerancia ? Number.parseInt(paramTolerancia.valor) : 5;

    const rebeldes = await prisma.cuentas_por_cobrar.findMany({
      where: { estado: 'PENDIENTE' },
      select: { alumno_id: true },
      distinct: ['alumno_id'],
    });

    if (rebeldes.length === 0) return;

    const candidatosAlerta = [];

    for (const { alumno_id } of rebeldes) {
      const inscripcionMadre = await prisma.inscripciones.findFirst({
        where: { alumno_id: alumno_id, estado: 'ACTIVO' },
        orderBy: { fecha_inscripcion: 'asc' },
        include: {
          alumnos: {
            include: { usuarios: true },
          },
        },
      });

      if (!inscripcionMadre) continue;

      const fechaLimiteMuerte = dayjs(inscripcionMadre.fecha_inscripcion)
        .tz(TZ_LIMA)
        .add(30 + diasTolerancia, 'day')
        .startOf('day');

      const diaAlerta = fechaLimiteMuerte.subtract(1, 'day');

      if (hoyLimaInicioDia.valueOf() === diaAlerta.valueOf()) {
        const usuario = inscripcionMadre.alumnos.usuarios;
        if (usuario && usuario.telefono_personal) {
          candidatosAlerta.push({
            telefono: usuario.telefono_personal,
            nombres: usuario.nombres,
            // MEJORA #6: Guardamos la fecha límite calculada para poder usarla como variable
            // en la plantilla de Twilio si el template la requiere (ej: variable "2")
            fechaLimite: fechaLimiteMuerte.format('DD/MM/YYYY'),
          });
        }
      }
    }

    if (candidatosAlerta.length === 0) return;

    logger.info(
      `[ALERTA VENCIMIENTO] Procesando ${candidatosAlerta.length} alertas inminentes en lotes...`
    );

    const LIMITE_CONCURRENCIA = 10;
    const resultados = [];

    for (let i = 0; i < candidatosAlerta.length; i += LIMITE_CONCURRENCIA) {
      const lote = candidatosAlerta.slice(i, i + LIMITE_CONCURRENCIA);

      const promesasLote = lote.map(async (candidato) => {
        let resultado = { success: false, sid: null };

        if (TWILIO_TEMPLATE_VENCIMIENTO_SID) {
          // 🚀 PRODUCCIÓN: Plantilla oficial aprobada por Meta
          // MEJORA #6: Variables construidas con la data disponible.
          // Ajusta las keys ("1", "2", etc.) según las variables de tu plantilla en Twilio.
          const variables = {
            1: candidato.nombres,
            2: candidato.fechaLimite, // Disponible si tu plantilla usa una segunda variable
          };
          // MEJORA #7: Capturamos el objeto { success, sid } que ahora retorna el provider
          resultado = await twilioProvider.sendTemplateMessage(
            candidato.telefono,
            TWILIO_TEMPLATE_VENCIMIENTO_SID,
            variables
          );
        } else {
          // 🧪 SIN PLANTILLA: Envía el mensaje escrito directamente en el backend
          const mensaje = `¡Atención ${candidato.nombres}! Tu inscripción en Club Gema está por vencer mañana. Para no perder tu cupo y tus beneficios de alumno antiguo, por favor regulariza tu pago pendiente hoy mismo.`;
          resultado = await twilioProvider.sendWhatsAppMessage(candidato.telefono, mensaje);
        }

        // MEJORA #7: Si el envío fue exitoso y tenemos SID, aquí puedes persistirlo en DB.
        // Ejemplo (descomenta y adapta la tabla según tu schema):
        // if (resultado.success && resultado.sid) {
        //   await prisma.notificaciones_externas.create({
        //     data: {
        //       alumno_id: candidato.alumno_id, // Asegúrate de incluir alumno_id en candidatosAlerta
        //       canal: 'WHATSAPP',
        //       tipo: 'ALERTA_VENCIMIENTO',
        //       sid_externo: resultado.sid,
        //       enviado_en: new Date(),
        //     }
        //   });
        // }

        return resultado;
      });

      const chunkResults = await Promise.allSettled(promesasLote);
      resultados.push(...chunkResults);
    }

    const exitosos = resultados.filter((r) => r.status === 'fulfilled' && r.value.success).length;

    if (exitosos > 0) {
      logger.info(
        `[ALERTA VENCIMIENTO] Se enviaron exitosamente ${exitosos}/${candidatosAlerta.length} alertas por WhatsApp.`
      );
    }
  }
}

export const inscripcionCronService = new InscripcionCronService();
