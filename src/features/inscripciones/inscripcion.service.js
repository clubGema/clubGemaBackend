import { prisma } from '../../config/database.config.js';

import * as Utils from './utils/inscripcion.util.js';
import * as Validators from './validators/inscripcion.validator.js';
import * as Logic from './logic/inscripcion.logic.js';

// 🔥 IMPORTAMOS DAYJS Y CONFIGURAMOS LIMA PARA LOS LOGS 🔥
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ_LIMA = 'America/Lima';

export const inscripcionService = {
  // =================================================================
  // 🚀 MOTOR MAESTRO DE INSCRIPCIÓN: GEMA ACADEMY (VERSIÓN FINAL)
  // =================================================================
  inscribirPaquete: async (data) => {
    const { alumno_id, horario_ids, fecha_inicio_electiva, incluye_camiseta } = data; // CAMBIO CAMBIO

    try {
      // 1. Validación de estructura de entrada
      Utils.validarInputInscripcion(horario_ids);

      return await prisma.$transaction(async (tx) => {
        // 🛡️ PASO 0: MUROS DE SEGURIDAD (Deuda y Recuperaciones)
        await Validators.validarMuroDeDeuda(tx, alumno_id);
        await Validators.validarSinRecuperacionesPendientes(tx, alumno_id);

        // 🕵️‍♂️ PASO 1: DETECTIVE DE RÉGIMEN Y CICLO
        const esAlumnoLegacy = await Logic.detectarRegimenAlumno(tx, alumno_id);
        const cicloInfo = await Logic.calcularCicloUpgrade(tx, alumno_id);
        
        // 🔥 MAGIA DE SINCRONIZACIÓN: Extraemos ambas fechas del nuevo objeto
        const fechaCorte = cicloInfo ? cicloInfo.fechaCorte : null;
        const fechaMadre = cicloInfo ? cicloInfo.fechaMadre : null;
        const esInscripcionAdicional = !!fechaCorte;

        // 👮‍♂️ PASO 2: VALIDACIÓN DE CAPACIDAD TOTAL (Combo Máximo Dinámico)
        const clasesAnteriores = await tx.inscripciones.count({
          where: { alumno_id: parseInt(alumno_id), estado: 'ACTIVO' }
        });
        const cantidadPeticion = horario_ids.length;
        const cantidadTotalFinal = clasesAnteriores + cantidadPeticion;

        // Buscamos el plan en el catálogo según el total acumulado
        const conceptoAplicar = await tx.catalogo_conceptos.findFirst({
          where: {
            cantidad_clases_semanal: esInscripcionAdicional ? cantidadTotalFinal : cantidadPeticion,
            activo: true,
            es_vigente: !esAlumnoLegacy
          }
        });

        // 🔥 FILTRO DE LÍMITE: Si no existe el plan, informamos el tope actual del catálogo
        if (!conceptoAplicar) {
          const planMaximo = await tx.catalogo_conceptos.findFirst({
            where: { activo: true, es_vigente: !esAlumnoLegacy },
            orderBy: { cantidad_clases_semanal: 'desc' }
          });
          const limiteMax = planMaximo ? planMaximo.cantidad_clases_semanal : 0;

          const mensajeError = esInscripcionAdicional
            ? `⛔ LÍMITE SUPERADO: Ya tienes ${clasesAnteriores} clases activas. No puedes sumar ${cantidadPeticion} más porque el límite máximo de Gema es de ${limiteMax} clases por alumno.`
            : `⛔ BLOQUEO DE PLAN: No puedes inscribirte a ${cantidadPeticion} clases. El plan más grande que ofrecemos es de ${limiteMax} clases.`;

          throw new Error(mensajeError);
        }

        // 🔥 PASO 2.5: BLOQUEO DE CIERRE DE CICLO (Anti-Limbo)
        if (esInscripcionAdicional) {
          const paramAnti = await tx.parametros_sistema.findUnique({ where: { clave: 'DIAS_ANTICIPACION_RENOVACION' } });
          const diasAnticipacion = paramAnti ? Number.parseInt(paramAnti.valor) : 5;
          const hoy = new Date();
          const diasRestantes = (fechaCorte.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24);

          if (diasRestantes <= diasAnticipacion) {
            throw new Error(`⛔ BLOQUEO DE CICLO: Estás a menos de ${Math.ceil(diasRestantes)} días de terminar tu mes. Espera al inicio de tu nuevo ciclo.`);
          }
        }

        // 🧟 PASO 3: CONFIGURACIÓN ANTI-ZOMBIE (Aforo)
        const paramZ = await tx.parametros_sistema.findUnique({ where: { clave: 'TIEMPO_LIMITE_RESERVA_MIN' } });
        const fechaLimiteZombie = new Date(Date.now() - (paramZ ? parseInt(paramZ.valor) : 20) * 60 * 1000);

        // 🧮 PASO 4: PREPARACIÓN DE PRECIO UNITARIO (Para Upgrades)
        let precioUnitarioOficial = 0;
        if (esInscripcionAdicional) {
          const codigoUnitario = esAlumnoLegacy ? 'CLASE_UNI_LEGACY' : 'CLASE_UNITARIA_2026';
          const conceptoUnitario = await tx.catalogo_conceptos.findFirst({
            where: { codigo_interno: codigoUnitario, activo: true }
          });
          precioUnitarioOficial = Number(conceptoUnitario?.precio_base || 0);
        }

        // 🔄 PASO 5: PROCESAR HORARIOS Y COBRO (Lógica Bipolar: Nuevo vs Upgrade)
        const inscripcionesCreadas = [];
        let totalCobrar = 0;
        let detalleCobro = [];
        
        // 🔥 AQUI DECLARAMOS LA VARIABLE PARA QUE NO FALLE
        const hoyInscripcion = new Date();  


       //CAMBIO CAMBIO CAMBIO
       // ✅ La forma correcta (usando la variable que ya extrajiste):
const inicioElectivo = fecha_inicio_electiva ? new Date(fecha_inicio_electiva) : new Date();

        for (const idHorario of horario_ids) {
          const horario = await Validators.validarAforoHorario(tx, idHorario, fechaLimiteZombie);
          let montoEsteHorario = 0;

          if (esInscripcionAdicional && fechaCorte) {
            // Caso Upgrade: Clases restantes hasta el corte * Precio Unitario
            const clasesRestantes = Utils.contarClasesEnIntervalo(horario.dia_semana, hoyInscripcion, fechaCorte);
            montoEsteHorario = clasesRestantes * precioUnitarioOficial;
            detalleCobro.push(`Upgrade ${horario.dia_semana} (${clasesRestantes} cl)`);
          } else {
            // Caso Nuevo: Precio del plan dividido entre horarios elegidos
            montoEsteHorario = Number(conceptoAplicar.precio_base) / cantidadPeticion;
            detalleCobro.push(`Mensualidad ${horario.dia_semana}`);
          }

          totalCobrar += montoEsteHorario;

          const nuevaInscripcion = await tx.inscripciones.create({
            data: {
              alumno_id: parseInt(alumno_id),
              horario_id: idHorario,
              estado: 'PENDIENTE_PAGO',
              // 🔥 MAGIA DE SINCRONIZACIÓN Y CREACIÓN
              fecha_inscripcion: (esInscripcionAdicional && fechaMadre) ? fechaMadre : inicioElectivo,  //CAMBIO CAMBIO CAMBIO cambiar hoyInscripcion por inicio efectivo
            },
            include: { horarios_clases: true }
          });
          inscripcionesCreadas.push(nuevaInscripcion);
        }

//  CAMBIO CAMBIO CAMBIO 
        if (incluye_camiseta) {
          totalCobrar += 50;
          detalleCobro.push("Camiseta Oficial Gema (S/ 50.00)");
        }

        // 💸 PASO 6: GENERAR DEUDA Y APLICAR BENEFICIOS
        if (totalCobrar > 0) {
          const nuevaCuenta = await tx.cuentas_por_cobrar.create({
            data: {
              alumno_id: parseInt(alumno_id),
              concepto_id: conceptoAplicar.id,
              detalle_adicional: [...new Set(detalleCobro)].join(' | '),
              monto_final: totalCobrar,
              fecha_vencimiento: esInscripcionAdicional ? fechaCorte : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
              estado: 'PENDIENTE'
            }
          });

          // Aplicación de Beneficios (Legacy & 2026)
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
                aplicado_por: pendiente.asignado_por,
                fecha_aplicacion: new Date()
              }
            });
            await tx.beneficios_pendientes.update({ where: { id: pendiente.id }, data: { usado: true } });
          }

          await tx.cuentas_por_cobrar.update({
            where: { id: nuevaCuenta.id },
            data: { monto_final: montoActualizado, estado: montoActualizado <= 0.01 ? 'PAGADA' : 'PENDIENTE' }
          });


        }


        // 🔔 PASO 7: NOTIFICACIÓN PARA EL DASHBOARD
        await tx.notificaciones.create({
          data: {
            alumno_id: parseInt(alumno_id),
            titulo: esInscripcionAdicional ? '🚀 Upgrade de Horario' : '✅ Inscripción Exitosa',
            mensaje: `Se ha generado tu reserva. Total a pagar: S/ ${totalCobrar.toFixed(2)}.`,
            tipo: 'SUCCESS',
            categoria: 'SISTEMA'
          }
        });

        return {
          mensaje: esInscripcionAdicional ? 'Upgrade procesado correctamente.' : 'Inscripción exitosa.',
          total_a_pagar: totalCobrar,
          inscripciones: inscripcionesCreadas
        };
      });

    } catch (error) {
      console.error(`❌ [FALLO MOTOR] Alumno: ${alumno_id} | ${error.message}`);
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
        horarios_clases: {
          include: {
            canchas: true,
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

      // 2. Aplicamos la misma lógica que "El Verdugo": Buscamos recuperaciones
      const tieneRecuperaciones = await tx.recuperaciones.findFirst({
        where: {
          alumno_id: inscripcion.alumno_id,
          estado: { in: ['PENDIENTE', 'PROGRAMADA'] }
        }
      });

      // Si tiene tickets de recuperación, lo mandamos al "Purgatorio" (PEN-RECU)
      // Si no tiene nada, se marca como FINALIZADO definitivamente
      const nuevoEstado = tieneRecuperaciones ? 'PEN-RECU' : 'FINALIZADO';

      const inscripcionActualizada = await tx.inscripciones.update({
        where: { id: Number.parseInt(id) },
        data: {
          estado: nuevoEstado,
          actualizado_en: new Date()
        }
      });

      console.log(`✅ [CANCELACIÓN] El alumno ${inscripcion.alumno_id} finalizó voluntariamente el horario ${inscripcion.horario_id}.`);

      return {
        success: true,
        mensaje: tieneRecuperaciones
          ? 'Inscripción finalizada. Aún tienes recuperaciones pendientes.'
          : 'Inscripción finalizada correctamente.',
        nuevo_estado: nuevoEstado
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
      const deudaAsociada = await tx.cuentas_por_cobrar.findFirst({
        where: {
          alumno_id: inscripcionSemilla.alumno_id,
          estado: 'PENDIENTE',
          creado_en: {
            gte: new Date(inscripcionSemilla.fecha_inscripcion.getTime() - 30000),
            lte: new Date(inscripcionSemilla.fecha_inscripcion.getTime() + 30000),
          },
        },
      });

      if (deudaAsociada) {
        // 3. EN CASCADA: Borramos todas las inscripciones que se crearon en ese mismo instante
        // Esto elimina el "paquete" completo (los 2 o 3 horarios que eligió)
        await tx.inscripciones.deleteMany({
          where: {
            alumno_id: inscripcionSemilla.alumno_id,
            estado: 'PENDIENTE_PAGO',
            fecha_inscripcion: {
              gte: new Date(inscripcionSemilla.fecha_inscripcion.getTime() - 2000),
              lte: new Date(inscripcionSemilla.fecha_inscripcion.getTime() + 2000),
            }
          }
        });

        // 4. Devolvemos beneficios si existían
        const descuentos = await tx.descuentos_aplicados.findMany({ where: { cuenta_id: deudaAsociada.id } });
        for (const desc of descuentos) {
          await tx.beneficios_pendientes.updateMany({
            where: { alumno_id: inscripcionSemilla.alumno_id, tipo_beneficio_id: desc.tipo_beneficio_id, usado: true },
            data: { usado: false },
          });
        }

        // 5. Borramos la deuda y sus relaciones
        await tx.descuentos_aplicados.deleteMany({ where: { cuenta_id: deudaAsociada.id } });
        await tx.cuentas_por_cobrar.delete({ where: { id: deudaAsociada.id } });
      }

      return { success: true, mensaje: 'Paquete de reserva cancelado íntegramente.' };
    });
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
