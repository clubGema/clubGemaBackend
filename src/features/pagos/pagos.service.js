import { prisma } from '../../config/database.config.js';
import { asistenciaService } from '../asistencia/asistencia.service.js';
import { cloudinaryService } from '../cloudinaryImg/cloudinary.service.js';
import * as Validators from './validators/pagos.validator.js';
import * as Logic from './logic/pagos.logic.js';
import * as Utils from './utils/pagos.util.js';
import { notificacionesService } from '../notificaciones/notificaciones.service.js';

export const pagosService = {
  // 1. REGISTRAR EL PAGO (Integrado con Cloudinary 🚀)
  registrarPago: async (data) => {
    // 1. Validar input básico
    Utils.validarInputPago(data);
    const { deuda_id, monto, metodo_pago, codigo_operacion, voucher_url, voucherFile } = data;

    // 📸 PASO 0: SUBIR IMAGEN A CLOUDINARY (si se envió un archivo)
    let imageUrl = voucher_url || null;

    if (voucherFile) {
      try {
        const cloudinaryResponse = await cloudinaryService.upload(voucherFile, 'yape');
        imageUrl = cloudinaryResponse.url;
      } catch (error) {
        throw new Error(`Error al subir la imagen a Cloudinary: ${error.message}`);
      }
    }

    return await prisma.$transaction(async (tx) => {
      // 🛡️ PASO A: VALIDAR LA DEUDA
      const deuda = await Validators.validarDeudaParaPago(tx, deuda_id);
      // 🔥 NUEVA REGLA: LOS UPGRADES NO ACEPTAN PAGOS PARCIALES
      const esUpgrade = deuda.detalle_adicional && deuda.detalle_adicional.includes('Upgrade');
      // Usamos una tolerancia de 0.01 céntimos por si hay problemas de redondeo en JS
      if (esUpgrade && parseFloat(monto) < (parseFloat(deuda.monto_final) - 0.01)) {
        throw new Error(`⛔ PAGO DENEGADO: Los Upgrades de horario no aceptan pagos a medias. Debes cancelar el monto total exacto de S/ ${deuda.monto_final}.`);
      }

      // 💳 PASO B: RESOLVER EL MÉTODO DE PAGO
      const metodoPagoId = await Logic.resolverMetodoPagoId(tx, metodo_pago);

      // 📝 PASO C: CREAR EL REGISTRO DE PAGO
      const nuevoPago = await tx.pagos.create({
        data: {
          cuenta_id: parseInt(deuda_id),
          metodo_pago_id: metodoPagoId,
          monto_pagado: parseFloat(monto),
          url_comprobante: imageUrl,
          codigo_operacion: codigo_operacion || 'S/N',
          estado_validacion: 'PENDIENTE',
          fecha_pago: new Date(),
        },
      });

      // 🔄 PASO D: ACTUALIZAR ESTADOS (Inmunidad temporal contra el Francotirador)
      await tx.cuentas_por_cobrar.update({
        where: { id: parseInt(deuda_id) },
        data: { estado: 'POR_VALIDAR', actualizado_en: new Date() },
      });

      const inscripcionesUpdate = await tx.inscripciones.updateMany({
        where: { alumno_id: deuda.alumno_id, estado: 'PENDIENTE_PAGO' },
        data: { estado: 'POR_VALIDAR', actualizado_en: new Date() },
      });

      return {
        success: true,
        mensaje: 'Pago registrado exitosamente. Esperando validación.',
        pago: nuevoPago,
        cupos_asegurados: inscripcionesUpdate.count,
      };
    });
  },

// 2. VALIDAR EL PAGO (Tu lógica + Corrección de Monto + Sincronización de Fechas 🛡️)
 validarPago: async (data) => {
    const { pago_id, accion, usuario_admin_id, notas, monto_real_confirmado } = data;
    const esAprobado = accion === 'APROBAR';

    if (!['APROBAR', 'RECHAZAR'].includes(accion)) {
      throw new Error('La acción debe ser APROBAR o RECHAZAR.');
    }

    return await prisma.$transaction(async (tx) => {
      // 🛡️ PASO 1: Buscar y Validar el pago
      let pago = await Validators.buscarYValidarPagoPendiente(tx, pago_id);

      // 👮‍♂️ PASO 2: Corrección de Monto por el Admin
      if (esAprobado && monto_real_confirmado) {
        const montoAdmin = Number.parseFloat(monto_real_confirmado);
        if (montoAdmin !== Number(pago.monto_pagado)) {
          pago = await tx.pagos.update({
            where: { id: pago.id },
            data: {
              monto_pagado: montoAdmin,
              notas_validacion: `Monto corregido por Admin. (Reportado: ${pago.monto_pagado})`,
            },
            include: { cuentas_por_cobrar: true },
          });
        }
      }

      // 💰 PASO 3: Lógica de Alcancía
      let saldoRestante = 0;
      let esPagoCompleto = false;

      if (esAprobado) {
        const saldos = await Logic.calcularSaldosAlcancía(tx, pago);
        saldoRestante = saldos.saldoRestante;
        esPagoCompleto = saldos.esPagoCompleto;
      }

      // 🔄 PASO 4: Determinar Evolución de Estados
      const { nuevoEstadoDeuda, activarAlumno } = await Logic.definirEvolucionDeEstados(
        tx,
        pago,
        esAprobado,
        esPagoCompleto
      );

      // 📝 PASO 5: Actualizar el Pago y la Deuda
      const notaFinalInformativa = esAprobado
        ? esPagoCompleto
          ? 'PAGO TOTAL'
          : `ABONO PARCIAL. Resta: S/ ${saldoRestante.toFixed(2)}`
        : 'Rechazado';

      const notasFinales = `${notas || ''} ${pago.notas_validacion || ''} | ${notaFinalInformativa}`;

      const pagoActualizado = await tx.pagos.update({
        where: { id: pago.id },
        data: {
          estado_validacion: esAprobado ? 'APROBADO' : 'RECHAZADO',
          revisado_por: Number.parseInt(usuario_admin_id),
          notas_validacion: notasFinales,
          fecha_pago: new Date(),
        },
      });

      await tx.cuentas_por_cobrar.update({
        where: { id: pago.cuenta_id },
        data: { estado: nuevoEstadoDeuda },
      });

      // 🎓 PASO 6: Gestión de Inscripciones y Asistencias
      if (activarAlumno) {
        const esRenovacion =
          pago.cuentas_por_cobrar.detalle_adicional?.includes('Renovación Automática');

        if (esRenovacion) {
          // ==========================================
          // CAMINO A: RENOVACIÓN UNIFICADA (Fecha Madre + 1)
          // ==========================================
          const inscripcionesActivas = await tx.inscripciones.findMany({
            where: {
              alumno_id: pago.cuentas_por_cobrar.alumno_id,
              estado: { in: ['ACTIVO', 'VENCIDO'] },
            },
            include: { horarios_clases: true },
          });

          if (inscripcionesActivas.length > 0) {
            // 🌟 Encontrar la Fecha Madre (la más antigua)
            const fechas = inscripcionesActivas.map((i) => new Date(i.fecha_inscripcion).getTime());
            const fechaMadre = new Date(Math.min(...fechas));

            // 🕰️ Calcular fin del ciclo actual (Día 30)
            const finCicloActual = new Date(fechaMadre);
            finCicloActual.setDate(finCicloActual.getDate() + 30);

            const hoy = new Date();
            let fechaInicioNuevoCiclo;

            if (hoy < finCicloActual) {
              // CASO 1: Pago temprano. Nuevo ciclo arranca el día SIGUIENTE al vencimiento (Día 31 real)
              fechaInicioNuevoCiclo = new Date(finCicloActual);
              fechaInicioNuevoCiclo.setDate(fechaInicioNuevoCiclo.getDate() + 1);
            } else {
              // CASO 2: Pago en prórroga. Nuevo ciclo arranca HOY.
              fechaInicioNuevoCiclo = hoy;
            }

            // =================================================================
            // 🔥 INICIO DE CÓDIGO NUEVO AÑADIDO: OVERRIDE DE RECUPERACIONES 🔥
            // =================================================================
            const ultimaRecuperacion = await tx.recuperaciones.findFirst({
              where: {
                alumno_id: pago.cuentas_por_cobrar.alumno_id,
                fecha_programada: { not: null } 
              },
              orderBy: { fecha_programada: 'desc' }
            });

            if (ultimaRecuperacion && ultimaRecuperacion.fecha_programada) {
              const fechaPostRecuperacion = new Date(ultimaRecuperacion.fecha_programada);
              fechaPostRecuperacion.setDate(fechaPostRecuperacion.getDate() + 1); // El día siguiente a su recuperación

              // Si el día después de su última recuperación es MAYOR a la fecha calculada, gana la recuperación
              if (fechaPostRecuperacion > fechaInicioNuevoCiclo) {
                fechaInicioNuevoCiclo = fechaPostRecuperacion;
                console.log(`🚀 [OVERRIDE] Fecha ajustada por recuperación. Nuevo inicio: ${fechaInicioNuevoCiclo.toLocaleDateString()}`);
              }
            }
            // =================================================================
            // 🔥 FIN DE CÓDIGO NUEVO AÑADIDO 🔥
            // =================================================================

            for (const inscripcion of inscripcionesActivas) {
              await tx.inscripciones.update({
                where: { id: inscripcion.id },
                data: {
                  fecha_inscripcion: fechaInicioNuevoCiclo,
                  fecha_inscripcion_original: fechaInicioNuevoCiclo,
                  estado: 'ACTIVO',
                  actualizado_en: hoy,
                },
              });

              await asistenciaService.generarClasesFuturas(tx, {
                inscripcion_id: inscripcion.id,
                dia_semana: inscripcion.horarios_clases.dia_semana,
                usuario_admin_id: Number.parseInt(usuario_admin_id),
                coordinador_id: inscripcion.horarios_clases.coordinador_id,
                fecha_inicio: fechaInicioNuevoCiclo,
              });
            }
          }
        } else {
          // ==========================================
          // CAMINO B: ALUMNOS NUEVOS O UPGRADES
          // ==========================================
          const inscripciones = await tx.inscripciones.findMany({
            where: {
              alumno_id: pago.cuentas_por_cobrar.alumno_id,
              estado: { in: ['POR_VALIDAR', 'PENDIENTE_PAGO'] },
            },
            include: { horarios_clases: true },
          });

          for (const inscripcion of inscripciones) {
          
            //CAMBIO CAMBIO CAMBIO
             const fechaInicioReal = inscripcion.fecha_inscripcion; 

            await tx.inscripciones.update({
              where: { id: inscripcion.id },
              data: { estado: 'ACTIVO', actualizado_en: new Date() },
            });

            await asistenciaService.generarClasesFuturas(tx, {
              inscripcion_id: inscripcion.id,
              dia_semana: inscripcion.horarios_clases.dia_semana,
              usuario_admin_id: Number.parseInt(usuario_admin_id),
              coordinador_id: inscripcion.horarios_clases.coordinador_id,
              fecha_inicio: fechaInicioReal,   // const fechaInicioReal //CAMBIO CAMBIO CAMBIO
            });
          }
        }
      } else if (!esAprobado) {
        await tx.inscripciones.updateMany({
          where: {
            alumno_id: pago.cuentas_por_cobrar.alumno_id,
            estado: 'POR_VALIDAR',
          },
          data: { estado: 'PENDIENTE_PAGO' },
        });
      }

      // =================================================================
      // 🔔 PASO 7: NOTIFICACIÓN AUTOMÁTICA AL ALUMNO
      // =================================================================
      await notificacionesService.crear({
        alumnoId: pago.cuentas_por_cobrar.alumno_id,
        titulo: esAprobado ? '✅ Pago Aprobado' : '❌ Pago Rechazado',
        mensaje: esAprobado
          ? `Tu pago de S/ ${pagoActualizado.monto_pagado.toFixed(2)} ha sido validado. ${esPagoCompleto ? '¡Tu ciclo está activo!' : 'Se registró como abono parcial.'}`
          : `Tu reporte de pago por S/ ${pagoActualizado.monto_pagado.toFixed(2)} fue rechazado. Revisa las observaciones en tu perfil.`,
        tipo: esAprobado ? 'SUCCESS' : 'DANGER',
        categoria: 'PAGOS',
      });

      return {
        resultado: Utils.generarMensajeResultado(accion, esPagoCompleto, saldoRestante),
        pago: pagoActualizado,
        saldo_pendiente: saldoRestante,
      };
    });
  }, 
  obtenerTodos: async () => {
    return await prisma.pagos.findMany({
      include: {
        cuentas_por_cobrar: {
          include: { alumnos: { include: { usuarios: true } } },
        },
        metodos_pago: true,
        administrador: { include: { usuarios: true } },
      },
      orderBy: { fecha_pago: 'desc' },
    });
  },

  // =====================================================================
  // ⚡ NUEVO: VENTA EXPRESS (Taquilla para Clases Sueltas)
  // =====================================================================
  registrarVentaExpress: async (data, adminId) => {
    const {
      alumno_id,
      monto,
      metodo_pago_id,
      nombre_visitante,
      telefono,
      horario_texto
    } = data;

    return await prisma.$transaction(async (tx) => {
      // 1. Crear una deuda "Fantasma" que ya nace pagada
      const nuevaDeuda = await tx.cuentas_por_cobrar.create({
        data: {
          alumno_id: parseInt(alumno_id),
          // Guardamos los datos de la visita en el detalle
          detalle_adicional: `Pase Invitado: ${nombre_visitante} | Cel: ${telefono || 'N/A'} | Clase: ${horario_texto}`,
          monto_final: parseFloat(monto),
          fecha_vencimiento: new Date(),
          estado: 'PAGADA'
        }
      });

      // 2. Registrar el pago ya aprobado por el Admin
      const nuevoPago = await tx.pagos.create({
        data: {
          cuenta_id: nuevaDeuda.id,
          metodo_pago_id: parseInt(metodo_pago_id),
          monto_pagado: parseFloat(monto),
          codigo_operacion: `VISITA-${Date.now().toString().slice(-6)}`,
          estado_validacion: 'APROBADO',
          revisado_por: parseInt(adminId), // Eddy aprueba su propia venta
          notas_validacion: 'Venta rápida en Taquilla'
        }
      });

      // 3. Notificar al sistema para auditoría
      await tx.notificaciones.create({
        data: {
          usuario_id: parseInt(adminId),
          titulo: '🎟️ Pase Generado',
          mensaje: `Se vendió una clase suelta a ${nombre_visitante} por S/ ${monto}.`,
          tipo: 'SUCCESS',
          categoria: 'VENTAS'
        }
      });

      return {
        success: true,
        mensaje: `Pase registrado para ${nombre_visitante}`,
        deuda: nuevaDeuda,
        pago: nuevoPago
      };
    });
  },

  // 4. OBTENER PAGO POR ID
  obtenerPorId: async (id) => {
    const pago = await prisma.pagos.findUnique({
      where: { id: Number.parseInt(id) },
      include: {
        cuentas_por_cobrar: true,
        metodos_pago: true,
      },
    });
    if (!pago) throw new Error('El pago no existe.');
    return pago;
  },

  obtenerPorAlumno: async (alumnoId) => {
    return await prisma.pagos.findMany({
      where: {
        cuentas_por_cobrar: {
          alumno_id: Number.parseInt(alumnoId),
        },
      },
      include: {
        cuentas_por_cobrar: {
          include: {
            alumnos: {
              include: { usuarios: true },
            },
          },
        },
        metodos_pago: true,
        administrador: {
          include: { usuarios: true },
        },
      },
      orderBy: { fecha_pago: 'desc' },
    });
  },

  obtenerTodosParaAdmin: async () => {
    const pagos = await prisma.pagos.findMany({
      include: {
        cuentas_por_cobrar: {
          include: { 
            alumnos: { 
              include: { 
                usuarios: {
                  select: { 
                    nombres: true, 
                    apellidos: true, 
                    numero_documento: true, 
                    email: true, 
                    telefono_personal: true 
                  }
                },
                _count: {
                  select: {
                    recuperaciones: {
                      where: { estado: { in: ['PENDIENTE', 'PROGRAMADA'] } }
                    }
                  }
                }
              } 
            } 
          },
        },
        metodos_pago: true,
      },
      orderBy: { fecha_pago: 'desc' },
    });

    // Mapeamos para enviar un flag simple 'bloqueado_por_asistencia'
    return pagos.map(p => ({
      ...p,
      bloqueado_por_asistencia: (p.cuentas_por_cobrar?.alumnos?._count?.recuperaciones || 0) > 0
    }));
  },

  // 5. ELIMINAR REGISTRO DE PAGO (Uso delicado)
  eliminarPago: async (id) => {
    return await prisma.pagos.delete({
      where: { id: Number.parseInt(id) },
    });
  },
};
