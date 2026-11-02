import { prisma } from '../src/config/database.config.js';
import { recuperacionService } from '../src/features/recuperaciones/recuperacion.service.js';

async function testCruce() {
  console.log('--- Probando detección de cruce de horario en recuperaciones ---');

  // Tomamos el alumno 793, que tiene clase regular los Lunes de 19:00 a 20:30 (horario 49)
  // ¿Qué pasa si intenta recuperar el LUNES 2026-11-09 a las 19:00 (horario 49 o 45)?
  
  // Verificamos la función validarElegibilidad
  try {
    // Simulamos la validación de cruce
    console.log('Simulando chequeo de cruce...');
  } catch (err) {
    console.log('Error capturado:', err.message);
  }
}
testCruce().then(() => process.exit(0));

