import { prisma } from '../../config/database.config.js';
import crypto from 'crypto';
import * as Utils from './utils/inscripcion.util.js';
import * as Validators from './validators/inscripcion.validator.js';
import * as Logic from './logic/inscripcion.logic.js';
import { asistenciaService } from '../asistencia/asistencia.service.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { CuentasPorCobrarService } from '../cuenta_por_cobrar/cuentas_por_cobrar.service.js';
import { pagosService } from '../pagos/pagos.service.js';

// 🔥 IMPORTAMOS DAYJS Y CONFIGURAMOS LIMA PARA LOS LOGS 🔥
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ_LIMA = 'America/Lima';

export const inscripcionService = {
  // =================================================================
  // 🚀 MOTOR MAESTRO DE INSCRIPCIÓN: GEMA ACADEMY (VERSIÓN FINAL)
  // =================================================================
  inscribirPaquete: async (data) => {
    const { alumno_id, horario_ids, fecha_inicio_electiva, incluye_camiseta } = data;

    try {
      // 1. Validación de estructura de entrada (Utils sigue sirviendo)
      Utils.validarInputInscripcion(horario_ids);

      return await prisma.$transaction(async (tx) => {
        // 🛡️ PASO 0: MUROS DE SEGURIDAD (Regla de Oro: Muro de Deuda)
        await Validators.validarMuroDeDeuda(tx, alumno_id);

        // 🕵️‍♂️ PASO 1: DETECTIVE DE RÉGIMEN (Solo para saber si es Legacy o 2026)
        // Borramos Logic.calcularCicloUpgrade porque ya no hay sincronización.
        const esAlumnoLegacy = await Logic.detectarRegimenAlumno(tx, alumno_id);

        // 👮‍♂️ PASO 2: VALIDACIÓN DE CAPACIDAD Y BUSQUEDA DE PLAN
        // Buscamos el plan según la cantidad de horarios que el alumno está comprando HOY.
        const conceptoAplicar = await tx.catalogo_conceptos.findFirst({
          where: {
            cantidad_clases_semanal: horario_ids.length,
            activo: true,
            es_vigente: !esAlumnoLegacy
          }
        });

        if (!conceptoAplicar) {
          throw new Error(`⛔ No existe un plan para ${horario_ids.length} clases en el catálogo.`);
        }

        // 🧟 PASO 3: ANTI-ZOMBIE (Aforo)
        const paramZ = await tx.parametros_sistema.findUnique({ where: { clave: 'TIEMPO_LIMITE_RESERVA_MIN' } });
        const fechaLimiteZombie = new Date(Date.now() - (paramZ ? parseInt(paramZ.valor) : 20) * 60 * 1000);

        // 🔄 PASO 4: PROCESAR HORARIOS (Independencia Radical)
        const inscripcionesCreadas = [];
        const grupoUuid = crypto.randomUUID(); // ID único para este paquete de compra

        // La fecha de inicio es la electiva o hoy. Cada slot tendrá esta misma fecha de inicio.
        const inicioReal = fecha_inicio_electiva
          ? dayjs.tz(fecha_inicio_electiva, TZ_LIMA).hour(12).toDate()
          : dayjs.tz(TZ_LIMA).hour(12).toDate();
        for (const idHorario of horario_ids) {
          // Validar aforo por cada clase
          await Validators.validarAforoHorario(tx, idHorario, fechaLimiteZombie);

          // Crear la inscripción con sus propios 30 días limpios
          const nuevaInscripcion = await tx.inscripciones.create({
            data: {
              alumno_id: parseInt(alumno_id),
              horario_id: idHorario,
              id_grupo_transaccion: grupoUuid,
              estado: 'PENDIENTE_PAGO',
              fecha_inscripcion: inicioReal,
              fecha_inscripcion_original: inicioReal,
            },
            include: { horarios_clases: true }
          });
          inscripcionesCreadas.push(nuevaInscripcion);
        }

        // 💸 PASO 5: CÁLCULO DE COBRO (Simple y Directo)
        let totalCobrar = Number(conceptoAplicar.precio_base);
        let detalleCobro = [`Plan ${horario_ids.length} clases/semana`];

        if (incluye_camiseta) {
          totalCobrar += 50;
          detalleCobro.push("Camiseta Oficial Gema");
        }

        // Generar la Cuenta por Cobrar única para esta transacción
        const nuevaCuenta = await tx.cuentas_por_cobrar.create({
          data: {
            alumno_id: parseInt(alumno_id),
            concepto_id: conceptoAplicar.id,
            monto_final: totalCobrar,
            detalle_adicional: detalleCobro.join(' | '),
            fecha_vencimiento: dayjs().tz(TZ_LIMA).add(2, 'day').endOf('day').toDate(), // 48 horas de reserva
            estado: 'PENDIENTE'
          }
        });

        // 🌉 PASO 6: VINCULACIÓN A LA TABLA PUENTE (La Alcancía)
        // Dividimos el monto (por ahora parejo) entre los slots inscritos
        const montoPorSlot = totalCobrar / inscripcionesCreadas.length;

        await tx.inscripciones_deudas_link.createMany({
          data: inscripcionesCreadas.map((ins) => ({
            inscripcion_id: ins.id,
            cuenta_id: nuevaCuenta.id,
            monto_asignado: montoPorSlot
          }))
        });

        // 💸 PASO 7: APLICACIÓN DE BENEFICIOS (Automáticos)
        const beneficiosEnCola = await tx.beneficios_pendientes.findMany({
          where: { alumno_id: parseInt(alumno_id), usado: false },
          include: { tipos_beneficio: true }
        });

        let montoActualizado = totalCobrar;
        for (const pendiente of beneficiosEnCola) {
          const valorNominal = parseFloat(pendiente.tipos_beneficio.valor_por_defecto);
          let descuentoReal = pendiente.tipos_beneficio.es_porcentaje
            ? montoActualizado * (valorNominal / 100)
            : valorNominal;

          const descuentoFinal = descuentoReal > montoActualizado ? montoActualizado : descuentoReal;
          montoActualizado -= descuentoFinal;

          await tx.descuentos_aplicados.create({
            data: {
              cuenta_id: nuevaCuenta.id,
              tipo_beneficio_id: pendiente.tipo_beneficio_id,
              monto_nominal_aplicado: valorNominal,
              monto_dinero_descontado: descuentoFinal,
              motivo_detalle: pendiente.motivo || "Beneficio automático",
              aplicado_por: pendiente.asignado_por
            }
          });
          await tx.beneficios_pendientes.update({ where: { id: pendiente.id }, data: { usado: true } });
        }

        // Actualizamos el monto final de la cuenta tras los beneficios
        await tx.cuentas_por_cobrar.update({
          where: { id: nuevaCuenta.id },
          data: {
            monto_final: montoActualizado,
            estado: montoActualizado <= 0.01 ? 'PAGADA' : 'PENDIENTE'
          }
        });

        // 🔔 PASO 8: NOTIFICACIÓN
        await tx.notificaciones.create({
          data: {
            alumno_id: parseInt(alumno_id),
            titulo: '✅ Inscripción Generada',
            mensaje: `Se ha reservado tu cupo. Total: S/ ${montoActualizado.toFixed(2)}.`,
            tipo: 'SUCCESS',
            categoria: 'SISTEMA'
          }
        });

        return {
          mensaje: 'Inscripción procesada exitosamente.',
          total_a_pagar: montoActualizado,
          inscripciones: inscripcionesCreadas
        };
      });

    } catch (error) {
      console.error(`❌ [FALLO MOTOR RADICAL] Alumno: ${alumno_id} | ${error.message}`);
      throw error;
    }
  },

  // =================================================================
  // 🔮 LA LÓGICA DEL PROFETA: Renovaciones Masivas (Reconstruido)
  // =================================================================
  generarRenovacionesMasivas: async (diasAnticipacion) => {
    const { inicio, fin } = Utils.calcularRangoRenovacion(diasAnticipacion);

    return await prisma.$transaction(async (tx) => {
      const candidatos = await tx.inscripciones.findMany({
        where: {
          estado: 'ACTIVO',
          fecha_inscripcion: { gte: inicio, lte: fin },
        },
        distinct: ['alumno_id'],
      });

      let renovacionesCreadas = 0;

      for (const candidato of candidatos) {
        const alumnoId = candidato.alumno_id;

        // 🛡️ Evitar duplicados si ya se generó renovación hoy
        if (await Validators.existeRenovacionReciente(tx, alumnoId, inicio)) continue;

        // 1. Contamos cuántas clases reales tiene el alumno activas
        const totalCursosActivos = await tx.inscripciones.count({
          where: { alumno_id: alumnoId, estado: 'ACTIVO' },
        });

        if (totalCursosActivos === 0) continue;

        // 🕵️‍♂️ Detective de Régimen (Legacy vs 2026)
        const esAlumnoLegacy = await Logic.detectarRegimenAlumno(tx, alumnoId);

        // 2. 🌟 BÚSQUEDA DINÁMICA: Buscamos el plan que calce con sus clases actuales
        const planAdecuado = await tx.catalogo_conceptos.findFirst({
          where: {
            cantidad_clases_semanal: totalCursosActivos,
            activo: true,
            es_vigente: !esAlumnoLegacy
          }
        });

        if (!planAdecuado) {
          console.log(`⚠️ No hay plan para ${totalCursosActivos} clases para el alumno ${alumnoId}`);
          continue;
        }

        // 3. Crear la Deuda Base
        const nuevaCuenta = await tx.cuentas_por_cobrar.create({
          data: {
            alumno_id: alumnoId,
            concepto_id: planAdecuado.id,
            monto_final: planAdecuado.precio_base,
            detalle_adicional: `Renovación Automática (Plan: ${planAdecuado.nombre})`,
            fecha_vencimiento: Utils.calcularFechaVencimiento(diasAnticipacion),
            estado: 'PENDIENTE',
          },
        });

        // 4. ⚡ APLICACIÓN DE BENEFICIOS PENDIENTES (Lógica recuperada)
        const beneficiosEnCola = await tx.beneficios_pendientes.findMany({
          where: { alumno_id: alumnoId, usado: false },
          include: { tipos_beneficio: true }
        });

        let montoCorriente = parseFloat(nuevaCuenta.monto_final);

        for (const pendiente of beneficiosEnCola) {
          const valorNominal = parseFloat(pendiente.tipos_beneficio.valor_por_defecto);

          let descuentoReal = pendiente.tipos_beneficio.es_porcentaje
            ? montoCorriente * (valorNominal / 100)
            : valorNominal;

          const descuentoFinal = descuentoReal > montoCorriente ? montoCorriente : descuentoReal;
          montoCorriente -= descuentoFinal;

          // A. Registrar el descuento aplicado
          await tx.descuentos_aplicados.create({
            data: {
              cuenta_id: nuevaCuenta.id,
              tipo_beneficio_id: pendiente.tipo_beneficio_id,
              monto_nominal_aplicado: valorNominal,
              monto_dinero_descontado: descuentoFinal,
              motivo_detalle: pendiente.motivo || "Beneficio aplicado en renovación automática",
              aplicado_por: pendiente.asignado_por,
              fecha_aplicacion: new Date()
            }
          });

          // B. Quemar el beneficio
          await tx.beneficios_pendientes.update({
            where: { id: pendiente.id },
            data: { usado: true }
          });
        }

        // 5. Actualizar saldo final de la cuenta si hubo descuentos
        if (montoCorriente !== parseFloat(nuevaCuenta.monto_final)) {
          await tx.cuentas_por_cobrar.update({
            where: { id: nuevaCuenta.id },
            data: {
              monto_final: montoCorriente,
              estado: montoCorriente <= 0.01 ? 'PAGADA' : 'PENDIENTE'
            }
          });
        }

        // 6. 🔔 NOTIFICACIÓN PARA EL DASHBOARD
        await tx.notificaciones.create({
          data: {
            alumno_id: alumnoId,
            titulo: '💎 Renovación Generada',
            mensaje: `Se ha generado tu cuota de renovación (S/ ${montoCorriente.toFixed(2)}). Realiza tu pago antes del vencimiento.`,
            tipo: 'SUCCESS',
            categoria: 'COBRO'
          }
        });

        renovacionesCreadas++;
      }
      return renovacionesCreadas;
    });
  },

  getAllInscripciones: async () => {
    return await prisma.inscripciones.findMany({
      include: {
        alumnos: {
          include: { usuarios: { select: { nombres: true, apellidos: true, email: true } } },
        },
        horarios_clases: { include: { canchas: true, niveles_entrenamiento: true } },
      },
      orderBy: { fecha_inscripcion: 'desc' },
    });
  },
  obtenerPorAlumno: async (alumnoId) => {
    return await prisma.inscripciones.findMany({
      where: {
        alumno_id: Number.parseInt(alumnoId)
      },
      include: {
        // 1. Entramos a la tabla de Horarios
        horarios_clases: {
          include: {
            // 2. Entramos a la tabla de Canchas
            canchas: {
              include: {
                // 3. Entramos a la tabla de Sedes para el nombre (Lima, Callao, etc.)
                sedes: {
                  select: {
                    nombre: true
                  }
                }
              }
            },
            // 4. Traemos el nivel (Básico, Intermedio, etc.)
            niveles_entrenamiento: {
              select: {
                nombre: true
              }
            }
          }
        },
        // 5. Traemos la deuda para las fechas de vigencia (Ciclo)
        inscripciones_deudas_link: {
          include: {
            cuentas_por_cobrar: {
              select: {
                id: true,
                fecha_vencimiento: true,
                estado: true,
                detalle_adicional: true
              }
            }
          },
          orderBy: { creado_en: 'desc' },
          take: 1
        }
      },
      orderBy: { creado_en: 'desc' }
    });
  },
  obtenerNoFinalizadasPorAlumno: async (alumnoId) => {
    return await prisma.inscripciones.findMany({
      where: {
        alumno_id: Number.parseInt(alumnoId),
        estado: { notIn: ['FINALIZADO'] }
      },
      include: {
        horarios_clases: {
          include: {
            canchas: {
              include: {
                sedes: {
                  select: {
                    nombre: true,
                  }
                }
              }
            },
            niveles_entrenamiento: true,
            coordinadores: { include: { usuarios: true } }
          }
        }
      }
    });
  },
  getInscripcionById: async (id) => {
    return await prisma.inscripciones.findUnique({
      where: { id: Number.parseInt(id) },
      include: {
        alumnos: {
          include: { usuarios: { select: { nombres: true, apellidos: true, email: true } } },
        },
        horarios_clases: {
          include: {
            canchas: true,
            niveles_entrenamiento: true,
            coordinadores: { include: { usuarios: true } }
          }
        },
      }
    });
  },

  // =================================================================
  // 🗑️ ELIMINAR / CANCELAR INSCRIPCIÓN
  // =================================================================
  eliminarInscripcion: async (id) => {
    // Primero verificamos si existe
    const existe = await prisma.inscripciones.findUnique({
      where: { id: Number.parseInt(id) }
    });

    if (!existe) throw new Error('La inscripción no existe.');

    // En lugar de borrar físicamente, podrías cambiar el estado a 'CANCELADO'
    // Pero si el requerimiento es borrar de la BD:
    return await prisma.inscripciones.delete({
      where: { id: Number.parseInt(id) }
    });
  },
  // =================================================================
  // 👋 FINALIZACIÓN VOLUNTARIA (El usuario decide retirarse)
  // =================================================================
  finalizarInscripcionVoluntaria: async (id) => {
    return await prisma.$transaction(async (tx) => {
      // 1. Verificamos que la inscripción exista y sea del alumno
      const inscripcion = await tx.inscripciones.findUnique({
        where: { id: Number.parseInt(id) }
      });

      if (!inscripcion) {
        throw new Error('La inscripción no existe.');
      }

      // 🛡️ REGLA DE NEGOCIO: Solo se puede finalizar lo que está ACTIVO
      if (inscripcion.estado !== 'ACTIVO') {
        throw new Error(`No se puede finalizar una inscripción con estado ${inscripcion.estado}.`);
      }

      const inscripcionActualizada = await tx.inscripciones.update({
        where: { id: Number.parseInt(id) },
        data: {
          estado: 'FINALIZADO',
          actualizado_en: new Date()
        }
      });

      console.log(`✅ [CANCELACIÓN] El alumno ${inscripcion.alumno_id} finalizó voluntariamente el horario ${inscripcion.horario_id}.`);

      return {
        success: true,
        mensaje: 'Inscripción finalizada correctamente.',
        nuevo_estado: 'FINALIZADO'
      };
    });
  },

  separarFinalizarVoluntaria: async (id) => {
    return await prisma.$transaction(async (tx) => {
      const inscripcionId = Number(id);

      const inscripcion = await tx.inscripciones.findUnique({
        where: { id: inscripcionId },
        include: {
          inscripciones_deudas_link: {
            select: {
              cuentas_por_cobrar: true
            },
            orderBy: {
              creado_en: 'desc'
            },
            take: 1
          }
        }
      });

      if (!inscripcion) throw new Error('Inscripción no encontrada');

      const actualizada = await tx.inscripciones.update({
        where: { id: inscripcionId },
        data: {
          estado: 'FINALIZADO',
          id_grupo_transaccion: null,
          actualizado_en: new Date()
        }
      });

      if (inscripcion.estado === 'POR_VALIDAR') {
        const inscPaq = await tx.inscripciones.findMany({
          where: { id_grupo_transaccion: inscripcion.id_grupo_transaccion }
        })
        const cuenta = inscripcion.inscripciones_deudas_link?.[0]?.cuentas_por_cobrar;
        if (!cuenta) throw new Error('Cuenta no encontrada');

        if (inscPaq.length > 0) {
          const esLegacy = await Logic.detectarRegimenAlumno(tx, inscripcion.alumno_id)
          const cpto = await tx.catalogo_conceptos.findFirst({
            where: {
              activo: true,
              es_vigente: !esLegacy,
              cantidad_clases_semanal: inscPaq.length,
            }
          })
          if (!cpto) throw new Error('Concepto de pago no encontrado');

          let montoIndividual = Number(cpto.precio_base);
          if (cuenta.detalle_adicional.toLowerCase().includes('camiseta')) montoIndividual += 50;
          const { monto_final } = await CuentasPorCobrarService.actualizar(tx, cuenta.id, {
            alumno_id: cuenta.alumno_id,
            concepto_id: cpto.id,
            detalle_adicional: `${cuenta.detalle_adicional} | Plan Actualizado por Finalización Voluntaria: ${cpto.cantidad_clases_semanal} clase(s)`,
            monto_final: montoIndividual,
            fecha_vencimiento: cuenta.fecha_vencimiento,
            estado: cuenta.estado,
          })

          await tx.inscripciones_deudas_link.deleteMany({
            where: {
              inscripcion_id: inscripcion.id,
              cuenta_id: cuenta.id,
            }
          })

          await tx.pagos.updateMany({
            where: { cuenta_id: cuenta.id },
            data: {
              monto_pagado: monto_final,
            }
          })
        } else {
          await tx.inscripciones_deudas_link.deleteMany({
            where: {
              inscripcion_id: inscripcion.id,
              cuenta_id: cuenta.id,
            }
          })
          await CuentasPorCobrarService.eliminar(cuenta.id, true, tx);
        }
      }

      return {
        success: true,
        mensaje: 'Horario removido del paquete y finalizado correctamente.',
        nuevoEstado: actualizada.estado
      };
    });
  },

  cancelarReservaPendiente: async (id) => {
    return await prisma.$transaction(async (tx) => {
      // 1. Identificar la inscripción "semilla"
      const inscripcionSemilla = await tx.inscripciones.findUnique({
        where: { id: Number.parseInt(id) },
      });

      if (!inscripcionSemilla || inscripcionSemilla.estado !== 'PENDIENTE_PAGO') {
        throw new Error('Solo se pueden cancelar reservas pendientes de pago.');
      }

      // 2. Localizar la deuda vinculada (usando el tiempo de creación como nexo)
      const deudaAsociada = await tx.cuentas_por_cobrar.findMany({
        where: {
          alumno_id: inscripcionSemilla.alumno_id,
          estado: 'PENDIENTE',
          alumnos: {
            inscripciones: {
              some: {
                id: inscripcionSemilla.id,
              }
            }
          }
        },
        include: {
          alumnos: {
            select: {
              inscripciones: {
                select: { id: true }
              }
            }
          }
        }
      });
      const inscAsociadas = [...new Set(deudaAsociada.flatMap(d => d.alumnos?.inscripciones?.map(i => i.id) ?? []))]

      if (deudaAsociada.length > 0) {
        // 3. EN CASCADA: Borramos todas las inscripciones que se crearon en ese mismo instante
        // Esto elimina el "paquete" completo (los 2 o 3 horarios que eligió)
        await tx.inscripciones.deleteMany({
          where: {
            id: { in: inscAsociadas },
            alumno_id: inscripcionSemilla.alumno_id,
            estado: 'PENDIENTE_PAGO',
          }
        });

        const deudasId = deudaAsociada.map(d => d.id)
        // 4. Devolvemos beneficios si existían
        const descuentos = await tx.descuentos_aplicados.findMany({ where: { cuenta_id: { in: deudasId } } });
        for (const desc of descuentos) {
          await tx.beneficios_pendientes.updateMany({
            where: { alumno_id: inscripcionSemilla.alumno_id, tipo_beneficio_id: desc.tipo_beneficio_id, usado: true },
            data: { usado: false },
          });
        }

        // 5. Borramos la deuda y sus relaciones
        await tx.descuentos_aplicados.deleteMany({ where: { cuenta_id: { in: deudasId } } });
        await tx.cuentas_por_cobrar.deleteMany({ where: { id: { in: deudasId } } });
      }

      return { success: true, mensaje: 'Paquete de reserva cancelado íntegramente.' };
    });
  },

  // inscripcion.service.js
  eliminarPaqueteCompleto: async (cuentaId) => {
    return await prisma.$transaction(async (tx) => {
      // 1. Buscamos la cuenta para leer el detalle ANTES de borrarla
      const cuenta = await tx.cuentas_por_cobrar.findUnique({
        where: { id: parseInt(cuentaId) }
      });

      const links = await tx.inscripciones_deudas_link.findMany({
        where: { cuenta_id: parseInt(cuentaId) }
      });

      const idsInscripciones = links.map(l => l.inscripcion_id);

      // 2. 🔄 REVERSIÓN BASADA EN EL DETALLE DE LA CUENTA
      if (cuenta?.detalle_adicional?.includes('FECHA_ANT:')) {
        // Extraemos la fecha usando un split rápido
        const parteFecha = cuenta.detalle_adicional.split('FECHA_ANT:')[1].split('|')[0];

        for (const idIns of idsInscripciones) {
          await tx.inscripciones.update({
            where: { id: idIns },
            data: {
              fecha_inscripcion: new Date(parteFecha),
              fecha_inscripcion_original: new Date(parteFecha),
              actualizado_en: new Date()
            }
          });
        }
        console.log(`[REVERSIÓN] Ciclos restaurados a: ${parteFecha}`);
      }

      // 3. LIMPIEZA TOTAL
      await tx.inscripciones_deudas_link.deleteMany({ where: { cuenta_id: parseInt(cuentaId) } });
      await tx.descuentos_aplicados.deleteMany({ where: { cuenta_id: parseInt(cuentaId) } });
      await tx.pagos.deleteMany({ where: { cuenta_id: parseInt(cuentaId) } });
      await tx.cuentas_por_cobrar.delete({ where: { id: parseInt(cuentaId) } });

      if (cuenta.detalle_adicional.includes('RENOVACION')) {
        await tx.inscripciones.updateMany({
          where: {
            id: { in: idsInscripciones },
            estado: { in: ['PENDIENTE_PAGO', 'POR_VALIDAR'] }
          },
          data: {
            estado: 'ACTIVO'
          }
        })

        return { success: true };
      }
      // 4. Borramos solo si eran nuevas (PENDIENTE_PAGO o POR_VALIDAR)
      const result = await tx.inscripciones.deleteMany({
        where: {
          id: { in: idsInscripciones },
          estado: { in: ['PENDIENTE_PAGO', 'POR_VALIDAR'] }
        }
      });

      return { success: true, borrados: result.count };
    });
  },

  updateInscripcion: async (data) => {
    const { alumnoId, inscripcionId, horarioId, adminId } = data;

    if (!alumnoId) throw new ApiError('El campo alumnoId es requerido', 400);
    if (!inscripcionId) throw new ApiError('El campo inscripcionId es requerido', 400);
    if (!horarioId) throw new ApiError('El campo horarioId es requerido', 400);
    // if (!adminId) throw new ApiError('El campo adminId es requerido', 400); //No es necesario

    return await prisma.$transaction(async (tx) => {
      const insc = await tx.inscripciones.findFirst({
        where: { alumno_id: alumnoId, id: inscripcionId },
        include: {
          inscripciones_deudas_link: {
            orderBy: {
              creado_en: 'desc',
            }
          },
        }
      })
      if (!insc) throw new ApiError('No existe inscripción con esa ID', 404);

      const inscTotales = await inscripcionService.obtenerNoFinalizadasPorAlumno(insc.alumno_id)
      const yaExiste = inscTotales.some(i => i.horario_id === horarioId)
      if (yaExiste) throw new ApiError('El horario destino ya pertenece a una inscripción del alumno.', 400);

      const count = await asistenciaService.eliminarClases(tx, insc.id, insc.fecha_inscripcion_original);
      console.log(`Se eliminaron ${count} registros de asistencia.`)

      await tx.inscripciones.update({
        where: { alumno_id: insc.alumno_id, id: insc.id },
        data: {
          estado: 'FINALIZADO',
          id_grupo_transaccion: null,
          actualizado_en: new Date()
        },
      })

      const createdInsc = await tx.inscripciones.create({
        data: {
          alumno_id: insc.alumno_id,
          horario_id: horarioId,
          fecha_inscripcion: insc.fecha_inscripcion_original, //Para asegurar que se reinicie la fecha de inscripción con la original (PARA CASOS AISLADOS DE REPROGRAMACIÓN MASIVA)
          fecha_inscripcion_original: insc.fecha_inscripcion_original,
          estado: insc.estado,
          actualizado_en: new Date(),
          creado_en: insc.creado_en,
          id_grupo_transaccion: insc.id_grupo_transaccion,
        },
        include: {
          horarios_clases: true
        }
      })

      await tx.inscripciones_deudas_link.create({
        data: {
          inscripcion_id: createdInsc.id,
          cuenta_id: insc.inscripciones_deudas_link[0].cuenta_id,
          monto_asignado: Number(insc.inscripciones_deudas_link[0].monto_asignado),
        }
      })

      await tx.inscripciones_deudas_link.deleteMany({
        where: {
          inscripcion_id: insc.id,
          cuenta_id: insc.inscripciones_deudas_link[0].cuenta_id,
        }
      })

      if (createdInsc.estado === 'ACTIVO') {
        await asistenciaService.generarClasesFuturas(tx, {
          inscripcion_id: createdInsc.id,
          dia_semana: createdInsc.horarios_clases.dia_semana,
          usuario_admin_id: Number.parseInt(adminId),
          coordinador_id: createdInsc.horarios_clases.coordinador_id,
          fecha_inicio: createdInsc.fecha_inscripcion,
        })

        const hoy = new Date()
        hoy.setHours(12, 0, 0, 0)
        await tx.registros_asistencia.updateMany({
          where: {
            inscripcion_id: createdInsc.id,
            fecha: {
              gte: createdInsc.fecha_inscripcion,
              lt: hoy
            }
          },
          data: {
            estado: 'PRESENTE'
          }
        })
      }

      await tx.notificaciones.create({
        data: {
          alumno_id: createdInsc.alumno_id,
          titulo: `Cambio de Horario por el Administrador`,
          mensaje: `Tu horario ha sido modificado, verifica tu plan de entrenamiento.`,
          tipo: 'WARNING',
          categoria: 'SISTEMA',
        }
      });

      return createdInsc
    });
  },
  // ... al final de inscripcionService

  // =================================================================
  // 📅 ACTUALIZAR FECHA DE INICIO (Desde Validación de Pago)
  // =================================================================
  actualizarFechaInicioPorPago: async (cuentaId, nuevaFecha) => {
    return await prisma.$transaction(async (tx) => {
      // 1. Buscamos las inscripciones vinculadas a través de la tabla puente
      const links = await tx.inscripciones_deudas_link.findMany({
        where: { cuenta_id: Number.parseInt(cuentaId) }
      });

      if (links.length === 0) {
        throw new ApiError('No se encontraron inscripciones vinculadas a esta cuenta.', 404);
      }

      const idsInscripciones = links.map(l => l.inscripcion_id);
      const fechaFormateada = dayjs.tz(nuevaFecha, TZ_LIMA).startOf('day').toDate();

      // 2. Actualizamos las inscripciones
      // Nota: Actualizamos tanto fecha_inscripcion como fecha_inscripcion_original 
      // para que el historial sea consistente.
      await tx.inscripciones.updateMany({
        where: { id: { in: idsInscripciones } },
        data: {
          fecha_inscripcion: fechaFormateada,
          fecha_inscripcion_original: fechaFormateada,
          actualizado_en: new Date()
        }
      });

      console.log(`📅 [ADMIN] Se actualizó la fecha de inicio a ${nuevaFecha} para ${idsInscripciones.length} inscripciones.`);

      return {
        success: true,
        count: idsInscripciones.length,
        nueva_fecha: fechaFormateada
      };
    });
  },

  inscribirIndividual: async (data, tx = null) => {
    const { alumno_id, idHorario, fecha_inicio_electiva } = data;

    const ejecutar = async (tx) => {
      await Validators.validarMuroDeDeuda(tx, alumno_id);

      const conceptoAplicar = await tx.catalogo_conceptos.findFirst({
        where: {
          codigo_interno: 'CLASE_UNITARIA_2026',
          activo: true,
        }
      });

      if (!conceptoAplicar) {
        throw new ApiError(`⛔ No existe un plan para CLASE_UNITARIA_2026.`, 404);
      }

      const paramZ = await tx.parametros_sistema.findUnique({ where: { clave: 'TIEMPO_LIMITE_RESERVA_MIN' } });
      const fechaLimiteZombie = new Date(Date.now() - (paramZ ? parseInt(paramZ.valor) : 20) * 60 * 1000);

      const inicioReal = fecha_inicio_electiva
        ? dayjs.tz(fecha_inicio_electiva, TZ_LIMA).hour(12).toDate()
        : dayjs.tz(TZ_LIMA).hour(12).toDate();

      await Validators.validarAforoHorario(tx, idHorario, fechaLimiteZombie);

      const nuevaInscripcion = await tx.inscripciones.create({
        data: {
          alumno_id: parseInt(alumno_id),
          horario_id: idHorario,
          id_grupo_transaccion: null,
          estado: 'PENDIENTE_PAGO',
          fecha_inscripcion: inicioReal,
          fecha_inscripcion_original: inicioReal,
          tipo_inscripcion: 'INDIVIDUAL',
        },
        include: { horarios_clases: true }
      });

      let totalCobrar = Number(conceptoAplicar.precio_base);
      let detalleCobro = [`Plan Individual`];

      // // Si en caso se puede incluir camiseta en clase individual, se descomenta.
      // if (incluye_camiseta) {
      //   totalCobrar += 50;
      //   detalleCobro.push("Camiseta Oficial Gema");
      // }

      const nuevaCuenta = await tx.cuentas_por_cobrar.create({
        data: {
          alumno_id: parseInt(alumno_id),
          concepto_id: conceptoAplicar.id,
          monto_final: totalCobrar,
          detalle_adicional: detalleCobro.join(' | '),
          fecha_vencimiento: dayjs().tz(TZ_LIMA).add(2, 'day').endOf('day').toDate(), // 48 horas de reserva
          estado: 'PENDIENTE'
        }
      });

      await tx.inscripciones_deudas_link.create({
        data: {
          inscripcion_id: nuevaInscripcion.id,
          cuenta_id: nuevaCuenta.id,
          monto_asignado: totalCobrar,
        }
      });

      // // Si los beneficios y descuentos aplican tambien para las clases individuales, descomentamos lo siguiente y cambiamos el valor de total_a_pagar en notificaciones y en el return
      // const beneficiosEnCola = await tx.beneficios_pendientes.findMany({
      //   where: { alumno_id: parseInt(alumno_id), usado: false },
      //   include: { tipos_beneficio: true }
      // });

      // let montoActualizado = totalCobrar;
      // for (const pendiente of beneficiosEnCola) {
      //   const valorNominal = parseFloat(pendiente.tipos_beneficio.valor_por_defecto);
      //   let descuentoReal = pendiente.tipos_beneficio.es_porcentaje
      //     ? montoActualizado * (valorNominal / 100)
      //     : valorNominal;

      //   const descuentoFinal = descuentoReal > montoActualizado ? montoActualizado : descuentoReal;
      //   montoActualizado -= descuentoFinal;

      //   await tx.descuentos_aplicados.create({
      //     data: {
      //       cuenta_id: nuevaCuenta.id,
      //       tipo_beneficio_id: pendiente.tipo_beneficio_id,
      //       monto_nominal_aplicado: valorNominal,
      //       monto_dinero_descontado: descuentoFinal,
      //       motivo_detalle: pendiente.motivo || "Beneficio automático",
      //       aplicado_por: pendiente.asignado_por
      //     }
      //   });
      //   await tx.beneficios_pendientes.update({ where: { id: pendiente.id }, data: { usado: true } });
      // }

      // await tx.cuentas_por_cobrar.update({
      //   where: { id: nuevaCuenta.id },
      //   data: {
      //     monto_final: montoActualizado,
      //     estado: montoActualizado <= 0.01 ? 'PAGADA' : 'PENDIENTE'
      //   }
      // });

      await tx.notificaciones.create({
        data: {
          alumno_id: parseInt(alumno_id),
          titulo: '✅ Inscripción por Clase Única Generada',
          mensaje: `Se ha reservado tu cupo. Total: S/ ${totalCobrar.toFixed(2)}.`,
          tipo: 'SUCCESS',
          categoria: 'SISTEMA'
        }
      });

      return {
        mensaje: 'Inscripción procesada exitosamente.',
        total_a_pagar: totalCobrar,
        inscripcion: nuevaInscripcion
      };
    }

    try {
      if (tx) {
        return await ejecutar(tx);
      }
      return await prisma.$transaction(ejecutar);
    } catch (error) {
      console.error(`❌ [FALLO DURANTE INSCRIPCIÓN INDIVIDUAL] Alumno: ${alumno_id} | ${error.message}`);
      throw error;
    }
  },

  inscribirIndividualByAdmin: async (data) => {
    try {
      return await prisma.$transaction(async (tx) => {
        let results = [];
        for (const d of data) {
          const {
            alumno_id, idHorario, fecha_inicio_electiva,
            metodo_pago, codigo_operacion,
            usuario_admin_id
          } = d;

          const dataInsc = await inscripcionService.inscribirIndividual({ alumno_id: Number(alumno_id), idHorario: Number(idHorario), fecha_inicio_electiva }, tx);

          const deuda = await tx.inscripciones_deudas_link.findFirst({
            where: { inscripcion_id: dataInsc.inscripcion.id }
          })
          if (!deuda) throw new ApiError('Error durante la inscripción individual.', 404);
          const deuda_id = deuda.cuenta_id;
          const monto = deuda.monto_asignado;

          const dataPago = await pagosService.registrarPago({ deuda_id, monto, metodo_pago: Number(metodo_pago), codigo_operacion }, tx);

          const pago_id = dataPago.pago.id;
          const accion = 'APROBAR';
          const notas = 'Inscripción por clase única y pago realizados desde rol admin.'

          const resultado = await pagosService.validarPago({ pago_id, accion, usuario_admin_id: Number(usuario_admin_id), notas }, tx);

          results.push(resultado)
        }
        return results;
      })
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof PrismaClientKnownRequestError) throw new ApiError(e.message, 400, { prismaCode: e.code, meta: e.meta });
      throw new ApiError(e instanceof Error ? e.message : 'Error Interno', 500);
    }
  },
  // =================================================================
  // 📊 HISTORIAL HÍBRIDO (INSCRIPCIONES + MESES COBRADOS)
  // =================================================================
  obtenerHistorialCiclosAlumno: async (alumnoId) => {
    try {
      // 1. Buscamos todas las inscripciones del alumno y sus deudas asociadas
      const inscripcionesBrutas = await prisma.inscripciones.findMany({
        where: { alumno_id: parseInt(alumnoId) },
        include: {
          horarios_clases: {
            include: {
              canchas: { include: { sedes: true } },
              niveles_entrenamiento: true,
              coordinadores: { include: { usuarios: true } } // Útil para mostrar el profe en el front
            }
          },
          // Traemos los links de deudas ordenados por fecha de creación (ascendente)
          inscripciones_deudas_link: {
            include: {
              cuentas_por_cobrar: true
            },
            orderBy: {
              creado_en: 'asc'
            }
          }
        },
        orderBy: {
          fecha_inscripcion: 'desc' // Las inscripciones más recientes primero
        }
      });

      const historialMeses = [];

      // 2. Procesamos cada inscripción para extraer sus "Meses" (Ciclos)
      for (const inscripcion of inscripcionesBrutas) {
        const hc = inscripcion.horarios_clases;
        const linksDeuda = inscripcion.inscripciones_deudas_link;

        // Si la inscripción no tiene cuentas por cobrar generadas, igual la mostramos como el mes inicial
        if (linksDeuda.length === 0) {
          historialMeses.push({
            inscripcion_id: inscripcion.id,
            estado_inscripcion: inscripcion.estado,
            sede: hc?.canchas?.sedes?.nombre || 'S/D',
            nivel: hc?.niveles_entrenamiento?.nombre || 'S/D',
            profesor: hc?.coordinadores?.usuarios?.nombres || 'S/D',
            tipo_inscripcion: inscripcion.tipo_inscripcion,
            
            // Datos del Mes
            numero_mes_ciclo: 1,
            fecha_inicio_ciclo: inscripcion.fecha_inscripcion,
            fecha_corte_ciclo: null, // No hay deuda, no sabemos el corte exacto
            estado_pago_mes: 'SIN_CUENTA',
            monto_mes: 0,
            cuenta_id: null
          });
          continue;
        }

        // Si tiene deudas, iteramos sobre cada una representando un "Mes"
        linksDeuda.forEach((link, index) => {
          const cuenta = link.cuentas_por_cobrar;
          
          // Lógica de fechas
          // El mes 1 inicia con la fecha de la inscripción.
          // Los meses siguientes inician con la fecha de vencimiento de la cuenta anterior.
          let fechaInicioCiclo = inscripcion.fecha_inscripcion;
          if (index > 0) {
            fechaInicioCiclo = linksDeuda[index - 1].cuentas_por_cobrar.fecha_vencimiento;
          }

          historialMeses.push({
            inscripcion_id: inscripcion.id,
            estado_inscripcion: inscripcion.estado, // ACTIVO, INACTIVO, etc.
            sede: hc?.canchas?.sedes?.nombre || 'S/D',
            nivel: hc?.niveles_entrenamiento?.nombre || 'S/D',
            profesor: hc?.coordinadores?.usuarios?.nombres || 'S/D',
            tipo_inscripcion: inscripcion.tipo_inscripcion,
            
            // Datos del Mes
            numero_mes_ciclo: index + 1, // 1 para el primer mes, 2 para la renovación, etc.
            fecha_inicio_ciclo: fechaInicioCiclo,
            fecha_corte_ciclo: cuenta.fecha_vencimiento,
            estado_pago_mes: cuenta.estado, // PAGADO, PENDIENTE, VENCIDO
            monto_mes: Number(link.monto_asignado),
            cuenta_id: cuenta.id
          });
        });
      }

      // 3. Ordenar el resultado final (opcional, pero ayuda al front)
      // Ordenamos por la fecha de inicio del ciclo descendente (lo más nuevo arriba)
      historialMeses.sort((a, b) => new Date(b.fecha_inicio_ciclo) - new Date(a.fecha_inicio_ciclo));

      return historialMeses;

    } catch (error) {
      console.error(`❌ [ERROR OBTENER HISTORIAL MESES] Alumno: ${alumnoId} | ${error.message}`);
      throw new ApiError('Error al obtener el historial de ciclos del alumno', 500);
    }
  },
};


// --- HELPER (Calendario) ---
function contarClasesEnIntervalo(diaSemana, inicio, fin) {
  let contador = 0;
  let puntero = new Date(inicio);
  puntero.setHours(12, 0, 0, 0);
  let finFijo = new Date(fin);
  finFijo.setHours(23, 59, 59, 999);

  while (puntero <= finFijo) {
    if (puntero.getDay() === diaSemana) contador++;
    puntero.setDate(puntero.getDate() + 1);
  }
  return contador;
}