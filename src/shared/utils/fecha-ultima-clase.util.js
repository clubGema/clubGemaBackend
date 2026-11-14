import { PrismaClient } from "@prisma/client";
import { asistenciaService } from "../../features/asistencia/asistencia.service.js";
import { ApiError } from "./error.util.js";

const prisma = new PrismaClient();

export const fechaUltimaClase = async (ids, opciones = {}) => {
    const cantidad = typeof opciones === 'number'
        ? opciones
        : (opciones?.cantidad ?? 4);
    const fechaInicioCustom = typeof opciones === 'object' ? opciones?.fechaInicio : null;
    const txExterno = typeof opciones === 'object' ? opciones?.tx : null;
    // Solo calcula la fecha: los choques con recuperaciones se validan al
    // aprobar el pago (validarChoquesCiclo), no al generar la deuda.
    const omitirChoques = typeof opciones === 'object' && opciones?.omitirChoques === true;

    const resolver = async (tx) => {
        const inscripciones = await tx.inscripciones.findMany({
            where: {
                id: { in: ids }
            },
            include: {
                horarios_clases: true
            }
        });

        const fechas = await Promise.all(
            inscripciones.map((i) => {
                return asistenciaService.generarClasesPorConteo(tx, {
                    inscripcion_id: i.id,
                    dia_semana: i.horarios_clases.dia_semana,
                    fecha_inicio: fechaInicioCustom ?? i.fecha_inscripcion,
                    cantidad: cantidad,
                    alumno_id: omitirChoques ? null : i.alumno_id,
                    hora_inicio: i.horarios_clases.hora_inicio,
                    dryRun: true,
                });
            }));
        const fechasAplanadas = fechas.flat();
        if (fechasAplanadas.length === 0) throw new ApiError('Error al calcular fecha de la última clase', 400);
        return fechasAplanadas.sort((a, b) => b - a)[0];
    };

    if (txExterno) {
        return await resolver(txExterno);
    }
    return prisma.$transaction(resolver);
};
