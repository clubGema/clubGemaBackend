import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';

/**
 * Cupo de recuperaciones de faltas normales por ciclo, según los días/semana
 * (inscripciones ACTIVAS) del alumno:
 *   1 día/semana   -> 1 recuperación
 *   2 o 3 días     -> 2 recuperaciones
 *   4 o más días   -> 4 recuperaciones
 * Las de lesión (es_por_lesion) NO cuentan contra este cupo.
 */
export const limiteRecuperaciones = (cantidadInscripciones, meses = 1) => {
  const n = Number(cantidadInscripciones) || 0;
  const m = Math.max(1, Number(meses) || 1);
  let cupoPorMes = 0;
  if (n >= 4) cupoPorMes = 4;
  else if (n >= 2) cupoPorMes = 2;
  else if (n === 1) cupoPorMes = 1;
  return cupoPorMes * m;
};

/**
 * Calcula cuántos meses tiene pagados el paquete activo del alumno
 * basándose en el total de clases regulares generadas (4 clases por mes por horario).
 */
export const calcularMesesPaquete = async (cliente, alumnoId, cantidadInscripciones) => {
  const id = Number.parseInt(alumnoId);
  const diasSemana = Number(cantidadInscripciones) || 1;
  const totalClases = await cliente.registros_asistencia.count({
    where: {
      inscripciones: { alumno_id: id, estado: 'ACTIVO' },
      NOT: { comentario: { contains: '[RECUPERACION]' } }
    }
  });
  const clasesPorMes = diasSemana * 4;
  return clasesPorMes > 0 ? Math.max(1, Math.round(totalClases / clasesPorMes)) : 1;
};

/**
 * Fecha fin REAL del ciclo del alumno = fecha de su última clase regular
 * generada (registros_asistencia), sin contar las filas [RECUPERACION].
 * Es la fecha que rige hasta cuándo se puede recuperar (reemplaza los 30 días).
 * Devuelve Date (@db.Date, 00:00 UTC) o null si el alumno no tiene clases.
 */
export const ultimaClaseRegular = async (cliente, alumnoId) => {
  const registros = await cliente.registros_asistencia.findMany({
    where: { inscripciones: { alumno_id: Number.parseInt(alumnoId) } },
    select: { fecha: true, comentario: true },
    orderBy: { fecha: 'desc' },
    take: 60,
  });
  const regular = registros.find((r) => !r.comentario?.includes('[RECUPERACION]'));
  return regular ? regular.fecha : null;
};

