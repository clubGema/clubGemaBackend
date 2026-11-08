// 🔥 IMPORTAMOS DAYJS Y CONFIGURAMOS LIMA 🔥
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ_LIMA = 'America/Lima';

/**
 * Cuenta cuántas veces cae un día específico de la semana entre dos fechas.
 * @param {number} diaSemana - Día buscado (0-6, donde 0 es domingo o según configuración).
 * @param {Date} inicio - Fecha inicial.
 * @param {Date} fin - Fecha final.
 * @returns {number} Cantidad de ocurrencias.
 */
export const contarClasesEnIntervalo = (diaSemana, inicio, fin) => {
  let contador = 0;

  const diaCorregido = diaSemana === 7 ? 0 : diaSemana;
  // 🔥 CAMBIO CON DAYJS: Anclamos el inicio a las 12:00 PM hora Lima
  let puntero = dayjs(inicio).tz(TZ_LIMA).hour(12).minute(0).second(0).millisecond(0);

  // 🔥 CAMBIO CON DAYJS: Anclamos el fin al último milisegundo del día en hora Lima
  let finFijo = dayjs(fin).tz(TZ_LIMA).endOf('day');

  // 🔥 CAMBIO CON DAYJS: Evaluamos usando isBefore e isSame de dayjs
  while (puntero.isBefore(finFijo) || puntero.isSame(finFijo, 'day')) {
    if (puntero.day() === diaCorregido) contador++;
    puntero = puntero.add(1, 'day'); // 🔥 Sumamos 1 día de forma segura
  }
  return contador;
};

/**
 * Valida que el input de horarios sea correcto.
 */
export const validarInputInscripcion = (horario_ids) => {
  if (!horario_ids || !Array.isArray(horario_ids) || horario_ids.length === 0) {
    throw new Error('Debes seleccionar al menos un horario.');
  }
};