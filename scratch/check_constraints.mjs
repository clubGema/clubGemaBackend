import { prisma } from '../src/config/database.config.js';

async function main() {
  const constraints = await prisma.$queryRawUnsafe(`
    SELECT conname, pg_get_constraintdef(c.oid) 
    FROM pg_constraint c 
    JOIN pg_class t ON c.conrelid = t.oid 
    WHERE t.relname = 'registros_asistencia';
  `);
  console.log('CONSTRAINTS:', constraints);

  const distinctEstados = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT estado FROM registros_asistencia;
  `);
  console.log('DISTINCT ESTADOS:', distinctEstados);

  process.exit(0);
}
main();
