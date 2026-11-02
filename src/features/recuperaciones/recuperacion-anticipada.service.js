// =================================================================
// 🗓️ RECUPERACIÓN ANTICIPADA
//
// El alumno avisa ANTES de la clase que no irá. En ese momento:
//   1. La clase regular queda marcada con la etiqueta [FALTA_ANTICIPADA] en
//      `registros_asistencia.comentario` (el estado sigue siendo PROGRAMADA:
//      la tabla tiene check constraints sobre `estado`, así que NO se inventa
//      un estado nuevo). El coordinador la ve como "Avisó falta".
//   2. Se crea el ticket de recuperación (PENDIENTE) respetando las reglas del
//      paquete actual: cupo por días/semana, sin deuda PARCIAL, etc.
//   3. Opcionalmente se agenda la recuperación en el mismo paso, reutilizando
//      `agendarRecuperacion` (aforo, fecha fin de ciclo, cruces, cupo).
//
// Compatibilidad con el flujo existente:
//   - Si el coordinador marca FALTA ese día, `registrarFaltaPendiente`
//     encuentra el ticket por `registro_asistencia_id` y no duplica.
//   - Si marca PRESENTE, `anularFaltaPendiente` borra el ticket (el alumno sí
//     vino), igual que con cualquier falta corregida.
// =================================================================
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';
import {
  limiteRecuperaciones,
  calcularMesesPaquete,
  ultimaClaseRegular,
  recuperacionService,
} from './recuperacion.service.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_LIMA = 'America/Lima';
export const TAG_FALTA_ANTICIPADA = '[FALTA_ANTICIPADA]';
export const MOTIVO_FALTA_ANTICIPADA = 'FALTA_ANTICIPADA';
export const MINUTOS_MINIMOS_AVISO = 60;

const ESTADOS_TICKET_REVERSIBLES = ['PENDIENTE', 'PROGRAMADA'];

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' de una columna @db.Date (llega a las 00:00 UTC). */
export const claveDia = (fecha) => new Date(fecha).toISOString().slice(0, 10);

