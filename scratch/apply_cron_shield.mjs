import fs from 'fs';

const filePath = 'd:/AcademiaGema/academiaGemaBackend/src/features/inscripciones/inscripcion-cron.service.js';
let content = fs.readFileSync(filePath, 'utf8');
const isCRLF = content.includes('\r\n');
content = content.replace(/\r\n/g, '\n');

const target = `          const fechaFinCiclo = resultado.fecha_fin_ciclo;
          if (!fechaFinCiclo) continue;`;

const replacement = `          // fix de zona horaria - Navegación segura opcional en fecha fin de ciclo para evitar crash si no hay link
          const fechaFinCiclo = resultado?.fecha_fin_ciclo;
          if (!fechaFinCiclo) continue;`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  if (isCRLF) content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: inscripcion-cron.service.js updated!');
} else {
  console.error('Target not found in inscripcion-cron.service.js');
}

