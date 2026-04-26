import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { cloudinaryService } from '../cloudinaryImg/cloudinary.service.js';

const crearSolicitud = async (alumnoId, { descripcion, evidenciaFile }) => {
  // 1. Validar que no tenga ya una solicitud pendiente
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

  // El alumno ya no usará drive, ahora subirá directamente una imagen a la nube (cloudinary)
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

  // 2. Crear la solicitud
  return await prisma.solicitudes_lesion.create({
    data: {
      alumno_id: parseInt(alumnoId),
      descripcion_lesion: descripcion,
      url_evidencia_medica: imageUrl,
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

/**
 * LÓGICA CORE: Aprobar/Rechazar y Generar Efectos
 */
const evaluarSolicitud = async ({
  solicitudId,
  estado, // 'APROBADA' | 'RECHAZADA'
  adminId,
  notas,
  tipo, // 'RANGO' | 'INDEFINIDO'
  fechaInicio,
  fechaFin,
}) => {
  return await prisma.$transaction(async (tx) => {
    // 1. Buscar la solicitud
    const solicitud = await tx.solicitudes_lesion.findUnique({
      where: { id: parseInt(solicitudId) },
    });

    if (!solicitud || solicitud.estado !== 'PENDIENTE') {
      throw new ApiError('La solicitud no existe o ya fue procesada.', 404);
    }

    // 2. Si es RECHAZADA, solo actualizamos estado y notas
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

    // 3. Lógica APROBADA
    // Necesitamos las inscripciones activas del alumno para saber qué clases justificar
    const inscripcionesActivas = await tx.inscripciones.findMany({
      where: {
        alumno_id: solicitud.alumno_id,
        estado: { in: ['ACTIVO', 'PEN-RECU'] },
      },
    });

    if (!inscripcionesActivas || inscripcionesActivas.length === 0) {
      throw new ApiError(
        'El alumno no tiene ninguna inscripción activa para aplicar la justificación por lesión.',
        400
      );
    }

    // Definir el rango de fechas a afectar
    const inicioRango = new Date(fechaInicio);
    inicioRango.setHours(0, 0, 0, 0);
    let finRango
    if (tipo === 'RANGO') {
      if (!fechaFin) throw new ApiError('Fecha fin requerida para RANGO.', 400);
      finRango = new Date(fechaFin);
      finRango.setHours(0, 0, 0, 0);

      if (inicioRango > finRango) throw new ApiError('La fecha final debe ser mayor a la fecha inicial.', 400);
    }

    // A. Crear registros en CONGELAMIENTOS (Uno por cada inscripción activa)
    for (const inscripcion of inscripcionesActivas) {

      await tx.congelamientos.create({
        data: {
          inscripcion_id: inscripcion.id,
          solicitud_lesion_id: solicitud.id,
          fecha_inicio: inicioRango,
          fecha_fin: tipo === 'RANGO' ? finRango : null, // Dejarlo en null si es INDEFINIDO, ya que no afecta la lógica de momento.
          estado: 'ACTIVO',
          //dias_reconocidos: 0, // Se puede manejar para ver cuantos dias se estan cubriendo con el congelamiento, pero tampoco es que afecte la lógica.
        },
      });
    }

    // B. Buscar asistencias en ese rango para TODAS las inscripciones
    const idsInscripciones = inscripcionesActivas.map((i) => i.id);

    const fechaFilter = tipo === 'RANGO'
      ? { gte: inicioRango, lte: finRango }
      : { gte: inicioRango };

    const clasesAfectadas = await tx.registros_asistencia.findMany({
      where: {
        // Usamos 'in' para buscar en cualquiera de sus inscripciones
        inscripcion_id: { in: idsInscripciones },
        fecha: fechaFilter,
        estado: { in: ['PROGRAMADA', 'FALTA'] },
      },
    });

    // C. Procesar cada clase afectada
    const recuperacionesProcesadas = [];

    for (const clase of clasesAfectadas) {
      // 1. Actualizar asistencia a JUSTIFICADO_LESION
      await tx.registros_asistencia.update({
        where: { id: clase.id },
        data: {
          estado: 'JUSTIFICADO_LESION',
          comentario: `Lesión Aprobada (Solicitud #${solicitud.id})`,
        },
      });

      // 2. Gestionar la Recuperación

      // PASO A: Buscamos si existe CUALQUIER ticket para esa fecha (sin filtrar estado)
      const recuperacionCualquiera = await tx.recuperaciones.findFirst({
        where: {
          alumno_id: solicitud.alumno_id,
          registro_asistencia_id: clase.id,
        },
      });

      if (recuperacionCualquiera) {
        // ESCENARIO 1: Recuperación completada
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

        // ESCENARIO 2: Recuperación pendiente o programada
        const recuActualizada = await tx.recuperaciones.update({
          where: { id: recuperacionCualquiera.id },
          data: {
            motivo_falta: 'LESION_JUSTIFICADA',
            es_por_lesion: true,
            solicitud_lesion_id: solicitud.id,
            estado: 'PENDIENTE', // Se reinicia a pendiente por si estaba "PROGRAMADA" o "VENCIDA"
            horario_destino_id: null,
            fecha_programada: null,
          },
        });
        recuperacionesProcesadas.push(recuActualizada);
      } else {
        // ESCENARIO 3: No existe recuperacion en la bd, entonces, se crea
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

    // D. Finalmente, actualizar la solicitud a APROBADA
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
