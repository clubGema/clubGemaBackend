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
obtenerResumenMensual: async (mes, anio) => {
    const mesInt = parseInt(mes);
    const anioInt = parseInt(anio);
    
    // Rango de fechas para el mes
    const fechaInicio = new Date(anioInt, mesInt - 1, 1);
    const fechaFin = new Date(anioInt, mesInt, 0, 23, 59, 59);

    // 1. Ingresos (Pagos validados)
    const ingresos = await prisma.pagos.findMany({
        where: {
            estado_validacion: 'APROBADO',
            fecha_pago: { gte: fechaInicio, lte: fechaFin }
        },
        include: { 
            cuentas_por_cobrar: { 
                include: { 
                    alumnos: { 
                        include: { 
                            usuarios: true, // <--- CLAVE: Traemos los datos del usuario para sacar su nombre
                            inscripciones: { 
                                include: { 
                                    horarios_clases: { 
                                        include: { 
                                            canchas: { 
                                                include: { sedes: true } 
                                            } 
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

    // 2. Movimientos Manuales (Ingresos/Egresos)
    const manuales = await prisma.movimientos_financieros.findMany({
        where: { fecha_movimiento: { gte: fechaInicio, lte: fechaFin } },
        include: { 
            sedes: true,
            administrador: {
                include: {
                    usuarios: true // <--- CLAVE: Traemos los datos del usuario del administrador
                }
            }
        } 
    });

    // 3. Estructura para el Frontend
    const reporte = {};

    // Procesar ingresos automáticos
    ingresos.forEach(pago => {
        const sede = pago.cuentas_por_cobrar?.alumnos?.inscripciones[0]?.horarios_clases?.canchas?.sedes?.nombre || 'GENERAL';
        
        // Extraemos el nombre desde la relación usuarios
        const dataUsuario = pago.cuentas_por_cobrar?.alumnos?.usuarios;
        const nombreCompletoAlumno = dataUsuario ? `${dataUsuario.nombres} ${dataUsuario.apellidos}` : '-';

        if (!reporte[sede]) reporte[sede] = { ingresos: [], egresos: [] };
        
        reporte[sede].ingresos.push({ 
            id: pago.id,
            concepto: pago.cuentas_por_cobrar?.detalle_adicional || 'PAGO DE CUOTA', 
            monto: pago.monto_pagado.toString(), 
            fecha: pago.fecha_pago,
            alumno: nombreCompletoAlumno, // Inyectamos el nombre real
            registrado_por: 'SISTEMA AUTOMÁTICO'
        });
    });

    // Procesar movimientos manuales
    manuales.forEach(m => {
        const sedeKey = m.sedes?.nombre || 'GENERAL'; 

        if (!reporte[sedeKey]) {
            reporte[sedeKey] = { ingresos: [], egresos: [] };
        }

        // Extraemos el nombre del administrador desde la relación usuarios
        const dataAdmin = m.administrador?.usuarios;
        const nombreAdmin = dataAdmin ? `${dataAdmin.nombres} ${dataAdmin.apellidos}` : (m.registrado_por ? `Admin ID: ${m.registrado_por}` : 'SISTEMA');

        const formatoMovimiento = {
            id: m.id,
            concepto: m.concepto,
            monto: m.monto.toString(),
            fecha: m.fecha_movimiento,
            alumno: '-', // Un gasto manual de caja no tiene un alumno específico
            registrado_por: nombreAdmin // Inyectamos el nombre del administrador
        };

        if (m.tipo_movimiento === 'INGRESO') {
            reporte[sedeKey].ingresos.push(formatoMovimiento);
        } else {
            reporte[sedeKey].egresos.push(formatoMovimiento); 
        }
    });

    return reporte;
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