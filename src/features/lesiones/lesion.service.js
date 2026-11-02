import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { cloudinaryService } from '../cloudinaryImg/cloudinary.service.js';

const crearSolicitud = async (alumnoId, { descripcion, evidenciaFile, fechaInicio, fechaFin }) => {
  const existePendiente = await prisma.solicitudes_lesion.findFirst({
    where: {
      alumno_id: parseInt(alumnoId),
      estado: 'PENDIENTE',
    },
  });

  if (existePendiente) {
    throw new ApiError('Ya tienes una solicitud de lesión en proceso de revisión.', 400);
  }

  let imageUrl = '';

  if (evidenciaFile) {
    try {
      const cloudinaryResponse = await cloudinaryService.upload(evidenciaFile, 'evidencias');
      imageUrl = cloudinaryResponse.url;
    } catch (error) {
      throw new Error(`Error al subir la imagen a Cloudinary: ${error.message}`);
    }
  } else {
    throw new Error('evidenciaFile no existe.');
  }

  return await prisma.solicitudes_lesion.create({
    data: {
      alumno_id: parseInt(alumnoId),
      descripcion_lesion: descripcion,
      url_evidencia_medica: imageUrl,
      fecha_inicio: new Date(fechaInicio),
      fecha_fin: new Date(fechaFin),
      estado: 'PENDIENTE',
      fecha_solicitud: new Date(),
    },
  });
};

const obtenerMisSolicitudes = async (alumnoId) => {
  return await prisma.solicitudes_lesion.findMany({
    where: { alumno_id: parseInt(alumnoId) },
    orderBy: { fecha_solicitud: 'desc' },
  });
};

const obtenerPendientes = async () => {
  return await prisma.solicitudes_lesion.findMany({
    where: { estado: 'PENDIENTE' },
    include: {
      alumnos: {
        include: {
          usuarios: {
            select: {
              nombres: true,
              apellidos: true,
              numero_documento: true,
            },
          },
        },
      },
    },
    orderBy: { fecha_solicitud: 'asc' },
  });
};