// Crear registro de recuperacion pendiente en caso sea marcado como FALTA.
// faltaPendiente = Ticket de Recuperación
const registrarFaltaPendiente = async (tx, alumnoId, fechaFalta, asistenciaId) => {

  const cantidadInscripciones = await tx.inscripciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['ACTIVO'] },
    },
  });

  // Sin inscripciones activas no hay ciclo del cual recuperar.
  if (cantidadInscripciones < 1) {
    return null; // Retornamos null para indicar que no se creó nada.
  }

  const parcial = await tx.cuentas_por_cobrar.findFirst({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: 'PARCIAL',
    },
  });

  // Si aún no realiza el pago total, no se genera una recuperación.
  if (parcial) {
    console.log(`ID Alumno ${alumnoId}: El alumno aún no realiza el pago total.`);
    return null;
  }

  // 1. Evitar duplicados
  const yaExiste = await tx.recuperaciones.findFirst({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      registro_asistencia_id: Number.parseInt(asistenciaId)
    },
  });

  if (yaExiste) {
    return yaExiste;
  }

  // Obtenemos su inscripción para calcular su ciclo
  const inscripcion = await tx.inscripciones.findFirst({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['ACTIVO'] },
    },
    orderBy: {
      fecha_inscripcion_original: 'asc',
    },
  });

  if (!inscripcion) {
    console.log(`ID Alumno ${alumnoId}: No se encontró una inscripción activa para este alumno.`);
    return null;
  }

  const inicioInscripcion = new Date(inscripcion.fecha_inscripcion_original);
  inicioInscripcion.setHours(0, 0, 0, 0);
  const fechaFaltaDate = new Date(fechaFalta);

  const diffFalta = fechaFaltaDate - inicioInscripcion;
  const diasTranscurridosFalta = Math.floor(diffFalta / (1000 * 60 * 60 * 24));

  if (diasTranscurridosFalta < -30) {
    console.log(`ID Alumno ${alumnoId}: La fecha de la falta pasa los 30 días antes de la fecha de inscripción, no se generó ticket de recuperación.`);
    return null;
  }

  const tickets = await tx.recuperaciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      es_por_lesion: false, // No contamos los tickets VIP
      fecha_falta: {
        gte: inicioInscripcion,
      }
    },
  });

  // Definir su límite según su plan y meses pagados
  const mesesPaquete = await calcularMesesPaquete(tx, alumnoId, cantidadInscripciones);
  const limitePermitido = limiteRecuperaciones(cantidadInscripciones, mesesPaquete);

  // Si ya llegó al tope, abortamos la creación del ticket
  if (tickets >= limitePermitido) {
    console.log(`El alumno ${alumnoId} alcanzó su límite de ${limitePermitido} faltas normales para su ciclo actual.`);
    return null;
  }

  // 3. Crear el registro pendiente si pasa validación de límite
  const nuevaFalta = await tx.recuperaciones.create({
    data: {
      alumno_id: Number.parseInt(alumnoId),
      fecha_falta: new Date(fechaFalta),
      estado: 'PENDIENTE',
      registro_asistencia_id: Number.parseInt(asistenciaId),
    },
  });

  return nuevaFalta;
};

// Función para manejar el estado FALTA/PRESENTE en marcar asistencia y eliminar el registro creado en recuperaciones.
const anularFaltaPendiente = async (tx, alumnoId, asistenciaId) => {
  await tx.recuperaciones.deleteMany({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      registro_asistencia_id: Number.parseInt(asistenciaId),
      estado: { in: ['PENDIENTE', 'PROGRAMADA'] },
      es_por_lesion: false
    }
  });
};

// Permite al alumno poder cancelar una recuperación agendada con 1 hora de anticipación.
const cancelarRecuperacion = async (alumnoId, recuperacionId) => {
  // 1. Buscamos el ticket y traemos la información del horario para saber a qué hora era la clase
  const ticket = await prisma.recuperaciones.findUnique({
    where: {
      id: Number.parseInt(recuperacionId)
    },
    include: {
      horarios_clases: true
    }
  });

  // 2. Validaciones
  if (!ticket) {
    throw new ApiError('El ticket de recuperación no existe.', 404);
  }

  if (ticket.alumno_id !== Number.parseInt(alumnoId)) {
    throw new ApiError('No tienes permiso para cancelar esta recuperación.', 403);
  }

  if (ticket.estado !== 'PROGRAMADA') {
    throw new ApiError('Solo puedes cancelar recuperaciones que estén programadas.', 400);
  }

  // 3. Lógica del Reloj (Validación de 1 hora)
  const ahora = new Date();
  ahora.setHours(ahora.getHours() - 5);

  // Armamos la fecha y hora exacta de la clase
  const fechaProg = new Date(ticket.fecha_programada);
  const horaInicio = new Date(ticket.horarios_clases.hora_inicio);

  const fechaClase = new Date(Date.UTC(
    fechaProg.getUTCFullYear(),
    fechaProg.getUTCMonth(),
    fechaProg.getUTCDate(),
    horaInicio.getUTCHours(),
    horaInicio.getUTCMinutes(),
    0,
    0
  ));

  // Calculamos la diferencia en milisegundos y la pasamos a horas
  const diferenciaMilisegundos = fechaClase.getTime() - ahora.getTime();
  const horasFaltantes = diferenciaMilisegundos / (1000 * 60 * 60);

  // Si falta menos de 1 hora o ya pasó la clase, no se puede cancelar.
  if (horasFaltantes < 1) {
    throw new ApiError(
      'Ya no puedes cancelar esta clase. Debes hacerlo con al menos 1 hora de anticipación.',
      400
    );
  }

  // 4. Devolvemos el ticket cancelado con estado PENDIENTE y sin programar.
  const ticketCancelado = await prisma.recuperaciones.update({
    where: {
      id: ticket.id
    },
    data: {
      estado: 'PENDIENTE',
      horario_destino_id: null,
      fecha_programada: null
    }
  });

  return ticketCancelado;
};