/** 'HH:mm' de una columna @db.Time (llega como Date de 1970 en UTC). */
export const horaHHmm = (hora) => {
  if (!hora) return '00:00';
  const d = new Date(hora);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** Momento real de inicio de la clase, en hora de Lima. */
export const inicioClaseLima = (fecha, horaInicio) =>
  dayjs.tz(`${claveDia(fecha)}T${horaHHmm(horaInicio)}:00`, TZ_LIMA);

/** ¿Todavía se puede avisar / cancelar? (mínimo 1 hora antes del inicio). */
export const avisoATiempo = (inicioClase, ahora = dayjs()) =>
  inicioClase.diff(ahora, 'minute') >= MINUTOS_MINIMOS_AVISO;

const quitarTag = (comentario) =>
  (comentario || '').replace(TAG_FALTA_ANTICIPADA, '').trim();

/**
 * Cupo del paquete actual. Cuenta igual que `registrarFaltaPendiente`
 * (tickets normales desde la primera inscripción activa) para que ambos
 * caminos se agoten exactamente al mismo tiempo.
 */
export const cargarCupoPaquete = async (cliente, alumnoId) => {
  const id = Number.parseInt(alumnoId);

  const activas = await cliente.inscripciones.findMany({
    where: { alumno_id: id, estado: 'ACTIVO' },
    orderBy: { fecha_inscripcion_original: 'asc' },
    select: { id: true, fecha_inscripcion_original: true },
  });

  const mesesPaquete = await calcularMesesPaquete(cliente, id, activas.length);
  const limite = limiteRecuperaciones(activas.length, mesesPaquete);

  let usadas = 0;
  if (activas.length > 0 && activas[0].fecha_inscripcion_original) {
    const inicio = new Date(activas[0].fecha_inscripcion_original);
    inicio.setHours(0, 0, 0, 0);
    usadas = await cliente.recuperaciones.count({
      where: { alumno_id: id, es_por_lesion: false, fecha_falta: { gte: inicio } },
    });
  }

  const parcial = await cliente.cuentas_por_cobrar.findFirst({
    where: { alumno_id: id, estado: 'PARCIAL' },
    select: { id: true },
  });

  return {
    limite_permitido: limite,
    recuperacion_usadas: usadas,
    disponibles: Math.max(0, limite - usadas),
    bloqueado_por_deuda: Boolean(parcial),
    inscripciones_activas: activas.length,
  };
};

/**
 * Lista las próximas clases regulares del alumno con lo que puede hacer en
 * cada una (avisar falta / cancelar aviso) y el cupo del paquete.
 */
const obtenerClasesAnticipables = async (alumnoId) => {
  const id = Number.parseInt(alumnoId);
  const ahora = dayjs();
  const hoyKey = ahora.tz(TZ_LIMA).format('YYYY-MM-DD');
  const hoy = new Date(`${hoyKey}T00:00:00Z`);

  const registros = await prisma.registros_asistencia.findMany({
    where: {
      fecha: { gte: hoy },
      inscripciones: { alumno_id: id, estado: 'ACTIVO' },
    },
    include: {
      inscripciones: {
        select: {
          id: true,
          tipo_inscripcion: true,
          horarios_clases: {
            include: {
              canchas: { include: { sedes: true } },
              niveles_entrenamiento: true,
            },
          },
        },
      },
    },
    orderBy: { fecha: 'asc' },
  });

  const regulares = registros.filter(
    (r) =>
      !r.comentario?.includes('[RECUPERACION]') &&
      r.inscripciones?.tipo_inscripcion !== 'INDIVIDUAL' &&
      (r.estado === 'PROGRAMADA' || (r.estado === 'FALTA' && r.comentario?.includes(TAG_FALTA_ANTICIPADA)))
  );

  const tickets = regulares.length
    ? await prisma.recuperaciones.findMany({
        where: { alumno_id: id, registro_asistencia_id: { in: regulares.map((r) => r.id) } },
        include: { horarios_clases: { select: { id: true, hora_inicio: true, hora_fin: true } } },
      })
    : [];
  const ticketPorRegistro = new Map(tickets.map((t) => [t.registro_asistencia_id, t]));

  const [cupo, finCiclo] = await Promise.all([
    cargarCupoPaquete(prisma, id),
    ultimaClaseRegular(prisma, id),
  ]);

  const clases = regulares.map((r) => {
    const horario = r.inscripciones.horarios_clases;
    const ticket = ticketPorRegistro.get(r.id) || null;
    const faltaAnticipada = Boolean(r.comentario?.includes(TAG_FALTA_ANTICIPADA));
    const noRecuperable = Boolean(r.comentario?.includes('[NO_RECUPERABLE]'));
    const aTiempo = avisoATiempo(inicioClaseLima(r.fecha, horario?.hora_inicio), ahora);

    let recuperacionATiempo = true;
    if (ticket?.estado === 'PROGRAMADA' && ticket.fecha_programada) {
      recuperacionATiempo = avisoATiempo(
        inicioClaseLima(ticket.fecha_programada, ticket.horarios_clases?.hora_inicio),
        ahora
      );
    }

    return {
      registro_id: r.id,
      fecha: claveDia(r.fecha),
      hora_inicio: horaHHmm(horario?.hora_inicio),
      hora_fin: horaHHmm(horario?.hora_fin),
      horario_id: horario?.id ?? null,
      sede: horario?.canchas?.sedes?.nombre ?? null,
      cancha: horario?.canchas?.nombre ?? null,
      nivel: horario?.niveles_entrenamiento?.nombre ?? null,
      sede_id: horario?.canchas?.sedes?.id ?? null,
      sede: horario?.canchas?.sedes?.nombre ?? null,
      falta_anticipada: faltaAnticipada,
      no_recuperable: noRecuperable,
      a_tiempo: aTiempo,
      recuperacion: ticket
        ? {
            id: ticket.id,
            estado: ticket.estado,
            fecha_programada: ticket.fecha_programada ? claveDia(ticket.fecha_programada) : null,
            hora_inicio: ticket.horarios_clases ? horaHHmm(ticket.horarios_clases.hora_inicio) : null,
            hora_fin: ticket.horarios_clases ? horaHHmm(ticket.horarios_clases.hora_fin) : null,
          }
        : null,
      puede_avisar: !faltaAnticipada && !noRecuperable && !ticket && aTiempo,
      puede_cancelar:
        faltaAnticipada &&
        aTiempo &&
        Boolean(ticket) &&
        ESTADOS_TICKET_REVERSIBLES.includes(ticket.estado) &&
        recuperacionATiempo,
    };
  });

  return {
    clases,
    stats: { ...cupo, fecha_fin_ciclo: finCiclo ? claveDia(finCiclo) : null },
  };
};

/** Deshace un aviso: borra el ticket (si sigue reversible) y quita la etiqueta. */
const revertirAviso = async (tx, alumnoId, registroId) => {
  await tx.recuperaciones.deleteMany({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      registro_asistencia_id: registroId,
      es_por_lesion: false,
      estado: { in: ESTADOS_TICKET_REVERSIBLES },
    },
  });
  const registro = await tx.registros_asistencia.findUnique({ where: { id: registroId } });
  if (registro?.comentario?.includes(TAG_FALTA_ANTICIPADA) || registro?.estado === 'FALTA') {
    await tx.registros_asistencia.update({
      where: { id: registroId },
      data: {
        estado: 'PROGRAMADA',
        comentario: quitarTag(registro.comentario),
      },
    });
  }
};

