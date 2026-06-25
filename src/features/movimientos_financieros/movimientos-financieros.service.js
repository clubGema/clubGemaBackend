import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

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
        return await prisma.movimientos_financieros.create({
            data: {
                tipo_movimiento: data.tipo_movimiento.toUpperCase(),
                monto: data.monto,
                concepto: data.concepto,
                metodo_pago_id: data.metodo_pago_id,
                fecha_movimiento: data.fecha_movimiento ? new Date(data.fecha_movimiento) : new Date(),
                comprobante_url: data.comprobante_url,
                registrado_por: usuario_id, // ID del administrador que está haciendo la petición
                notas: data.notas
            }
        });
    },

    // Actualizar un movimiento (Ej: si se equivocaron en el monto o concepto)
    actualizar: async (id, data) => {
        return await prisma.movimientos_financieros.update({
            where: { id: parseInt(id) },
            data: {
                tipo_movimiento: data.tipo_movimiento ? data.tipo_movimiento.toUpperCase() : undefined,
                monto: data.monto,
                concepto: data.concepto,
                metodo_pago_id: data.metodo_pago_id,
                comprobante_url: data.comprobante_url,
                notas: data.notas
                // La fecha_movimiento y registrado_por rara vez deberían cambiar tras la creación
            }
        });
    },

    // Eliminar un movimiento (Opcional, a veces en finanzas es mejor "anular" que borrar)
    eliminar: async (id) => {
        return await prisma.movimientos_financieros.delete({
            where: { id: parseInt(id) }
        });
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