const obtenerHistorial = async (alumnoId) => {
  const historial = await prisma.recuperaciones.findMany({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['PROGRAMADA', 'VENCIDA', 'COMPLETADA_FALTA', 'COMPLETADA_PRESENTE'] },
    },
    include: {
      horarios_clases: {
        include: {
          canchas: {
            include: { sedes: true }
          },
          coordinadores: {
            include: {
              usuarios: {
                select: {
                  nombres: true,
                  apellidos: true
                }
              }
            }
          },
          niveles_entrenamiento: true
        }
      }
    },
    orderBy: {
      fecha_falta: 'desc',
    },
  });

  return historial;
}

const obtenerPendientes = async (alumnoId) => {
  const inscripciones = await prisma.inscripciones.findMany({
    where: {
      alumno_id: Number.parseInt(alumnoId)
    },
    include: {
      horarios_clases: true
    },
    orderBy: {
      fecha_inscripcion_original: 'asc',
    },
  });

  // Si no hay inscripción, devolvemos 0 tickets y stats en 0
  if (inscripciones.length === 0) {
    return {
      tickets: [],
      stats: { recuperacion_usadas: 0, limite_permitido: 0, dias_regulares: [], fin_ciclo_regular: null }
    };
  }

  const inicioInscripcion = new Date(inscripciones[0].fecha_inscripcion_original);
  inicioInscripcion.setHours(0, 0, 0, 0);

  // Traer fecha local y convertirla a string
  const fechaLocalTexto = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  // Crear un date con ese string forzando la hora en UTC (Z = UTC  /  -05:00 = GMT-5)
  const hoy = new Date(`${fechaLocalTexto}T00:00:00Z`);

  const clasesRegulares = await prisma.registros_asistencia.findMany({
    where: {
      inscripciones: {
        alumno_id: alumnoId,
      },
      fecha: {
        gte: hoy,
      }
    },
    select: {
      fecha: true,
      inscripciones: {
        select: {
          horarios_clases: {
            select: { hora_inicio: true, id: true }
          },
        }
      }
    }
  })

  const fechasClasesRegulares = [];
  for (const clase of clasesRegulares) {
    const fecha = clase.fecha;
    const hora = clase.inscripciones.horarios_clases.hora_inicio;

    const fechaStr = fecha.toISOString().split('T')[0];

    const horas = hora.getUTCHours().toString().padStart(2, '0');
    const minutos = hora.getUTCMinutes().toString().padStart(2, '0');

    const resultado = `${fechaStr}T${horas}:${minutos}`;

    fechasClasesRegulares.push({ fecha_clase: resultado, id_horario: clase.inscripciones.horarios_clases.id });
  }

  const pendientes = await prisma.recuperaciones.findMany({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: 'PENDIENTE',
    },
    orderBy: {
      fecha_falta: 'asc', // Las más antiguas primero para que las recupere pronto
    },
  });

  const cantidadInscripciones = await prisma.inscripciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['ACTIVO'] },
    },
  });

  const mesesPaquete = await calcularMesesPaquete(prisma, alumnoId, cantidadInscripciones);
  const limitePermitido = limiteRecuperaciones(cantidadInscripciones, mesesPaquete);

  const recuperacionesUsadas = await prisma.recuperaciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      es_por_lesion: false,
      estado: { in: ['PROGRAMADA', 'COMPLETADA_FALTA', 'COMPLETADA_PRESENTE'] },
      fecha_falta: { gte: inicioInscripcion },
    },
  });

  // Inyectamos en cada ticket sin lesión la fecha límite
  const fechaFinCiclo = await ultimaClaseRegular(prisma, alumnoId);
  const pendientesConFechaLimite = pendientes.map((ticket) => {

    if (ticket.es_por_lesion) {
      return {
        ...ticket,
        fecha_caducidad: null
      };
    }

    return {
      ...ticket,
      fecha_caducidad: fechaFinCiclo,
    };
  });

  return {
    tickets: pendientesConFechaLimite,
    stats: {
      recuperacion_usadas: recuperacionesUsadas,
      limite_permitido: limitePermitido,
      fechas_clases_regulares: fechasClasesRegulares,
    }
  };
};

