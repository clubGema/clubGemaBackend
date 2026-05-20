import { prisma } from '../../config/database.config.js';
import { formatFechaEs } from '../../shared/utils/date.util.js';
import { logger } from '../../shared/utils/logger.util.js';

class ClaseCronService {
    async optimizarFechasReposicion() {
        const hoyUTC = new Date();
        hoyUTC.setUTCHours(0, 0, 0, 0);

        // 1. Buscar todas las reposiciones pendientes en el futuro
        const reposicionesPendientes = await prisma.registros_asistencia.findMany({
            where: {
                estado: 'PENDIENTE',
                reprogramacion_clase_id: { not: null },
                fecha_original: { not: null },
                fecha: { gt: hoyUTC }
            },
            include: {
                inscripciones: true
            }
        });

        if (reposicionesPendientes.length === 0) {
            logger.info('No hay reposiciones pendientes para optimizar hoy.');
            return;
        }

        let contadorActualizados = 0;

        const calcularSiguienteDia = (desdeFecha, diasValidos) => {
            const next = new Date(desdeFecha);
            next.setUTCHours(12, 0, 0, 0);
            for (let i = 1; i <= 31; i++) {
                next.setUTCDate(next.getUTCDate() + 1);
                const diaSemana = next.getUTCDay() === 0 ? 7 : next.getUTCDay();
                if (diasValidos.includes(diaSemana)) return next;
            }
            return next;
        };

        // 2. Procesar cada registro dentro de una transacción para evitar inconsistencias
        await prisma.$transaction(async (tx) => {
            for (const reposicion of reposicionesPendientes) {
                const alumnoId = reposicion.inscripciones.alumno_id;

                const susInscripciones = await tx.inscripciones.findMany({
                    where: { alumno_id: alumnoId, estado: 'ACTIVO' },
                    select: {
                        id: true,
                        horarios_clases: { select: { dia_semana: true } }
                    }
                });

                const diasDelAlumno = [...new Set(susInscripciones.map(s => s.horarios_clases.dia_semana))];

                // Buscamos la clase inmediatamente anterior a esta reposición (el final de su ciclo regular)
                const idInscAlum = susInscripciones.map(i => i.id)
                const claseAnterior = await tx.registros_asistencia.findFirst({
                    where: {
                        inscripcion_id: { in: idInscAlum },
                        fecha: { lt: reposicion.fecha } // Que sea antes de la fecha actual de la reposición
                    },
                    orderBy: { fecha: 'desc' },
                    select: { fecha: true }
                });

                // Si por algún motivo no hay clase anterior, usamos la original como plan B
                const fechaBaseParaCalcular = claseAnterior ? claseAnterior.fecha : reposicion.fecha_original;

                const nuevaFechaReposicion = calcularSiguienteDia(fechaBaseParaCalcular, diasDelAlumno);

                // Solo actualizamos si logramos "acercar" la clase.
                if (nuevaFechaReposicion.getTime() < reposicion.fecha.getTime() && nuevaFechaReposicion.getTime() > hoyUTC.getTime()) {

                    await tx.registros_asistencia.update({
                        where: { id: reposicion.id },
                        data: {
                            fecha: nuevaFechaReposicion,
                            comentario: `${reposicion.comentario || ''} | Adelantado al ${formatFechaEs(nuevaFechaReposicion)}`
                        }
                    });

                    // Calculamos cuántos días le estamos "recortando" a su espera
                    const diffMs = nuevaFechaReposicion.getTime() - reposicion.fecha.getTime();
                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

                    await tx.$executeRawUnsafe(`
                        UPDATE inscripciones 
                        SET fecha_inscripcion = fecha_inscripcion + INTERVAL '${diffDays} days'
                        WHERE id = ${reposicion.inscripcion_id}
                    `);

                    await tx.notificaciones.create({
                        data: {
                            alumno_id: alumnoId,
                            titulo: 'Actualización de Clase Reprogramada',
                            mensaje: `Debido a tu nueva inscripción, tu clase reprogramada se adelantó para el ${formatFechaEs(nuevaFechaReposicion)}.`,
                            tipo: 'INFO',
                            categoria: 'CLASES',
                        }
                    });
                    contadorActualizados++;
                }
            }
        }, {
            timeout: 30000
        });

        logger.info(
            `Se actualizaron las fechas ${contadorActualizados} reposiciones.`
        );
    }
}

export const claseCronService = new ClaseCronService();