import fs from 'fs';

const filePath = 'd:/AcademiaGema/academiaGemaBackend/src/features/recuperaciones/recuperacion.service.js';
let content = fs.readFileSync(filePath, 'utf8');
const isCRLF = content.includes('\r\n');
content = content.replace(/\r\n/g, '\n');

// 1. Imports at top
const targetImports = `import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';`;

const replacementImports = `import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';

// fix de zona horaria - Configuración estándar para Lima (UTC-5) sin desfase
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);
const TZ_LIMA = 'America/Lima';

// fix de zona horaria - Extractor plano YYYY-MM-DD inmune a timezone local o UTC
export const claveDia = (fecha) => {
  if (!fecha) return null;
  if (typeof fecha === 'string') {
    const match = fecha.match(/^(\\d{4}-\\d{2}-\\d{2})/);
    if (match) return match[1];
  }
  return new Date(fecha).toISOString().slice(0, 10);
};

// fix de zona horaria - Formateador HH:mm de horas guardadas en base de datos
export const horaHHmm = (hora) => {
  if (!hora) return '00:00';
  const d = new Date(hora);
  return \`\${String(d.getUTCHours()).padStart(2, '0')}:\${String(d.getUTCMinutes()).padStart(2, '0')}\`;
};`;

// 2. cancelarRecuperacion
const targetCancelar = `  // 3. Lógica del Reloj (Validación de 1 hora)
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
  }`;

const replacementCancelar = `  // fix de zona horaria - Validación de 1 hora con Dayjs en America/Lima inmune a medianoches y desajuste UTC
  const ahoraLima = dayjs().tz(TZ_LIMA);
  const diaTexto = claveDia(ticket.fecha_programada);
  const horaTexto = horaHHmm(ticket.horarios_clases?.hora_inicio);
  const fechaHoraClaseLima = dayjs.tz(\`\${diaTexto}T\${horaTexto}:00\`, TZ_LIMA);

  // Si falta menos de 1 hora (60 minutos) o ya pasó la clase, no se puede cancelar.
  if (fechaHoraClaseLima.diff(ahoraLima, 'minute') < 60) {
    throw new ApiError(
      'Ya no puedes cancelar esta clase. Debes hacerlo con al menos 1 hora de anticipación.',
      400
    );
  }`;

// 3. validarElegibilidad - cruce
const targetValidarCruce = `  const hoyUTC = new Date();
  if (fechaProgramadaDate < hoyUTC) {
    throw new ApiError('La fecha programada no puede ser anterior a hoy.', 400);
  }

  // Traer fecha local y convertirla a string
  const fechaLocalTexto = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  // Crear un date con ese string forzando la hora en UTC (Z = UTC  /  -05:00 = GMT-5)
  const hoy = new Date(\`\${fechaLocalTexto}T00:00:00Z\`);

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
      \`No se puede agendar este día, corresponde a tu horario regular. Selecciona otro turno disponible.\`,
      400
    );
  }`;

