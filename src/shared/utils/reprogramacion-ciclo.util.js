import dayjs from 'dayjs';
import { aFechaUTC, sumarDiasUTC, diasEntreUTC } from './ciclo.util.js';
import { claveDiaDesdeFecha } from './feriado.util.js';

// =================================================================
// 🔧 BL-005: el ciclo de deuda tiene que seguir a la clase REAL.
//
// Estado previo: `reprogramarMasivamente` movía la clase al final del ciclo y
// movía `inscripciones.fecha_inscripcion`, pero NUNCA tocaba
// `inscripciones_deudas_link.fecha_inicio_ciclo`, que es donde vive de verdad
// la vigencia del ciclo (ver la cabecera de ciclo.util.js). Si la clase
// reprogramada era la PRIMERA del ciclo, el alumno quedaba con un inicio de
// ciclo en una fecha en la que ya no entrena, y el historial por mes (BL-012),
// el exportador (BL-013) y el badge de vigencia mostraban una ventana
// desfasada.
//
// 🚩 INVARIANTE DE BL-006 QUE ACÁ SE RESPETA:
// para una inscripción REGULAR `fecha_fin_ciclo` se queda en NULL = VIGENTE.
// El cierre NO se escribe a mano: lo deriva `finCicloEfectivo()` y lo aplica el
// cron VERDUGO contando 30 días desde `fecha_inscripcion`. Por eso "recalcular
// el cierre" se traduce en mover `fecha_inscripcion`, no en grabar
// `fecha_fin_ciclo` (escribirlo rompería `es_vigente` del historial, el VERDUGO
// y la renovación, que buscan los links con `fecha_fin_ciclo: null`).
// Ver pagos.service.js:272-282.
//
// 🧱 Vive en shared/ y no en el feature `clases` porque los TRES sitios que
// mueven clases necesitan exactamente la misma aritmética: el masivo, su
// reversión y el cron que sincroniza a los inscritos tardíos. Una cuarta copia
// divergente es justo lo que pasó con `calcularSiguienteDia`, hoy duplicado en
// clase.service.js:51, asistencia-cron.service.js:22 y clase-cron.service.js:30.
// =================================================================

/**
 * Estados de `registros_asistencia` que cuentan como "clase del ciclo".
 *
 * ⚠️ NO se reusa `ESTADOS_VALIDOS_PARA_CICLO` de ciclo.util.js: ese set omite
 * `PENDIENTE`, que es exactamente el estado de las reposiciones que crea la
 * reprogramación, así que acá dejaría fuera clases que sí cuentan.
 * Se excluyen `CANCELADO` (feriado), `SIN_REGISTRO` y `REPROGRAMADO` (la clase
 * que se movió ya no ocurre en esa fecha).
 */
export const ESTADOS_CLASE_VIGENTE = Object.freeze([
  'PROGRAMADA',
  'PENDIENTE',
  'PRESENTE',
  'FALTA',
]);

/**
 * Carga, para un lote de inscripciones, su ciclo VIGENTE y las fechas de sus
 * clases dentro de ese ciclo.
 *
 * DOS consultas en total, no N+1: la reprogramación masiva ya hace N+1 dentro
 * de su `for` por alumno y corre con `timeout: 60000` al límite.
 *
 * ⚠️ `orderBy: { creado_en: 'desc' }` y NO `fecha_inicio_ciclo`: Postgres
 * ordena DESC NULLS FIRST, así que los links previos al backfill (sin
 * fecha_inicio_ciclo) se colarían primero. Misma advertencia que
 * inscripcion.service.js:1027-1028.
 *
 * @param {import('@prisma/client').PrismaClient} tx
 * @param {number[]} inscripcionIds
 * @param {{excluirReprogramacionIds?: number[]}} [opciones]
 *   `excluirReprogramacionIds` ignora las clases creadas por esas
 *   reprogramaciones. Lo usa la REVERSIÓN, donde la reposición todavía existe
 *   en BD cuando hay que recalcular el corrimiento.
 * @returns {Promise<Map<number, {link: object, clases: object[]}>>}
 */
export const cargarCiclosVigentes = async (tx, inscripcionIds, opciones = {}) => {
  const { excluirReprogramacionIds = [] } = opciones;
  const ids = [...new Set((inscripcionIds ?? []).map(Number).filter(Number.isInteger))];

  const ciclos = new Map();
  if (ids.length === 0) return ciclos;

  const hoyLima = dayjs().tz('America/Lima').startOf('day');

  const links = await tx.inscripciones_deudas_link.findMany({
    where: {
      inscripcion_id: { in: ids },
      fecha_fin_ciclo: {
        gte: hoyLima.toDate(),
      }
    },
    orderBy: { creado_en: 'desc' },
  });

  for (const link of links) {
    // Primera gana (la más reciente por creado_en). Un link sin
    // fecha_inicio_ciclo (previo al backfill de BL-011) no se puede corregir:
    // no hay fecha que desplazar.
    if (!link.fecha_inicio_ciclo) continue;
    if (!ciclos.has(link.inscripcion_id)) {
      ciclos.set(link.inscripcion_id, { link, clases: [] });
    }
  }

  if (ciclos.size === 0) return ciclos;

  const asistencias = await tx.registros_asistencia.findMany({
    where: {
      inscripcion_id: { in: [...ciclos.keys()] },
      estado: { in: [...ESTADOS_CLASE_VIGENTE] },
      ...(excluirReprogramacionIds.length > 0 && {
        OR: [
          { reprogramacion_clase_id: null },
          { reprogramacion_clase_id: { notIn: excluirReprogramacionIds } },
        ],
      }),
    },
    orderBy: { fecha: 'asc' },
    select: { id: true, inscripcion_id: true, fecha: true, estado: true },
  });

  for (const asistencia of asistencias) {
    const ciclo = ciclos.get(asistencia.inscripcion_id);
    if (!ciclo) continue;

    // Solo las clases del ciclo vigente. Sin tope superior a propósito: la
    // reposición de una reprogramación puede caer más allá de inicio + 30 días.
    if (aFechaUTC(asistencia.fecha) < aFechaUTC(ciclo.link.fecha_inicio_ciclo)) continue;
    ciclo.clases.push(asistencia);
  }

  return ciclos;
};

export const aplicarCorrimientoDeCiclo = async (tx, { link, nuevoFin }) => {
  if (!link?.id || !nuevoFin) return false;

  await tx.inscripciones_deudas_link.update({
    where: { id: link.id },
    data: { fecha_fin_ciclo: nuevoFin },
  });

  return true;
};
