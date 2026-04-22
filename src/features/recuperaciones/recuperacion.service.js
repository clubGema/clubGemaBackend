import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';

// Crear registro de recuperacion pendiente en caso sea marcado como FALTA.
const registrarFaltaPendiente = async (tx, alumnoId, fechaFalta, asistenciaId) => {

  const cantidadInscripciones = await tx.inscripciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['ACTIVO', 'PEN-RECU'] },
    },
  });

  // Si tiene menos de 2 inscripciones, entonces no se crea una recuperacion pendiente.
  if (cantidadInscripciones < 2) {
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
    console.log('El alumno aún no realiza el pago total.');
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
      estado: { in: ['ACTIVO', 'PEN-RECU'] },
    },
    orderBy: {
      fecha_inscripcion_original: 'asc',
    },
  });

  if (!inscripcion) {
    throw new ApiError('No se encontró una inscripción activa para este alumno.', 404);
  }

  const inicioInscripcion = new Date(inscripcion.fecha_inscripcion_original);
  inicioInscripcion.setHours(0, 0, 0, 0);
  const fechaFaltaDate = new Date(fechaFalta);

  const diffFalta = fechaFaltaDate - inicioInscripcion;
  const diasTranscurridosFalta = Math.floor(diffFalta / (1000 * 60 * 60 * 24));

  if (diasTranscurridosFalta < 0) {
    throw new ApiError('La fecha de la falta es anterior a la fecha de inscripción.', 400);
  }

  const numeroBloqueFalta = Math.floor(diasTranscurridosFalta / 30);

  const inicioCicloFalta = new Date(inicioInscripcion);
  inicioCicloFalta.setUTCDate(inicioInscripcion.getUTCDate() + numeroBloqueFalta * 30);

  const finCicloFalta = new Date(inicioInscripcion);
  finCicloFalta.setUTCDate(inicioInscripcion.getUTCDate() + (numeroBloqueFalta + 1) * 30);

  const ticketsEnCiclo = await tx.recuperaciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      es_por_lesion: false, // No contamos los tickets VIP
      fecha_falta: {
        gte: inicioCicloFalta,
        lt: finCicloFalta,
      }
    },
  });

  // Definir su límite según su plan
  const limitePermitido = cantidadInscripciones >= 4 ? 4 : 2;

  // Si ya llegó al tope, abortamos la creación del ticket
  if (ticketsEnCiclo >= limitePermitido) {
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
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['ACTIVO', 'PEN-RECU'] },
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

  const finCicloRegular = new Date(inicioInscripcion);
  finCicloRegular.setUTCDate(inicioInscripcion.getUTCDate() + 29);

  // // Buscamos los dias de los horarios que coincidan con el alumno
  // const diasRegulares = inscripciones
  //   .map(i => i.horarios_clases?.dia_semana)
  //   .filter(Boolean); // Array con los días en int

  // Buscamos horarios que coincidan con el alumno
  const horariosRegularesIDs = inscripciones.map(i => i.horario_id).filter(Boolean);

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
      estado: { in: ['ACTIVO', 'PEN-RECU'] },
    },
  });

  const limitePermitido = cantidadInscripciones >= 4 ? 4 : 2;

  const recuperacionesUsadas = await prisma.recuperaciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      es_por_lesion: false,
      estado: { in: ['PROGRAMADA', 'COMPLETADA_FALTA', 'COMPLETADA_PRESENTE'] },
      fecha_falta: { gte: inicioInscripcion },
    },
  });

  // // Si no hay inscripción activa, devolvemos los tickets tal cual. COMENTADO: (POR SEGURIDAD, MEJOR DEVOLVER UN ARRAY VACIO)
  // if (!inscripcion) {
  //   return pendientes.map(p => ({ ...p, fecha_caducidad: null }));
  // }

  // Inyectamos en cada ticket sin lesión la fecha límite
  const pendientesConFechaLimite = pendientes.map((ticket) => {

    if (ticket.es_por_lesion) {
      return {
        ...ticket,
        fecha_caducidad: null
      };
    }

    const fechaFaltaDate = new Date(ticket.fecha_falta);

    const diffFalta = fechaFaltaDate - inicioInscripcion;
    const diasTranscurridosFalta = Math.floor(diffFalta / (1000 * 60 * 60 * 24));

    // Protección por si la fecha de falta es anterior a la inscripción (Para casos aislados de migración)
    if (diasTranscurridosFalta < 0) {
      return { ...ticket, fecha_caducidad: null };
    }

    const numeroBloqueFalta = Math.floor(diasTranscurridosFalta / 30);

    const finCicloFalta = new Date(inicioInscripcion);
    finCicloFalta.setUTCDate(inicioInscripcion.getUTCDate() + (numeroBloqueFalta + 1) * 30);

    const fechaLimiteValida = new Date(finCicloFalta);
    fechaLimiteValida.setUTCDate(finCicloFalta.getUTCDate() + 29);

    return {
      ...ticket,
      fecha_caducidad: fechaLimiteValida,
    };
  });

  return {
    tickets: pendientesConFechaLimite,
    stats: {
      recuperacion_usadas: recuperacionesUsadas,
      limite_permitido: limitePermitido,
      horarios_regulares: horariosRegularesIDs,
      fin_ciclo_regular: finCicloRegular,
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
      'No se encontró una falta pendiente para esta fecha. Puede que ya haya sido recuperada o no se haya registrado la inasistencia aún.',
      404
    );
  }

  const fechaFaltaDate = new Date(faltaPendiente.fecha_falta);

  const inscripciones = await prisma.inscripciones.findMany({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: { in: ['ACTIVO', 'PEN-RECU'] },
    },
    include: {
      horarios_clases: true,
    },
    orderBy: {
      fecha_inscripcion_original: 'asc',
    },
  });

  if (inscripciones.length === 0) {
    throw new ApiError('No tienes una inscripción activa.', 403);
  }

  const hoyUTC = new Date();
  if (fechaProgramadaDate < hoyUTC) {
    throw new ApiError('La fecha programada no puede ser anterior a hoy.', 400);
  }

  fechaProgramadaDate.setHours(fechaProgramadaDate.getHours() - 5);

  const inicioInscripcion = new Date(inscripciones[0].fecha_inscripcion_original);
  inicioInscripcion.setHours(0, 0, 0, 0);

  const finCicloRegular = new Date(inicioInscripcion);
  finCicloRegular.setUTCDate(inicioInscripcion.getUTCDate() + 30);

  // Si la recuperación se quiere agendar dentro del ciclo de clases, validamos que no cruce con su horario regular.
  if (fechaProgramadaDate < finCicloRegular) {
    // // Validacion para que no agende recuperación el mismo día de su clase regular
    // const indiceDiaAgendado = (fechaProgramadaDate.getUTCDay() === 0) ? 7 : fechaProgramadaDate.getUTCDay(); // 1:Lunes ... 7:Domingo

    // Verificamos que su dia de recuperación no interfiera con el horario regular del alumno.
    const cruceHorarios = inscripciones.some(
      (inscripcion) => inscripcion.horario_id === Number.parseInt(horarioDestinoId)
    );

    if (cruceHorarios) {
      throw new ApiError(
        `No se puede agendar este día, corresponde a tu horario regular. Selecciona otro turno disponible.`,
        400
      );
    }
  }

  // Por lesión omite las validaciones de las faltas normales.
  if (faltaPendiente.es_por_lesion) {
    return true;
  }

  // ---------------------------------------------------------
  // 1. VALIDACIÓN DE PLAN (Mínimo 2 veces por semana)
  // ---------------------------------------------------------

  // Cantidad de clases inscritas < 2
  if (inscripciones.length < 2) {
    throw new ApiError('Tu plan actual no incluye el beneficio de recuperaciones.', 403);
  }

  // ---------------------------------------------------------
  // 2. CÁLCULO DEL CICLO DE LA FALTA
  // ---------------------------------------------------------

  // Calculamos a qué ciclo pertenece la falta
  const diffFalta = fechaFaltaDate - inicioInscripcion;
  const diasTranscurridosFalta = Math.floor(diffFalta / (1000 * 60 * 60 * 24));

  if (diasTranscurridosFalta < 0) {
    throw new ApiError('La fecha de la falta es anterior a tu inscripción.', 400);
  }

  const numeroBloqueFalta = Math.floor(diasTranscurridosFalta / 30);

  // Inicio y Fin del ciclo donde ocurrió la falta
  const inicioCicloFalta = new Date(inicioInscripcion);
  inicioCicloFalta.setUTCDate(inicioInscripcion.getUTCDate() + numeroBloqueFalta * 30);

  const finCicloFalta = new Date(inicioInscripcion);
  finCicloFalta.setUTCDate(inicioInscripcion.getUTCDate() + (numeroBloqueFalta + 1) * 30);

  // ---------------------------------------------------------
  // 3. VALIDACIÓN DE VIGENCIA (Fin del ciclo de falta + 30 días)
  // ---------------------------------------------------------

  const fechaLimiteValida = new Date(finCicloFalta);
  fechaLimiteValida.setUTCDate(finCicloFalta.getUTCDate() + 30);

  if (fechaProgramadaDate >= fechaLimiteValida) {
    throw new ApiError('La vigencia para recuperar esta falta ha expirado o sobrepasa la fecha límite.', 400);
  }

  // ---------------------------------------------------------
  // 4. VALIDACIÓN DE TOPE DE CUPOS
  // ---------------------------------------------------------
  const recuperacionesEnCiclo = await prisma.recuperaciones.count({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      es_por_lesion: false,
      fecha_falta: {
        gte: inicioCicloFalta,
        lt: finCicloFalta,
      },
      estado: { in: ['PROGRAMADA', 'COMPLETADA_FALTA', 'COMPLETADA_PRESENTE'] },
    },
  });

  let limitePermitido = 2;
  // Cantidad de clases inscritas >= 4
  if (inscripciones.length >= 4) {
    limitePermitido = 4;
  }

  if (recuperacionesEnCiclo >= limitePermitido) {
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
// Añadir a recuperacion.service.js

const eliminarRecuperacionAdmin = async (recuperacionId) => {
  const ticket = await prisma.recuperaciones.findUnique({
    where: { id: Number.parseInt(recuperacionId) }
  });

  if (!ticket) {
    throw new ApiError('La recuperación no existe.', 404);
  }

  // Eliminamos el ticket. 
  // Al eliminarlo, el alumno ya no verá el "botón" para agendar esta falta.
  return await prisma.recuperaciones.delete({
    where: { id: Number.parseInt(recuperacionId) }
  });
};

// recuperacion.service.js

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