const evaluarSolicitud = async ({
  solicitudId,
  estado, // 'APROBADA' | 'RECHAZADA'
  adminId,
  notas,
}) => {
  return await prisma.$transaction(async (tx) => {
    const solicitud = await tx.solicitudes_lesion.findUnique({
      where: { id: parseInt(solicitudId) },
    });

    if (!solicitud || solicitud.estado !== 'PENDIENTE') {
      throw new ApiError('La solicitud no existe o ya fue procesada.', 404);
    }

    if (estado === 'RECHAZADA') {
      const solicitudUpdated = await tx.solicitudes_lesion.update({
        where: { id: solicitud.id },
        data: {
          estado: 'RECHAZADA',
          revisado_por: parseInt(adminId),
          notas_admin: notas,
        },
      });
      await tx.notificaciones.create({
        data: {
          alumno_id: solicitudUpdated.alumno_id,
          titulo: `Solicitud de Lesión ${solicitudUpdated.estado}`,
          mensaje: `Tu solicitud por lesión fue ${solicitudUpdated.estado} por el administrador.`,
          tipo: 'WARNING',
          categoria: 'SISTEMA',
        }
      });
      return solicitudUpdated;
    }

    const haceSeisMeses = new Date();
    haceSeisMeses.setMonth(haceSeisMeses.getMonth() - 6);
    const inscripciones = await tx.inscripciones.findMany({
      where: {
        alumno_id: solicitud.alumno_id,
        estado: { in: ['ACTIVO', 'FINALIZADO'] },
        creado_en: {
          gte: haceSeisMeses,
        },
      },
    });

    if (!inscripciones || inscripciones.length === 0) {
      throw new ApiError(
        'El alumno no tiene ninguna inscripción en los últimos 6 meses.',
        400
      );
    }

    await tx.congelamientos.create({
      data: {
        solicitud_lesion_id: solicitud.id,
        fecha_inicio: solicitud.fecha_inicio,
        fecha_fin: solicitud.fecha_fin,
        estado: 'ACTIVO',
      },
    });

    const idsInscripciones = inscripciones.map((i) => i.id);

    const fechaFilter = { gte: solicitud.fecha_inicio, lte: solicitud.fecha_fin };

    const clasesAfectadas = await tx.registros_asistencia.findMany({
      where: {
        inscripcion_id: { in: idsInscripciones },
        fecha: fechaFilter,
        estado: { in: ['PROGRAMADA', 'FALTA', 'PRESENTE', 'PENDIENTE', 'SIN_REGISTRO'] },
      },
    });

    if (!clasesAfectadas || clasesAfectadas.length === 0) throw new ApiError('No se encontró ninguna clase afectada en el rango establecido', 400);

    const recuperacionesProcesadas = [];

    for (const clase of clasesAfectadas) {
      await tx.registros_asistencia.update({
        where: { id: clase.id },
        data: {
          estado: 'JUSTIFICADO_LESION',
          comentario: `Lesión Aprobada (Solicitud #${solicitud.id})`,
        },
      });

      const recuperacionCualquiera = await tx.recuperaciones.findFirst({
        where: {
          alumno_id: solicitud.alumno_id,
          registro_asistencia_id: clase.id,
        },
      });

      if (recuperacionCualquiera) {
        const estadosCompletada = ['COMPLETADA_FALTA', 'COMPLETADA_PRESENTE'];
        if (estadosCompletada.includes(recuperacionCualquiera.estado)) {
          const recuActualizada = await tx.recuperaciones.update({
            where: { id: recuperacionCualquiera.id },
            data: {
              es_por_lesion: true,
              solicitud_lesion_id: solicitud.id,
              motivo_falta: 'LESION_JUSTIFICADA',
            },
          });
          recuperacionesProcesadas.push(recuActualizada);
          continue;
        }
        const recuActualizada = await tx.recuperaciones.update({
          where: { id: recuperacionCualquiera.id },
          data: {
            motivo_falta: 'LESION_JUSTIFICADA',
            es_por_lesion: true,
            solicitud_lesion_id: solicitud.id,
            estado: 'PENDIENTE',
            horario_destino_id: null,
            fecha_programada: null,
          },
        });
        recuperacionesProcesadas.push(recuActualizada);
      } else {
        const nuevaRecu = await tx.recuperaciones.create({
          data: {
            alumno_id: solicitud.alumno_id,
            fecha_falta: clase.fecha,
            motivo_falta: 'LESION_JUSTIFICADA',
            es_por_lesion: true,
            estado: 'PENDIENTE',
            solicitud_lesion_id: solicitud.id,
            registro_asistencia_id: clase.id,
          },
        });
        recuperacionesProcesadas.push(nuevaRecu);
      }
    }

    const solicitudActualizada = await tx.solicitudes_lesion.update({
      where: { id: solicitud.id },
      data: {
        estado: 'APROBADA',
        revisado_por: parseInt(adminId),
        notas_admin: notas,
      },
    });

    await tx.notificaciones.create({
      data: {
        alumno_id: solicitudActualizada.alumno_id,
        titulo: `Solicitud de Lesión ${solicitudActualizada.estado}`,
        mensaje: `Tu solicitud por lesión fue ${solicitudActualizada.estado} por el administrador.`,
        tipo: 'WARNING',
        categoria: 'SISTEMA',
      }
    });

    return {
      solicitud: solicitudActualizada,
      inscripciones_afectadas: idsInscripciones.length,
      clases_justificadas: clasesAfectadas.length,
      recuperaciones_generadas: recuperacionesProcesadas,
    };
  });
};

export const lesionService = {
  crearSolicitud,
  obtenerMisSolicitudes,
  obtenerPendientes,
  evaluarSolicitud,
};