/**
 * Marca una clase futura como falta anticipada y crea su ticket.
 * Si llegan `horarioDestinoId` + `fechaProgramada`, además agenda la
 * recuperación; si el agendamiento falla, se deshace todo.
 */
const marcarFaltaAnticipada = async (alumnoId, { registroId, horarioDestinoId, fechaProgramada } = {}) => {
  const idAlumno = Number.parseInt(alumnoId);
  const idRegistro = Number.parseInt(registroId);

  if (!Number.isInteger(idRegistro) || idRegistro <= 0) {
    throw new ApiError('Debes indicar la clase a la que vas a faltar.', 400);
  }
  if (Boolean(horarioDestinoId) !== Boolean(fechaProgramada)) {
    throw new ApiError('Para agendar la recuperación indica horario y fecha.', 400);
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const registro = await tx.registros_asistencia.findUnique({
      where: { id: idRegistro },
      include: { inscripciones: { include: { horarios_clases: true } } },
    });

    if (!registro || registro.inscripciones?.alumno_id !== idAlumno) {
      throw new ApiError('La clase no existe o no te pertenece.', 404);
    }
    if (registro.inscripciones.estado !== 'ACTIVO') {
      throw new ApiError('La clase no pertenece a un paquete activo.', 400);
    }
    if (registro.inscripciones.tipo_inscripcion === 'INDIVIDUAL') {
      throw new ApiError('Las clases sueltas no generan recuperación.', 400);
    }
    if (registro.estado !== 'PROGRAMADA' || registro.comentario?.includes('[RECUPERACION]')) {
      throw new ApiError('Solo puedes avisar falta en una clase regular programada.', 400);
    }
    if (registro.comentario?.includes('[NO_RECUPERABLE]')) {
      throw new ApiError('Esta clase está marcada como no recuperable.', 400);
    }
    if (registro.comentario?.includes(TAG_FALTA_ANTICIPADA)) {
      throw new ApiError('Ya avisaste que faltarás a esta clase.', 409);
    }
    if (!avisoATiempo(inicioClaseLima(registro.fecha, registro.inscripciones.horarios_clases?.hora_inicio))) {
      throw new ApiError('Debes avisar con al menos 1 hora de anticipación.', 400);
    }

    const existente = await tx.recuperaciones.findFirst({
      where: { alumno_id: idAlumno, registro_asistencia_id: idRegistro },
    });
    if (existente) {
      throw new ApiError('Esta clase ya tiene una recuperación asociada.', 409);
    }

    const cupo = await cargarCupoPaquete(tx, idAlumno);
    if (cupo.bloqueado_por_deuda) {
      throw new ApiError('Debes completar el pago de tu paquete para generar recuperaciones.', 400);
    }
    if (cupo.disponibles <= 0) {
      throw new ApiError(`Ya usaste tus ${cupo.limite_permitido} recuperación(es) de este ciclo.`, 400);
    }

    await tx.registros_asistencia.update({
      where: { id: idRegistro },
      data: {
        estado: 'FALTA',
        comentario: `${TAG_FALTA_ANTICIPADA} ${registro.comentario || ''}`.trim(),
      },
    });

    return tx.recuperaciones.create({
      data: {
        alumno_id: idAlumno,
        fecha_falta: registro.fecha,
        motivo_falta: MOTIVO_FALTA_ANTICIPADA,
        estado: 'PENDIENTE',
        registro_asistencia_id: idRegistro,
      },
    });
  });

  if (!horarioDestinoId) {
    return { ticket, agendada: false };
  }

  try {
    const agendada = await recuperacionService.agendarRecuperacion({
      alumnoId: idAlumno,
      recuperacionId: ticket.id,
      horarioDestinoId: Number.parseInt(horarioDestinoId),
      fechaProgramada,
    });
    return { ticket: agendada, agendada: true };
  } catch (error) {
    await prisma.$transaction((tx) => revertirAviso(tx, idAlumno, idRegistro));
    throw error;
  }
};

