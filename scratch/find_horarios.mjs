import { prisma } from '../src/config/database.config.js';

async function main() {
  const horarios = await prisma.horarios_clases.findMany({
    where: { dia_semana: 1 },
    include: { canchas: { include: { sedes: true } }, niveles_entrenamiento: true }
  });
  console.log(horarios.map(h => ({
    id: h.id,
    dia: h.dia_semana,
    hora_inicio: h.hora_inicio,
    hora_fin: h.hora_fin,
    sede: h.canchas?.sedes?.nombre,
    cancha: h.canchas?.nombre,
    nivel: h.niveles_entrenamiento?.nombre
  })));
  process.exit(0);
}
main();

