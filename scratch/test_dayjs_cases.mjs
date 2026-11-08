import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_LIMA = 'America/Lima';

function normalizarDiaLima(input) {
  if (!input) return null;
  // Si ya es un string YYYY-MM-DD
  const str = String(input);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // Si es ISO string con Z o timestamp
  return dayjs(input).tz(TZ_LIMA).format('YYYY-MM-DD');
}

console.log('Case 1: YYYY-MM-DD', normalizarDiaLima('2026-11-04'));
console.log('Case 2: ISO from Lima 19:00 (Nov 5 00:00Z)', normalizarDiaLima('2026-11-05T00:00:00.000Z'));
console.log('Case 3: ISO local YYYY-MM-DDTHH:mm:ss', normalizarDiaLima('2026-11-04T19:00:00'));
console.log('Case 4: Date object', normalizarDiaLima(new Date('2026-11-04T00:00:00Z')));

