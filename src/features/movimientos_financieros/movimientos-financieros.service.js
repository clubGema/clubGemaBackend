import { PrismaClient } from '@prisma/client';
import { ApiError } from '../../shared/utils/error.util.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
const prisma = new PrismaClient();

const getMonthLocal = (fecha) => {
    const date = new Date(fecha)
    return Number(
        new Intl.DateTimeFormat("es-PE", {
            timeZone: "America/Lima",
            month: "numeric",
        }).format(date)
    );
}

export const movimientosFinancierosService = {
    // Obtener todos los movimientos (con opción a filtrar por tipo)
    obtenerTodos: async (filtros = {}) => {
        const { tipo_movimiento, fecha_inicio, fecha_fin } = filtros;

        let where = {};

        if (tipo_movimiento) {
            where.tipo_movimiento = tipo_movimiento.toUpperCase();
        }

        if (fecha_inicio || fecha_fin) {
            where.fecha_movimiento = {};
            if (fecha_inicio) where.fecha_movimiento.gte = new Date(fecha_inicio);
            if (fecha_fin) where.fecha_movimiento.lte = new Date(fecha_fin);
        }

        return await prisma.movimientos_financieros.findMany({
            where,
            orderBy: { fecha_movimiento: 'desc' },
            include: {
                metodos_pago: { select: { nombre: true } },
                administrador: {
                    select: {
                        usuarios: { select: { nombres: true, apellidos: true } }
                    }
                }
            }
        });
    },

    // Obtener un movimiento por ID
    obtenerPorId: async (id) => {
        return await prisma.movimientos_financieros.findUnique({
            where: { id: parseInt(id) },
            include: {
                metodos_pago: { select: { nombre: true } },
                administrador: {
                    select: {
                        usuarios: { select: { nombres: true, apellidos: true } }
                    }
                }
            }
        });
    },

    // Crear un nuevo movimiento (Ingreso o Egreso)
    crear: async (data, usuario_id) => {
        const mesHoy = getMonthLocal(new Date());
        const mesData = getMonthLocal(data.fecha_movimiento);
        if (mesData > mesHoy) throw new ApiError('Debe registrar el ingreso/egreso en el mes actual.', 400)
        return await prisma.movimientos_financieros.create({
            data: {
                tipo_movimiento: data.tipo_movimiento.toUpperCase(),
                monto: data.monto,
                concepto: data.concepto,
                metodo_pago_id: data.metodo_pago_id,
                fecha_movimiento: data.fecha_movimiento ? new Date(data.fecha_movimiento) : new Date(),
                comprobante_url: data.comprobante_url,
                registrado_por: usuario_id, // ID del administrador que está haciendo la petición
                notas: data.notas,
                sede_id: data.sede_id,
            }
        });
    },

    // Actualizar un movimiento (Ej: si se equivocaron en el monto o concepto)
    actualizar: async (id, data) => {
        const mesHoy = getMonthLocal(new Date());
        const mesData = getMonthLocal(data.fecha_movimiento);
        if (mesData > mesHoy) throw new ApiError('Debe actualizar el ingreso/egreso en el mes actual.', 400);
        return await prisma.movimientos_financieros.update({
            where: { id: parseInt(id) },
            data: {
                tipo_movimiento: data.tipo_movimiento ? data.tipo_movimiento.toUpperCase() : undefined,
                monto: data.monto,
                concepto: data.concepto,
                metodo_pago_id: data.metodo_pago_id,
                comprobante_url: data.comprobante_url,
                notas: data.notas,
                sede_id: data.sede_id,
                fecha_movimiento: data.fecha_movimiento,
                // La fecha_movimiento y registrado_por rara vez deberían cambiar tras la creación
            }
        });
    },
    obtenerResumenMensual: async (mes, anio) => {
    const mesInt = parseInt(mes);
    const anioInt = parseInt(anio);
    const fechaInicio = new Date(anioInt, mesInt - 1, 1);
    const fechaFin = new Date(anioInt, mesInt, 0, 23, 59, 59);

    // 1. Consulta desde el origen: PAGOS (Automáticos)
    const ingresos = await prisma.pagos.findMany({
        where: {
            estado_validacion: 'APROBADO',
            fecha_pago: { gte: fechaInicio, lte: fechaFin }
        },
        include: {
            cuentas_por_cobrar: {
                include: {
                    alumnos: { include: { usuarios: true } },
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
                }
            }
        }
    });

    const reporte = {};

    // 2. Procesamiento de PAGOS
    ingresos.forEach(pago => {
        const links = pago.cuentas_por_cobrar?.inscripciones_deudas_link || [];
        links.forEach(link => {
            const insc = link.inscripciones;
            const sede = insc?.horarios_clases?.canchas?.sedes?.nombre || 'GENERAL';
            const nivel = insc?.horarios_clases?.niveles_entrenamiento?.nombre || 'GENERAL';

            if (!reporte[sede]) reporte[sede] = { niveles: {}, egresos: [], ingresosManuales: [] };
            if (!reporte[sede].niveles[nivel]) reporte[sede].niveles[nivel] = { ingresos: [] };

            reporte[sede].niveles[nivel].ingresos.push({
                id: pago.id,
                concepto: `PAGO - ${nivel} | ${0.5} FTE`,
                monto: (pago.monto_pagado / links.length).toString(),
                fecha: pago.fecha_pago,
                alumno: pago.cuentas_por_cobrar?.alumnos?.usuarios 
                    ? `${pago.cuentas_por_cobrar.alumnos.usuarios.nombres} ${pago.cuentas_por_cobrar.alumnos.usuarios.apellidos}` 
                    : 'N/A'
            });
        });
    });

    // 3. NUEVO: Consulta de MOVIMIENTOS FINANCIEROS (Ingresos/Egresos Manuales)
    const movimientos = await prisma.movimientos_financieros.findMany({
        where: {
            fecha_movimiento: { gte: fechaInicio, lte: fechaFin }
        },
        include: { sedes: true }
    });

    movimientos.forEach(mov => {
        const sede = mov.sedes?.nombre || 'GENERAL';
        
        // Asegurar que la sede exista en el reporte
        if (!reporte[sede]) reporte[sede] = { niveles: {}, egresos: [], ingresosManuales: [] };
        if (!reporte[sede].egresos) reporte[sede].egresos = [];
        if (!reporte[sede].ingresosManuales) reporte[sede].ingresosManuales = [];

        if (mov.tipo_movimiento === 'INGRESO') {
            reporte[sede].ingresosManuales.push({
                id: mov.id,
                concepto: mov.concepto,
                monto: mov.monto.toString(),
                fecha: mov.fecha_movimiento,
                registrado_por: mov.registrado_por // Opcional: si quieres mostrar quién lo hizo
            });
        } else if (mov.tipo_movimiento === 'EGRESO') {
            reporte[sede].egresos.push({
                id: mov.id,
                concepto: mov.concepto,
                monto: mov.monto.toString(),
                fecha: mov.fecha_movimiento
            });
        }
    });

    return reporte;
},

    // Eliminar un movimiento (Opcional, a veces en finanzas es mejor "anular" que borrar)
    eliminar: async (id) => {
        try {
            return await prisma.movimientos_financieros.delete({
                where: { id: parseInt(id) }
            });
        } catch (e) {
            if (e instanceof PrismaClientKnownRequestError) throw new ApiError(e.message, 400, { prismaCode: e.code, meta: e.meta });
            throw new ApiError(e instanceof Error ? e.message : 'Error Interno', 500);
        }
    },

    // Obtener balance de caja (Total Ingresos - Total Egresos)
    obtenerBalance: async () => {
        const ingresos = await prisma.movimientos_financieros.aggregate({
            _sum: { monto: true },
            where: { tipo_movimiento: 'INGRESO' }
        });

        const egresos = await prisma.movimientos_financieros.aggregate({
            _sum: { monto: true },
            where: { tipo_movimiento: 'EGRESO' }
        });

        const totalIngresos = ingresos._sum.monto || 0;
        const totalEgresos = egresos._sum.monto || 0;

        return {
            ingresos: totalIngresos,
            egresos: totalEgresos,
            balance: totalIngresos - totalEgresos
        };
    }
};