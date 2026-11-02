import fs from 'fs';

const filePath = 'd:/AcademiaGema/academiaGemaBackend/src/features/recuperaciones/recuperacion-anticipada.service.js';
let content = fs.readFileSync(filePath, 'utf8');

const isCRLF = content.includes('\r\n');
content = content.replace(/\r\n/g, '\n');

// 1. In obtenerClasesAnticipables: include r.estado === 'PROGRAMADA' or (r.estado === 'FALTA' && r.comentario?.includes(TAG_FALTA_ANTICIPADA))
const oldRegulares = `  const regulares = registros.filter(
    (r) =>
      !r.comentario?.includes('[RECUPERACION]') &&
      r.inscripciones?.tipo_inscripcion !== 'INDIVIDUAL' &&
      r.estado === 'PROGRAMADA'
  );`;

const newRegulares = `  const regulares = registros.filter(
    (r) =>
      !r.comentario?.includes('[RECUPERACION]') &&
      r.inscripciones?.tipo_inscripcion !== 'INDIVIDUAL' &&
      (r.estado === 'PROGRAMADA' || (r.estado === 'FALTA' && r.comentario?.includes(TAG_FALTA_ANTICIPADA)))
  );`;

// 2. In revertirAviso: change estado back to 'PROGRAMADA'
const oldRevertir = `  const registro = await tx.registros_asistencia.findUnique({ where: { id: registroId } });
  if (registro?.comentario?.includes(TAG_FALTA_ANTICIPADA)) {
    await tx.registros_asistencia.update({
      where: { id: registroId },
      data: { comentario: quitarTag(registro.comentario) },
    });
  }`;

const newRevertir = `  const registro = await tx.registros_asistencia.findUnique({ where: { id: registroId } });
  if (registro?.comentario?.includes(TAG_FALTA_ANTICIPADA) || registro?.estado === 'FALTA') {
    await tx.registros_asistencia.update({
      where: { id: registroId },
      data: {
        estado: 'PROGRAMADA',
        comentario: quitarTag(registro.comentario),
      },
    });
  }`;

// 3. In marcarFaltaAnticipada: change estado to 'FALTA'
const oldMarcar = `    await tx.registros_asistencia.update({
      where: { id: idRegistro },
      data: { comentario: \`\${TAG_FALTA_ANTICIPADA} \${registro.comentario || ''}\`.trim() },
    });`;

const newMarcar = `    await tx.registros_asistencia.update({
      where: { id: idRegistro },
      data: {
        estado: 'FALTA',
        comentario: \`\${TAG_FALTA_ANTICIPADA} \${registro.comentario || ''}\`.trim(),
      },
    });`;

console.log('Includes oldRegulares?', content.includes(oldRegulares));
console.log('Includes oldRevertir?', content.includes(oldRevertir));
console.log('Includes oldMarcar?', content.includes(oldMarcar));

if (content.includes(oldRegulares) && content.includes(oldRevertir) && content.includes(oldMarcar)) {
  content = content.replace(oldRegulares, newRegulares);
  content = content.replace(oldRevertir, newRevertir);
  content = content.replace(oldMarcar, newMarcar);
  if (isCRLF) content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESSFULLY UPDATED recuperacion-anticipada.service.js');
} else {
  console.error('Failed to match targets');
}

