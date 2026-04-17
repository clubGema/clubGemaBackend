import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { formatFechaEs } from '../../shared/utils/date.util.js';

// ============================================================================
// FUNCIONES PRIVADAS DE APOYO
// ============================================================================

// La lógica de validación de colisiones ha sido simplificada y movida dentro de
// reprogramarMasivamente para permitir el flujo dinámico por cada alumno.

export const claseService = {
  /**
   * Reprograma una clase completa para un grupo de alumnos.
   * Modela una "Asistencia Anticipada" tal cual lo especificó la academia.
   */
  reprogramarMasivamente: async ({ horario_origen_id, fecha_origen, motivo, usuario_admin_id }) => {
    // 1. OBTENCIÓN DE DATOS INICIALES DEL HORARIO ORIGEN
    const horarioOrigen = await prisma.horarios_clases.findUnique({
      where: { id: horario_origen_id },
      select: {
        hora_inicio: true,
        hora_fin: true,
        cancha_id: true,
        inscripciones: {
          where: { estado: 'ACTIVO' },
          select: { id: true, alumno_id: true },
        },
      },
    });

    if (!horarioOrigen) throw new ApiError('Horario no encontrado', 404);
    const inscripcionesGrupo = horarioOrigen.inscripciones;
    if (inscripcionesGrupo.length === 0)
      throw new ApiError('No hay alumnos activos en este horario', 400);

    const fechaOrigenDate = new Date(fecha_origen);
    fechaOrigenDate.setUTCHours(12, 0, 0, 0);
    const dateOrigenStr = formatFechaEs(fechaOrigenDate);

    const importUUID = await import('node:crypto');
    const grupo_uuid = importUUID.randomUUID();

    // ======================================================================
    // FUNCION AUXILIAR PARA CALCULAR EL SIGUIENTE DIA DE CLASE
    // ======================================================================
    const calcularSiguienteDia = (desdeFecha, diasValidos) => {
      const next = new Date(desdeFecha);
      next.setUTCHours(12, 0, 0, 0);

      for (let i = 1; i <= 31; i++) {
        // Max 1 mes de busqueda
        next.setUTCDate(next.getUTCDate() + 1);
        const diaSemana = next.getUTCDay() === 0 ? 7 : next.getUTCDay();
        if (diasValidos.includes(diaSemana)) return next;
      }
      return next;
    };

    // ======================================================================
    // INICIO DE LA TRANSACCIÓN
    // ======================================================================
    return await prisma.$transaction(
      async (tx) => {
        const inscripcionIds = inscripcionesGrupo.map((i) => i.id);

        // 🛡️ PASO 1: VERIFICAR FERIADO
        const todosLosFeriados = await tx.feriados.findMany({ where: { activo: true } });
        const esFeriado = todosLosFeriados.some(
          (f) =>
            f.fecha.getUTCDate() === fechaOrigenDate.getUTCDate() &&
            f.fecha.getUTCMonth() === fechaOrigenDate.getUTCMonth()
        );

        if (esFeriado) {
          await tx.registros_asistencia.updateMany({
            where: { inscripcion_id: { in: inscripcionIds }, fecha: fechaOrigenDate },
            data: {
              estado: 'CANCELADO',
              comentario: `Clase cancelada por feriado oficial: ${motivo}`,
            },
          });
          return {
            total_procesados: inscripcionesGrupo.length,
            mensaje: `Feriado detectado (${dateOrigenStr}). Se cancelaron las clases.`,
            es_feriado: true,
          };
        }

        // 🛡️ PASO 2: CREAR CABECERA DE REPROGRAMACION
        const reprogramacion = await tx.reprogramaciones_clases.create({
          data: {
            horario_id: horario_origen_id,
            fecha_origen: fechaOrigenDate,
            fecha_destino: fechaOrigenDate, // Temporal, ya que ahora es individual
            hora_inicio_destino:
              horarioOrigen.hora_inicio.getUTCHours().toString().padStart(2, '0') +
              ':' +
              horarioOrigen.hora_inicio.getUTCMinutes().toString().padStart(2, '0'),
            hora_fin_destino:
              horarioOrigen.hora_fin.getUTCHours().toString().padStart(2, '0') +
              ':' +
              horarioOrigen.hora_fin.getUTCMinutes().toString().padStart(2, '0'),
            motivo: motivo,
            creado_por: usuario_admin_id,
            es_masiva: true,
            estado: 'ACTIVO',
            grupo_uuid: grupo_uuid,
          },
        });

        // 🛡️ PASO 3: MARCAR REGISTROS ORIGINALES COMO REPROGRAMADOS
        await tx.registros_asistencia.updateMany({
          where: { inscripcion_id: { in: inscripcionIds }, fecha: fechaOrigenDate },
          data: {
            estado: 'REPROGRAMADO',
            reprogramacion_clase_id: reprogramacion.id,
            comentario: `Movido al final del ciclo por ${motivo}`,
          },
        });

        // 🛡️ PASO 4: PROCESAR CADA ALUMNO INDIVIDUALMENTE
        for (const ins of inscripcionesGrupo) {
          // A) Obtener todos los días de entrenamiento del alumno (todas sus inscripciones)
          const susInscripciones = await tx.inscripciones.findMany({
            where: { alumno_id: ins.alumno_id, estado: 'ACTIVO' },
            select: { horario_id: true, horarios_clases: { select: { dia_semana: true } }, registros_asistencia: true },
          });
          const diasDelAlumno = [
            ...new Set(susInscripciones.map((s) => s.horarios_clases.dia_semana)),
          ];

          // B) Buscar su última clase programada actual
          const registrosAsist = susInscripciones.flatMap(i => i.registros_asistencia.map(r => r.fecha))
          const ultimaClase = new Date(Math.max(...registrosAsist));

          // C) Calcular nueva fecha de reposición (Su próximo día regular DESPUÉS del fin de ciclo)
          const fechaFinOriginal = new Date(ultimaClase);
          const fechaReposicion = calcularSiguienteDia(fechaFinOriginal, diasDelAlumno);
          const dateReposicionStr = formatFechaEs(fechaReposicion);

          // D) Crear el registro de reposición
          await tx.registros_asistencia.create({
            data: {
              inscripcion_id: ins.id,
              fecha: fechaReposicion,
              fecha_original: fechaOrigenDate,
              estado: 'PENDIENTE',
              reprogramacion_clase_id: reprogramacion.id,
              comentario: `Reposición de clase (${dateOrigenStr}) [NO_RECUPERABLE]. Motivo: ${motivo}`,
            },
          });

          // E) Calcular el desfase en días y extender facturación
          const diffMs = fechaReposicion.getTime() - fechaFinOriginal.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

          // E) Extender facturación usando lógica nativa de Prisma
          const inscripcionActual = await tx.inscripciones.findUnique({
            where: { id: ins.id },
            select: { fecha_inscripcion: true },
          });

          const nuevaFechaInscripcion = new Date(inscripcionActual.fecha_inscripcion);
          nuevaFechaInscripcion.setDate(nuevaFechaInscripcion.getDate() + diffDays);

          await tx.inscripciones.update({
            where: { id: ins.id },
            data: { fecha_inscripcion: nuevaFechaInscripcion },
          });

          // F) Notificar al alumno
          await tx.notificaciones.create({
            data: {
              alumno_id: ins.alumno_id,
              titulo: '🚨 Clase Reprogramada',
              mensaje: `Tu sesión del ${dateOrigenStr} se movió al ${dateReposicionStr}. Tu fecha de pago se extendió ${diffDays} días.`,
              tipo: 'ALERTA',
              categoria: 'CLASES',
            },
          });
        }

        return {
          total_procesados: inscripcionesGrupo.length,
          reprogramacion_id: reprogramacion.id,
          grupo_uuid: grupo_uuid,
          mensaje: 'Reprogramación dinámica exitosa basada en el horario de cada alumno.',
        };
      },
      {
        timeout: 60000,
      }
    );
  },

  /**
   * Revierte una reprogramación masiva previa utilizando el grupo_uuid
   */
  revertirReprogramacionMasiva: async (grupo_uuid) => {
    return await prisma.$transaction(async (tx) => {
      // 1. Buscar la reprogramación masiva
      const reprogramaciones = await tx.reprogramaciones_clases.findMany({
        where: { grupo_uuid: grupo_uuid, estado: 'ACTIVO' },
      });

      if (!reprogramaciones || reprogramaciones.length === 0) {
        throw new ApiError(
          'No se encontró una reprogramación masiva activa con ese identificador.',
          404
        );
      }

      const reprogramacionesIds = reprogramaciones.map((r) => r.id);

      // 2. Buscar todas las asistencias afectadas
      const asistencias = await tx.registros_asistencia.findMany({
        where: { reprogramacion_clase_id: { in: reprogramacionesIds } },
      });

      if (asistencias.length === 0) {
        throw new ApiError(
          'No se encontraron registros de asistencia asociados a esta reprogramación.',
          404
        );
      }

      // 3. Reversión de la asistencia y facturación
      const asistenciasNuevas = await tx.registros_asistencia.findMany({
        where: {
          reprogramacion_clase_id: { in: reprogramacionesIds },
          fecha_original: { not: null },
        },
      });

      for (const an of asistenciasNuevas) {
        // Encontramos la clase que quedó como REPROGRAMADA para calcular el desfase original
        const claseOriginal = await tx.registros_asistencia.findFirst({
          where: {
            inscripcion_id: an.inscripcion_id,
            reprogramacion_clase_id: { in: reprogramacionesIds },
            estado: 'REPROGRAMADO',
          },
          orderBy: { fecha: 'desc' },
        });

        // Si no la encontramos por estado (quizás ya se movió), buscamos la inmediata anterior
        const refFecha = claseOriginal ? claseOriginal.fecha : an.fecha_original;

        if (refFecha) {
          const diffMs = an.fecha.getTime() - refFecha.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

          // Reversión de facturación usando lógica nativa de Prisma
          const inscripcionActual = await tx.inscripciones.findUnique({
            where: { id: an.inscripcion_id },
            select: { fecha_inscripcion: true },
          });

          const nuevaFechaInscripcion = new Date(inscripcionActual.fecha_inscripcion);
          nuevaFechaInscripcion.setDate(nuevaFechaInscripcion.getDate() - diffDays);

          await tx.inscripciones.update({
            where: { id: an.inscripcion_id },
            data: { fecha_inscripcion: nuevaFechaInscripcion },
          });
        }
      }

      // A) Borramos los registros "NUEVOS" creados en la fecha destino
      await tx.registros_asistencia.deleteMany({
        where: {
          reprogramacion_clase_id: { in: reprogramacionesIds },
          fecha_original: { not: null },
        },
      });

      // B) Restauramos los registros originales
      await tx.registros_asistencia.updateMany({
        where: { reprogramacion_clase_id: { in: reprogramacionesIds }, estado: 'REPROGRAMADO' },
        data: {
          estado: 'PENDIENTE',
          reprogramacion_clase_id: null,
          comentario: null,
          fecha_original: null,
        },
      });

      // 4. Marcar reprogramación como REVERTIDO
      await tx.reprogramaciones_clases.updateMany({
        where: { id: { in: reprogramacionesIds } },
        data: { estado: 'REVERTIDO' },
      });

      return { mensaje: 'Reprogramación revertida exitosamente.' };
    });
  },

  /**
   * Obtiene la lista de reprogramaciones masivas activas
   */
  obtenerMasivasActivas: async () => {
    const data = await prisma.reprogramaciones_clases.findMany({
      where: { es_masiva: true, estado: 'ACTIVO' },
      orderBy: { creado_en: 'desc' },
      include: {
        horarios_clases: {
          include: {
            canchas: { select: { nombre: true, sedes: { select: { nombre: true } } } },
            niveles_entrenamiento: { select: { nombre: true } },
          },
        },
        usuarios: { select: { nombres: true, apellidos: true } },
        _count: { select: { registros_asistencia: true } },
      },
    });

    // Dividimos entre 2 porque ahora guardamos el original (REPROGRAMADO) y el nuevo (PENDIENTE)
    return data.map((item) => ({
      ...item,
      _count: {
        ...item._count,
        registros_asistencia: Math.round(item._count.registros_asistencia / 2),
      },
    }));
  },

  /**
   * Obtiene el detalle de una clase específica (horario)
   */
  obtenerDetalleClase: async (horario_id) => {
    const horario = await prisma.horarios_clases.findUnique({
      where: { id: Number(horario_id) },
      select: {
        id: true,
        dia_semana: true,
        hora_inicio: true,
        hora_fin: true,
        capacidad_max: true,
        canchas: {
          select: { nombre: true, sedes: { select: { nombre: true } } },
        },
        coordinadores: {
          select: {
            usuarios: { select: { nombres: true, apellidos: true } },
          },
        },
        niveles_entrenamiento: { select: { nombre: true } },
        inscripciones: {
          where: { estado: 'ACTIVO' },
          select: {
            id: true,
            alumnos: {
              select: {
                usuario_id: true,
                usuarios: { select: { id: true, nombres: true, apellidos: true, email: true } },
              },
            },
          },
        },
      },
    });

    if (!horario) throw new ApiError('Horario no encontrado', 404);

    return {
      id: horario.id,
      dia_semana: horario.dia_semana,
      hora_inicio: horario.hora_inicio.toISOString().substring(11, 16),
      hora_fin: horario.hora_fin.toISOString().substring(11, 16),
      cancha: `${horario.canchas.nombre} - ${horario.canchas.sedes.nombre}`,
      coordinador: horario.coordinadores
        ? `${horario.coordinadores.usuarios.nombres} ${horario.coordinadores.usuarios.apellidos}`
        : 'Sin asignar',
      nivel: horario.niveles_entrenamiento.nombre,
      total_inscritos: horario.inscripciones.length,
      capacidad_maxima: horario.capacidad_max,
      alumnos_inscritos: horario.inscripciones.map((ins) => ({
        inscripcion_id: ins.id,
        alumno_id: ins.alumnos.usuario_id,
        nombre_completo: `${ins.alumnos.usuarios.nombres} ${ins.alumnos.usuarios.apellidos}`,
        email: ins.alumnos.usuarios.email,
      })),
    };
  },

  /**
   * Obtiene las fechas únicas disponibles (ya generadas en registros_asistencia) para un horario específico,
   * excluyendo aquellas fechas que ya hayan sido reprogramadas masivamente.
   */
  obtenerFechasDisponibles: async (horario_id) => {
    // Obtener la fecha de hoy en formato UTC para evitar desfases horarios nocturnos
    const hoyStr = new Date().toISOString().substring(0, 10);
    const hoy = new Date(hoyStr);

    // Buscamos todos los registros asociados a las inscripciones de este horario
    const registros = await prisma.registros_asistencia.findMany({
      where: {
        inscripciones: {
          horario_id: Number(horario_id),
          estado: 'ACTIVO',
        },
        estado: {
          notIn: ['REPROGRAMADO', 'CANCELADO'], // No mostrar fechas ya reprogramadas
        },
        fecha: {
          gte: hoy, // Solo fechas que no han pasado (hoy o futuro)
        },
      },
      select: {
        fecha: true,
      },
      distinct: ['fecha'], // Obtener fechas únicas
      orderBy: {
        fecha: 'asc',
      },
    });

    // Mapeamos a un formato string normalizado YYYY-MM-DD
    return registros.map((r) => r.fecha.toISOString().substring(0, 10));
  },

  /**
   * Obtiene la lista de horarios que tienen al menos un registro de asistencia generado,
   * para filtrar el selector de la reprogramación masiva.
   */
  obtenerHorariosConAsistencia: async () => {
    const horarios = await prisma.horarios_clases.findMany({
      where: {
        activo: true,
        inscripciones: {
          some: {
            estado: 'ACTIVO',
            registros_asistencia: {
              some: {
                estado: { not: 'REPROGRAMADO' },
              },
            },
          },
        },
      },
      select: {
        id: true,
        dia_semana: true,
        hora_inicio: true,
        hora_fin: true,
        canchas: {
          select: {
            nombre: true,
            sedes: { select: { nombre: true } },
          },
        },
        niveles_entrenamiento: { select: { nombre: true } },
      },
      orderBy: [{ dia_semana: 'asc' }, { hora_inicio: 'asc' }],
    });

    return horarios.map((h) => ({
      id: h.id,
      dia_semana: h.dia_semana,
      hora_inicio:
        h.hora_inicio.getUTCHours().toString().padStart(2, '0') +
        ':' +
        h.hora_inicio.getUTCMinutes().toString().padStart(2, '0'),
      hora_fin:
        h.hora_fin.getUTCHours().toString().padStart(2, '0') +
        ':' +
        h.hora_fin.getUTCMinutes().toString().padStart(2, '0'),
      nivel: { nombre: h.niveles_entrenamiento.nombre },
      cancha: {
        nombre: h.canchas.nombre,
        sede: { nombre: h.canchas.sedes.nombre },
      },
    }));
  },
};