/**
 * Valida TODAS las reglas de negocio antes de permitir una recuperación.
 */
const validarElegibilidad = async (alumnoId, recuperacionId, fechaProgramada, horarioDestinoId) => {
  const fechaProgramadaDate = new Date(fechaProgramada);

  const faltaPendiente = await prisma.recuperaciones.findFirst({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      id: Number.parseInt(recuperacionId),
      estado: 'PENDIENTE',
    },
  });

  if (!faltaPendiente) {
    throw new ApiError(
      `Ticket de recuperación ${recuperacionId} no encontrado o no disponible.`,
      404
    );
  }

  const inscripciones = await prisma.inscripciones.findMany({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['ACTIVO'] },
    },
    orderBy: {
      fecha_inscripcion_original: 'asc',
    },
  });

  const hoyUTC = new Date();
  if (fechaProgramadaDate < hoyUTC) {
    throw new ApiError('La fecha programada no puede ser anterior a hoy.', 400);
  }

  // Traer fecha local y convertirla a string
  const fechaLocalTexto = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  // Crear un date con ese string forzando la hora en UTC (Z = UTC  /  -05:00 = GMT-5)
  const hoy = new Date(`${fechaLocalTexto}T00:00:00Z`);

  const clasesRegulares = await prisma.registros_asistencia.findMany({
    where: {
      inscripciones: {
        alumno_id: alumnoId,
      },
    },
    select: {
      fecha: true,
      inscripciones: {
        select: {
          horarios_clases: {
            select: { hora_inicio: true, id: true }
          },
        }
      }
    }
  })

  const fechasClasesRegulares = [];
  for (const clase of clasesRegulares) {
    const fecha = clase.fecha;
    const hora = clase.inscripciones.horarios_clases.hora_inicio;

    const fechaCompleta = new Date(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate(),
      hora.getUTCHours(),
      hora.getUTCMinutes(),
      0
    )

    fechasClasesRegulares.push({ fecha_clase: fechaCompleta, id_horario: clase.inscripciones.horarios_clases.id });
  }

  // Verificamos que su dia de recuperación no interfiera con el horario regular del alumno.
  const cruceHorarios = fechasClasesRegulares.some(f => f.fecha_clase.getTime() === fechaProgramadaDate.getTime() && f.id_horario === horarioDestinoId);

  if (cruceHorarios) {
    throw new ApiError(
      `No se puede agendar este día, corresponde a tu horario regular. Selecciona otro turno disponible.`,
      400
    );
  }
  //}

  // Por lesión omite las validaciones de las faltas normales.
  if (faltaPendiente.es_por_lesion) {
    return true;
  }

  // La recuperación debe caer a más tardar el último día de clases del ciclo.
  const fechaLimiteValida = await ultimaClaseRegular(prisma, alumnoId);

  // Traer fecha local y convertirla a string
  const fechaProgramadaTexto = fechaProgramadaDate.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  // Crear un date con ese string forzando la hora en UTC (Z = UTC  /  -05:00 = GMT-5)
  const fechaProgramadaLocal = new Date(`${fechaProgramadaTexto}T00:00:00Z`);

  if (fechaLimiteValida && fechaProgramadaLocal > fechaLimiteValida) {
    throw new ApiError('La recuperación debe realizarse a más tardar el último día de tus clases del ciclo.', 400);
  }

  // Si ya no cuenta con inscripciones activas, no es necesario que haya un límite, ya que no seguirá generando tickets.
  if (inscripciones.length === 0) return true;

  // ---------------------------------------------------------
  // 2. VALIDACIÓN DE TOPE DE CUPOS
  // ---------------------------------------------------------

  const recuperacionesRealizadas = await prisma.recuperaciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      es_por_lesion: false,
      fecha_falta: {
        gte: inscripciones[0].fecha_inscripcion_original,
      },
      estado: { in: ['PROGRAMADA', 'COMPLETADA_FALTA', 'COMPLETADA_PRESENTE'] },
    },
  });

  const mesesPaquete = await calcularMesesPaquete(prisma, alumnoId, inscripciones.length);
  const limitePermitido = limiteRecuperaciones(inscripciones.length, mesesPaquete);

  if (recuperacionesRealizadas >= limitePermitido) {
    throw new ApiError(`Has alcanzado tu límite de ${limitePermitido} recuperaciones.`, 400);
  }

  return true;
};