const replacementValidarCruce = `  // fix de zona horaria - Validación de fecha programada contra hoy en Lima (YYYY-MM-DD)
  const hoyLimaKey = dayjs().tz(TZ_LIMA).format('YYYY-MM-DD');
  const diaProgramadoKey = claveDia(fechaProgramada);
  if (diaProgramadoKey < hoyLimaKey) {
    throw new ApiError('La fecha programada no puede ser anterior a hoy.', 400);
  }

  // fix de zona horaria - Detección de cruce por fecha plana YYYY-MM-DD y rango horario sin descalce de milisegundos
  const horarioDestino = await prisma.horarios_clases.findUnique({
    where: { id: Number.parseInt(horarioDestinoId) },
    select: { hora_inicio: true, hora_fin: true }
  });

  const destInicio = horaHHmm(horarioDestino?.hora_inicio);
  const destFin = horaHHmm(horarioDestino?.hora_fin);

  // 1. Cruce con clases regulares del alumno ese día
  const clasesRegulares = await prisma.registros_asistencia.findMany({
    where: {
      inscripciones: { alumno_id: Number.parseInt(alumnoId) },
      estado: 'PROGRAMADA',
    },
    select: {
      fecha: true,
      inscripciones: {
        select: {
          horarios_clases: {
            select: { hora_inicio: true, hora_fin: true, id: true }
          },
        }
      }
    }
  });

  const cruceConRegular = clasesRegulares.some((clase) => {
    const diaClase = claveDia(clase.fecha);
    if (diaClase !== diaProgramadoKey) return false;
    const regInicio = horaHHmm(clase.inscripciones?.horarios_clases?.hora_inicio);
    const regFin = horaHHmm(clase.inscripciones?.horarios_clases?.hora_fin);
    return destInicio < regFin && destFin > regInicio;
  });

  if (cruceConRegular) {
    throw new ApiError(
      'No se puede agendar este día, corresponde a tu horario regular. Selecciona otro turno disponible.',
      400
    );
  }

  // 2. Cruce con OTRA recuperación ya programada del mismo alumno ese día
  const otrasRecuperaciones = await prisma.recuperaciones.findMany({
    where: {
      alumno_id: Number.parseInt(alumnoId),
      estado: 'PROGRAMADA',
      id: { not: Number.parseInt(recuperacionId) },
    },
    select: {
      fecha_programada: true,
      horarios_clases: { select: { hora_inicio: true, hora_fin: true } }
    }
  });

  const cruceConOtraRecu = otrasRecuperaciones.some((recu) => {
    const diaRecu = claveDia(recu.fecha_programada);
    if (diaRecu !== diaProgramadoKey) return false;
    const otraInicio = horaHHmm(recu.horarios_clases?.hora_inicio);
    const otraFin = horaHHmm(recu.horarios_clases?.hora_fin);
    return destInicio < otraFin && destFin > otraInicio;
  });

  if (cruceConOtraRecu) {
    throw new ApiError(
      'Ya tienes otra clase de recuperación programada en este mismo horario.',
      400
    );
  }`;

// 4. validarElegibilidad - fecha fin ciclo
const targetFechaFin = `  // La recuperación debe caer a más tardar el último día de clases del ciclo.
  const fechaLimiteValida = await ultimaClaseRegular(prisma, alumnoId);

  // Traer fecha local y convertirla a string
  const fechaProgramadaTexto = fechaProgramadaDate.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  // Crear un date con ese string forzando la hora en UTC (Z = UTC  /  -05:00 = GMT-5)
  const fechaProgramadaLocal = new Date(\`\${fechaProgramadaTexto}T00:00:00Z\`);

  if (fechaLimiteValida && fechaProgramadaLocal > fechaLimiteValida) {
    throw new ApiError('La recuperación debe realizarse a más tardar el último día de tus clases del ciclo.', 400);
  }`;

const replacementFechaFin = `  // fix de zona horaria - Comparación de fecha fin de ciclo usando cadenas planas YYYY-MM-DD
  const fechaLimiteValida = await ultimaClaseRegular(prisma, alumnoId);
  if (fechaLimiteValida && diaProgramadoKey > claveDia(fechaLimiteValida)) {
    throw new ApiError('La recuperación debe realizarse a más tardar el último día de tus clases del ciclo.', 400);
  }`;

// 5. agendarRecuperacion - formato
const targetAgendar = `  const soloFechaString = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Lima'
  }).format(new Date(fechaProgramada));

  const fechaFinalUTC = new Date(\`\${soloFechaString}T00:00:00.000Z\`);`;

const replacementAgendar = `  // fix de zona horaria - Normalización canónica de fecha plana YYYY-MM-DD sin saltos de huso
  const soloFechaString = claveDia(fechaProgramada);
  const fechaFinalUTC = new Date(\`\${soloFechaString}T00:00:00.000Z\`);`;

console.log('Includes targetImports?', content.includes(targetImports));
console.log('Includes targetCancelar?', content.includes(targetCancelar));
console.log('Includes targetValidarCruce?', content.includes(targetValidarCruce));
console.log('Includes targetFechaFin?', content.includes(targetFechaFin));
console.log('Includes targetAgendar?', content.includes(targetAgendar));

if (
  content.includes(targetImports) &&
  content.includes(targetCancelar) &&
  content.includes(targetValidarCruce) &&
  content.includes(targetFechaFin) &&
  content.includes(targetAgendar)
) {
  content = content.replace(targetImports, replacementImports);
  content = content.replace(targetCancelar, replacementCancelar);
  content = content.replace(targetValidarCruce, replacementValidarCruce);
  content = content.replace(targetFechaFin, replacementFechaFin);
  content = content.replace(targetAgendar, replacementAgendar);
  if (isCRLF) content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: recuperacion.service.js successfully shielded!');
} else {
  console.error('Failed to match all targets in recuperacion.service.js');
}

