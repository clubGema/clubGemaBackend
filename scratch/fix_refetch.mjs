import fs from 'fs';

const filePath = 'd:/AcademiaGema/academiaGemaFrontend/src/pages/DashboardEstudiante.jsx';
let content = fs.readFileSync(filePath, 'utf8');
const isCRLF = content.includes('\r\n');
content = content.replace(/\r\n/g, '\n');

const target = `const { sesiones, proximas, pasadas, nextClass, now, loading } = useStudentAgenda(userId);`;
const replacement = `const { sesiones, proximas, pasadas, nextClass, now, loading, refetch } = useStudentAgenda(userId);`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  if (isCRLF) content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: Added refetch to useStudentAgenda destructuring');
} else {
  console.error('Target not found in DashboardEstudiante.jsx');
}