/** Cancela el aviso (vuelve a ir a la clase) y libera el ticket/cupo. */
const cancelarFaltaAnticipada = async (alumnoId, registroId) => {
  const idAlumno = Number.parseInt(alumnoId);
  const idRegistro = Number.parseInt(registroId);

  return prisma.$transaction(async (tx) => {
    const registro = await tx.registros_asistencia.findUnique({
      where: { id: idRegistro },
      include: { inscripciones: { include: { horarios_clases: true } } },
    });

    if (!registro || registro.inscripciones?.alumno_id !== idAlumno) {
      throw new ApiError('La clase no existe o no te pertenece.', 404);
    }
    if (!registro.comentario?.includes(TAG_FALTA_ANTICIPADA)) {
      throw new ApiError('Esta clase no tiene un aviso de falta.', 400);
    }
    if (!avisoATiempo(inicioClaseLima(registro.fecha, registro.inscripciones.horarios_clases?.hora_inicio))) {
      throw new ApiError('Ya no puedes cancelar el aviso: falta menos de 1 hora para la clase.', 400);
    }

    const ticket = await tx.recuperaciones.findFirst({
      where: { alumno_id: idAlumno, registro_asistencia_id: idRegistro },
      include: { horarios_clases: { select: { hora_inicio: true } } },
    });
    if (ticket && !ESTADOS_TICKET_REVERSIBLES.includes(ticket.estado)) {
      throw new ApiError('La recuperación de esta falta ya se usó; no se puede cancelar.', 400);
    }
    if (
      ticket?.estado === 'PROGRAMADA' &&
      ticket.fecha_programada &&
      !avisoATiempo(inicioClaseLima(ticket.fecha_programada, ticket.horarios_clases?.hora_inicio))
    ) {
      throw new ApiError('Tu recuperación empieza en menos de 1 hora; ya no se puede cancelar.', 400);
    }

    await revertirAviso(tx, idAlumno, idRegistro);
    return { registro_id: idRegistro, cancelado: true };
  });
};

export const recuperacionAnticipadaService = {
  obtenerClasesAnticipables,
  marcarFaltaAnticipada,
  cancelarFaltaAnticipada,
};

