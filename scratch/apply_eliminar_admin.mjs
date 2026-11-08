import fs from 'fs';

const filePath = 'd:/AcademiaGema/academiaGemaBackend/src/features/recuperaciones/recuperacion.service.js';
let content = fs.readFileSync(filePath, 'utf8');

const isCRLF = content.includes('\r\n');
content = content.replace(/\r\n/g, '\n');

const target = `    } else {
      // Si no es lesión, simplemente borramos el registro
      return await tx.recuperaciones.delete({
        where: { id: ticket.id }
      });
    }`;

const replacement = `    } else {
      // Si era una falta anticipada, restauramos la clase original a PROGRAMADA
      if (ticket.registro_asistencia_id && ticket.motivo_falta === 'FALTA_ANTICIPADA') {
        const reg = await tx.registros_asistencia.findUnique({ where: { id: ticket.registro_asistencia_id } });
        if (reg) {
          await tx.registros_asistencia.update({
            where: { id: reg.id },
            data: {
              estado: 'PROGRAMADA',
              comentario: (reg.comentario || '').replace('[FALTA_ANTICIPADA]', '').trim(),
            },
          });
        }
      }
      return await tx.recuperaciones.delete({
        where: { id: ticket.id }
      });
    }`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  if (isCRLF) content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESSFULLY UPDATED recuperacion.service.js');
} else {
  console.error('Target not found in recuperacion.service.js');
}

