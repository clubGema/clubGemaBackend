const ahora = new Date();
ahora.setHours(ahora.getHours() - 5);

// Supongamos que la clase es hoy a las 20:00 hora de Lima (01:00 UTC del día siguiente)
// fechaProg: 2026-11-01, horaInicio: 1970-01-01T20:00:00Z (las horas en Postgres se guardan como 20:00 UTC)
const fechaProg = new Date('2026-11-01T00:00:00Z');
const horaInicio = new Date('1970-01-01T20:00:00Z');

const fechaClase = new Date(Date.UTC(
  fechaProg.getUTCFullYear(),
  fechaProg.getUTCMonth(),
  fechaProg.getUTCDate(),
  horaInicio.getUTCHours(),
  horaInicio.getUTCMinutes(),
  0,
  0
));

console.log('Ahora getTime():', ahora.toISOString());
console.log('FechaClase getTime():', fechaClase.toISOString());
const horasFaltantes = (fechaClase.getTime() - ahora.getTime()) / (1000 * 60 * 60);
console.log('Horas faltantes calculadas:', horasFaltantes);

