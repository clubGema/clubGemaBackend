import { PrismaClient } from "@prisma/client"
import { asistenciaService } from "../../features/asistencia/asistencia.service.js";
import { ApiError } from "./error.util.js";

const prisma = new PrismaClient()

export const fechaUltimaClase = async (ids) => {
    return prisma.$transaction(async (tx) => {
        const inscripciones = await tx.inscripciones.findMany({
            where: {
                id: { in: ids }
            },
            include: {
                horarios_clases: true
            }
        })

        const fechas = await Promise.all(
            inscripciones.map((i) => {
                return asistenciaService.generarClasesPorConteo(tx, {
                    inscripcion_id: i.id,
                    dia_semana: i.horarios_clases.dia_semana,
                    fecha_inicio: i.fecha_inscripcion,
                    cantidad: 4,
                    alumno_id: i.alumno_id,
                    hora_inicio: i.horarios_clases.hora_inicio,
                    dryRun: true,
                })
            }));
        const fechasAplanadas = fechas.flat();
        if (fechasAplanadas.length === 0) throw new ApiError('Error al calcular fecha de la última clase', 400)
        return fechasAplanadas.sort((a, b) => b - a)[0]
    })
}