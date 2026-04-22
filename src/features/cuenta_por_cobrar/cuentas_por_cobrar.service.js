import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

export const CuentasPorCobrarService = {
  // Obtener todas las cuentas con los nombres exactos de tu schema
  async obtenerTodas() {
    return await prisma.cuentas_por_cobrar.findMany({
      include: {
        alumnos: {
          include: {
            usuarios: true, // Para traer el nombre del alumno desde la tabla usuarios
          },
        },
        catalogo_conceptos: true, // Nombre exacto según tu model cuentas_por_cobrar
      },
      orderBy: { creado_en: 'desc' },
    });
  },

  async crear(data) {
    // Iniciamos transacción para que la creación + descuento sean un solo bloque indivisible
    return await prisma.$transaction(async (tx) => {
      // 1. Crear la cuenta (Tu código original con tx)
      const nuevaCuenta = await tx.cuentas_por_cobrar.create({
        data: {
          alumno_id: parseInt(data.alumno_id),
          concepto_id: data.concepto_id ? parseInt(data.concepto_id) : null,
          detalle_adicional: data.detalle_adicional,
          monto_final: parseFloat(data.monto_final),
          fecha_vencimiento: new Date(data.fecha_vencimiento),
          estado: data.estado || 'PENDIENTE',
        },
      });

      // 2. BUSCAR BENEFICIOS PENDIENTES
      const beneficiosEnCola = await tx.beneficios_pendientes.findMany({
        where: {
          alumno_id: nuevaCuenta.alumno_id,
          usado: false,
        },
        include: { tipos_beneficio: true },
      });

      // 3. SI HAY BENEFICIOS, LOS APLICAMOS
      if (beneficiosEnCola.length > 0) {
        for (const pendiente of beneficiosEnCola) {
          // Calculamos el descuento (Reutilizando tu lógica de Porcentaje vs Monto Fijo)
          const deudaActual = parseFloat(nuevaCuenta.monto_final);
          const valorNominal = parseFloat(pendiente.tipos_beneficio.valor_por_defecto);

          let descuentoReal = pendiente.tipos_beneficio.es_porcentaje
            ? deudaActual * (valorNominal / 100)
            : valorNominal;

          // Protección contra saldos negativos
          const descuentoFinal = descuentoReal > deudaActual ? deudaActual : descuentoReal;
          const nuevoMonto = deudaActual - descuentoFinal;

          // A. Registrar en descuentos_aplicados
          await tx.descuentos_aplicados.create({
            data: {
              cuenta_id: nuevaCuenta.id,
              tipo_beneficio_id: pendiente.tipo_beneficio_id,
              monto_nominal_aplicado: valorNominal,
              monto_dinero_descontado: descuentoFinal,
              motivo_detalle: pendiente.motivo || 'Aplicación automática de beneficio pendiente',
              aplicado_por: pendiente.asignado_por,
              fecha_aplicacion: new Date(),
            },
          });

          // B. Actualizar el monto en la cuenta recién creada
          await tx.cuentas_por_cobrar.update({
            where: { id: nuevaCuenta.id },
            data: {
              monto_final: nuevoMonto,
              estado: nuevoMonto <= 0.01 ? 'PAGADA' : nuevaCuenta.estado,
              actualizado_en: new Date(),
            },
          });

          // C. Marcar el beneficio pendiente como USADO
          await tx.beneficios_pendientes.update({
            where: { id: pendiente.id },
            data: { usado: true },
          });
        }
      }

      // Retornamos la cuenta final (ya sea con descuento o sin él)
      return await tx.cuentas_por_cobrar.findUnique({
        where: { id: nuevaCuenta.id },
        include: { descuentos_aplicados: true, catalogo_conceptos: true },
      });
    });
  },

  async eliminar(id, restaurarBeneficios = false) {
  return await prisma.$transaction(async (tx) => {
    console.log(`🔍 [DEBUG] Iniciando eliminación de cuenta ID: ${id}`);

    const cuenta = await tx.cuentas_por_cobrar.findUnique({
      where: { id: parseInt(id) },
      include: { descuentos_aplicados: true, pagos: true },
    });

    if (!cuenta) {
      console.log(`⚠️ [DEBUG] La cuenta ${id} ya no existe.`);
      return;
    }

    // 🔥 PASO 0: LIMPIAR EL PUENTE (Integridad Referencial)
    console.log(`Step 0: Borrando vínculos en inscripciones_deudas_link...`);
    await tx.inscripciones_deudas_link.deleteMany({
      where: { cuenta_id: cuenta.id },
    });

    // PASO 1: Descuentos
    console.log(`Step 1: Borrando ${cuenta.descuentos_aplicados.length} descuentos...`);
    await tx.descuentos_aplicados.deleteMany({
      where: { cuenta_id: cuenta.id },
    });

    // PASO 2: Beneficios Pendientes
    if (restaurarBeneficios && cuenta.descuentos_aplicados.length > 0) {
      for (const desc of cuenta.descuentos_aplicados) {
        await tx.beneficios_pendientes.updateMany({
          where: {
            alumno_id: cuenta.alumno_id,
            tipo_beneficio_id: desc.tipo_beneficio_id,
            usado: true,
          },
          data: { usado: false },
        });
      }
    }

    // PASO 3: Pagos
    await tx.pagos.deleteMany({ where: { cuenta_id: cuenta.id } });

    // PASO 4: Borrado final
    const resultado = await tx.cuentas_por_cobrar.delete({
      where: { id: cuenta.id },
    });

    console.log(`🚀 [SUCCESS] Cuenta ${id} eliminada.`);
    return resultado;
  });
},

 async obtenerPorId(id) {
  const cuenta = await prisma.cuentas_por_cobrar.findUnique({
    where: { id: parseInt(id) },
    include: {
      alumnos: { include: { usuarios: true } },
      catalogo_conceptos: true,
      // 🚩 CLAVE 1: Traer todos los pagos asociados a esta cuenta
      // Esto permite que el Front sume los abonos previos.
      pagos: {
        include: { metodos_pago: true }
      },
      // 🚩 CLAVE 2: Traer los horarios vinculados
      // Esto permite que el Admin vea el "Plan de Entrenamiento" en la validación.
      inscripciones_deudas_link: {
        include: {
          inscripciones: {
            include: {
              horarios_clases: {
                include: {
                  canchas: { include: { sedes: true } },
                  niveles_entrenamiento: true
                }
              }
            }
          }
        }
      }
    },
  });

  if (!cuenta) throw new Error('Cuenta no encontrada');
  return cuenta;
},

  async actualizar(id, data) {
    return await prisma.cuentas_por_cobrar.update({
      where: { id: parseInt(id) },
      data: {
        alumno_id: data.alumno_id ? parseInt(data.alumno_id) : undefined,
        concepto_id: data.concepto_id ? parseInt(data.concepto_id) : undefined,
        detalle_adicional: data.detalle_adicional,
        monto_final: data.monto_final ? parseFloat(data.monto_final) : undefined,
        fecha_vencimiento: data.fecha_vencimiento ? new Date(data.fecha_vencimiento) : undefined,
        estado: data.estado,
        actualizado_en: new Date(),
      },
    });
  },

obtenerTodoPorAlumno: async (alumnoId) => {
  try {
    return await prisma.cuentas_por_cobrar.findMany({
      where: {
        alumno_id: Number.parseInt(alumnoId),
      },
      include: {
        // Traemos el concepto (Plan 2 clases, etc.)
        catalogo_conceptos: true,
        
        // Traemos los pagos reportados para calcular saldos en el Front
        pagos: {
          where: {
            estado_validacion: { not: 'RECHAZADO' }
          }
        },

        // 🚩 IMPORTANTE: Navegamos por el link para saber qué clases están amarradas a esta deuda
        inscripciones_deudas_link: {
          include: {
            inscripciones: {
              include: {
                horarios_clases: true
              }
            }
          }
        }
      },
      orderBy: {
        creado_en: 'desc',
      },
    });
  } catch (error) {
    console.error("Error en obtenerTodoPorAlumno Service:", error);
    throw error;
  }
},

  // eslint-disable-next-line no-dupe-keys
  async eliminar(id) {
    return await prisma.cuentas_por_cobrar.delete({
      where: { id: parseInt(id) },
    });
  },

 // 1. CEREBRO DE FECHAS: Busca la clase más lejana de todo el paquete
  async obtenerFechaSugeridaPaquete(grupoUuid) {
  try {
    // 1. Buscamos las inscripciones y los días de semana que entrena el alumno
    const inscripciones = await prisma.inscripciones.findMany({
      where: { id_grupo_transaccion: grupoUuid },
      include: { 
        horarios_clases: { select: { dia_semana: true } } 
      }
    });

    if (!inscripciones.length) return [dayjs().format('YYYY-MM-DD')];

    // Mapeamos los días de clase (Ej: [1, 3] para Lunes y Miércoles)
    const diasPermitidos = inscripciones.map(i => i.horarios_clases.dia_semana);
    const ids = inscripciones.map(i => i.id);

    // 2. Buscamos la última asistencia registrada para saber dónde terminó su ciclo anterior
    const ultimaAsistencia = await prisma.registros_asistencia.findFirst({
      where: { 
        inscripcion_id: { in: ids },
        estado: { not: 'FALTA_JUSTIFICADA' } 
      },
      orderBy: { fecha: 'desc' }
    });

    // Definimos el punto de partida para buscar el siguiente ciclo
    let fechaCursor = ultimaAsistencia 
      ? dayjs(ultimaAsistencia.fecha).add(1, 'day') 
      : dayjs(inscripciones[0].fecha_inscripcion).add(30, 'day');

    const sugerencias = [];
    
    // 🧠 LÓGICA DE BÚSQUEDA DE SLOTS REALES
    // Buscamos hacia adelante hasta encontrar las 3 fechas que coinciden con sus días de clase
    while (sugerencias.length < 3) {
      // .day() de dayjs devuelve: 0 para Domingo, 1 para Lunes... igual que tu DB
      if (diasPermitidos.includes(fechaCursor.day())) {
        sugerencias.push(fechaCursor.format('YYYY-MM-DD'));
      }
      fechaCursor = fechaCursor.add(1, 'day');
      
      // Seguridad para evitar bucles infinitos en caso de data inconsistente
      if (sugerencias.length === 0 && fechaCursor.isAfter(dayjs().add(2, 'month'))) break;
    }

    // Retornamos el array de 3 fechas [F1, F2, F3]
    return sugerencias;

  } catch (error) {
    console.error("❌ Error calculando fechas sugeridas:", error);
    // Fallback: Retornamos un array con hoy si algo falla estrepitosamente
    return [dayjs().format('YYYY-MM-DD')];
  }
},

  // 2. MOTOR DE RENOVACIÓN: Procesa el paquete completo
async generarRenovacionPaquete(grupoUuid, fechaInicioNueva) {
  return await prisma.$transaction(async (tx) => {
    const paqueteActual = await tx.inscripciones.findMany({
      where: { id_grupo_transaccion: grupoUuid, estado: 'ACTIVO' }
    });

    if (paqueteActual.length === 0) throw new Error("No hay horarios activos.");

    const conceptoPaquete = await tx.catalogo_conceptos.findFirst({
      where: { cantidad_clases_semanal: paqueteActual.length, activo: true }
    });

    const montoTotal = Number(conceptoPaquete.precio_base);
    const fechaOriginalParaRevertir = paqueteActual[0].fecha_inscripcion;

    // 🚩 CAMBIO AQUÍ: Guardamos el "REVERTIR_A" en el detalle de la CUENTA
    const nuevaCuenta = await tx.cuentas_por_cobrar.create({
      data: {
        alumno_id: paqueteActual[0].alumno_id,
        concepto_id: conceptoPaquete.id,
        monto_final: montoTotal,
        detalle_adicional: `RENOVACION|FECHA_ANT:${dayjs(fechaOriginalParaRevertir).format('YYYY-MM-DD')}|Ciclo:${dayjs(fechaInicioNueva).format('MMMM')}`,
        fecha_vencimiento: dayjs().add(2, 'day').toDate(),
        estado: 'PENDIENTE'
      }
    });

    const montoPorSlot = montoTotal / paqueteActual.length;

    for (const ins of paqueteActual) {
      await tx.inscripciones.update({
        where: { id: ins.id },
        data: { 
          fecha_inscripcion: dayjs(fechaInicioNueva).toDate(),
          actualizado_en: new Date()
        }
      });

      // 🚩 QUITAMOS EL CAMPO 'notas' de aquí para que no explote
      await tx.inscripciones_deudas_link.create({
        data: {
          inscripcion_id: ins.id, 
          cuenta_id: nuevaCuenta.id,
          monto_asignado: montoPorSlot
        }
      });
    }

    return { success: true, cuenta_id: nuevaCuenta.id };
  });
}
  
};