/**
 * Crea el registro de recuperación tras pasar validaciones y chequear aforo.
 */
const agendarRecuperacion = async ({ alumnoId, recuperacionId, horarioDestinoId, fechaProgramada }) => {
  // 1. Re-validar reglas de negocio (Doble check de seguridad)
  await validarElegibilidad(alumnoId, recuperacionId, fechaProgramada, horarioDestinoId);

  const soloFechaString = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Lima'
  }).format(new Date(fechaProgramada));

  const fechaFinalUTC = new Date(`${soloFechaString}T00:00:00.000Z`);

  // 2. VALIDACIÓN DE AFORO
  // Necesitamos saber si cabe un alumno más en esa clase específica
  const horarioDestino = await prisma.horarios_clases.findUnique({
    where: { id: Number.parseInt(horarioDestinoId) },
  });

  if (!horarioDestino) {
    throw new ApiError('El horario seleccionado no existe.', 404);
  }

  // A. Contar inscritos fijos en ese horario
  const inscritosFijos = await prisma.inscripciones.count({
    where: {
      horario_id: Number.parseInt(horarioDestinoId),
      estado: 'ACTIVO',
    },
  });

  // B. Contar recuperaciones agendadas para ESA fecha específica
  const recuperacionesEseDia = await prisma.recuperaciones.count({
    where: {
      horario_destino_id: Number.parseInt(horarioDestinoId),
      fecha_programada: fechaFinalUTC,
      estado: 'PROGRAMADA',
    },
  });

  const ocupacionTotal = inscritosFijos + recuperacionesEseDia;

  if (ocupacionTotal >= horarioDestino.capacidad_max) {
    throw new ApiError(
      'Lo sentimos, este horario ya no tiene cupos disponibles.',
      409
    );
  }

  // 3. ACTUALIZAR (UPDATE) EL REGISTRO EXISTENTE
  const recuperacionActualizada = await prisma.recuperaciones.update({
    where: {
      id: Number.parseInt(recuperacionId),
    },
    data: {
      horario_destino_id: Number.parseInt(horarioDestinoId),
      fecha_programada: fechaFinalUTC,
      estado: 'PROGRAMADA',
    },
  });

  return recuperacionActualizada;
};

const obtenerTodas = async () => {
  return await prisma.recuperaciones.findMany({
    include: {
      alumnos: {
        include: { usuarios: { select: { nombres: true, apellidos: true } } }
      },
      horarios_clases: {
        include: { canchas: true, niveles_entrenamiento: true }
      }
    },
    orderBy: { fecha_falta: 'desc' }
  });
};

const eliminarRecuperacionAdmin = async (recuperacionId) => {
  const ticket = await prisma.recuperaciones.findUnique({
    where: { id: Number.parseInt(recuperacionId) }
  });

  if (!ticket) {
    throw new ApiError('La recuperación no existe.', 404);
  }

  return await prisma.$transaction(async (tx) => {

    if (ticket.es_por_lesion) {
      // 1. Restaurar asistencia usando la relación directa
      // Si el ticket tiene el ID del registro de asistencia, lo usamos para ser exactos
      if (ticket.registro_asistencia_id) {
        await tx.registros_asistencia.update({
          where: { id: ticket.registro_asistencia_id },
          data: { estado: 'PROGRAMADA' }
        });
      }

      if (ticket.solicitud_lesion_id) {
        // 2. Desvincular de Congelamientos
        await tx.congelamientos.updateMany({
          where: { solicitud_lesion_id: ticket.solicitud_lesion_id },
          data: { solicitud_lesion_id: null }
        });

        // 3. Desvincular de otras posibles recuperaciones
        await tx.recuperaciones.updateMany({
          where: { solicitud_lesion_id: ticket.solicitud_lesion_id },
          data: { solicitud_lesion_id: null }
        });
      }

      // 4. Borrar la recuperación actual
      await tx.recuperaciones.delete({
        where: { id: ticket.id }
      });

      // 5. Borrar la solicitud de lesión definitiva
      if (ticket.solicitud_lesion_id) {
        await tx.solicitudes_lesion.delete({
          where: { id: ticket.solicitud_lesion_id }
        });
      }

      return { message: 'Depuración exacta completada.' };

    } else {
      // Si era una falta anticipada, restauramos la clase original a PROGRAMADA
      if (ticket.registro_asistencia_id && ticket.motivo_falta === 'FALTA_ANTICIPADA') {
        const reg = await tx.registros_asistencia.findUnique({ where: { id: ticket.registro_asistencia_id } });
        if (reg) {
          await tx.registros_asistencia.update({
            where: { id: reg.id },
            data: {
              estado: 'PROGRAMADA',
              comentario: (reg.comentario || '').replace('[FALTA_ANTICIPADA]', '').trim(),
            },
          });
        }
      }
      return await tx.recuperaciones.delete({
        where: { id: ticket.id }
      });
    }
  });
};

const obtenerRecuperacionesParaDepuracion = async () => {
  try {
    const data = await prisma.recuperaciones.findMany({
      include: {
        // 1. Datos del Alumno y su Usuario (Para saber a quién borrar)
        alumnos: {
          include: {
            usuarios: {
              select: {
                nombres: true,
                apellidos: true
              }
            }
          }
        },
        // 2. Sede de DESTINO (Solo traerá datos si el ticket ya fue agendado)
        horarios_clases: {
          include: {
            canchas: {
              include: {
                sedes: true
              }
            },
            niveles_entrenamiento: true
          }
        }
        // 🛑 Se eliminó registros_asistencia para evitar el Error 500
        // debido a la falta de relación definida en el schema.prisma
      },
      orderBy: {
        fecha_falta: 'desc'
      }
    });
    return data;
  } catch (error) {
    console.error("❌ ERROR EN OBTENER DEPURECIÓN:", error);
    throw error;
  }
};

// Exportamos el objeto con las funciones
export const recuperacionService = {
  obtenerPendientes,
  validarElegibilidad,
  agendarRecuperacion,
  registrarFaltaPendiente,
  anularFaltaPendiente,
  cancelarRecuperacion,
  obtenerHistorial,
  obtenerTodas,
  eliminarRecuperacionAdmin,
  obtenerRecuperacionesParaDepuracion,
};
