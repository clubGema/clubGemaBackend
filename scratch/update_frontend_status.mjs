import fs from 'fs';

// 1. sessionStatus.js
const sessionStatusPath = 'd:/AcademiaGema/academiaGemaFrontend/src/config/sessionStatus.js';
let statusContent = fs.readFileSync(sessionStatusPath, 'utf8');
const statusIsCRLF = statusContent.includes('\r\n');
statusContent = statusContent.replace(/\r\n/g, '\n');

const oldFalta = `  FALTA: {
    label: 'Faltaste',
    legend: 'Faltaste',
    Icon: XCircle,
    card: 'bg-red-50/50 border-red-200 shadow-sm',
    dateBox: 'bg-red-600 text-white',
    badge: 'bg-red-100 text-red-700 border-red-200',
    cell: 'border-rose-500 bg-rose-50 text-rose-700',
  },`;

const newFalta = `  FALTA: {
    label: 'Falta',
    legend: 'Falta',
    Icon: XCircle,
    card: 'bg-red-50/50 border-red-200 shadow-sm',
    dateBox: 'bg-red-600 text-white',
    badge: 'bg-red-100 text-red-700 border-red-200',
    cell: 'border-rose-500 bg-rose-50 text-rose-700',
  },
  FALTA_ANTICIPADA: {
    label: 'Falta avisada',
    legend: 'Falta avisada',
    Icon: XCircle,
    card: 'bg-amber-50/60 border-amber-200 shadow-sm',
    dateBox: 'bg-amber-600 text-white',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
    cell: 'border-amber-500 bg-amber-50 text-amber-700',
  },`;

const oldLegend = `export const CALENDAR_LEGEND_KEYS = ['PRESENTE', 'FALTA', 'REPOSICION', 'RECUPERACION', 'PROGRAMADA', 'MOVIDA'];`;
const newLegend = `export const CALENDAR_LEGEND_KEYS = ['PRESENTE', 'FALTA', 'FALTA_ANTICIPADA', 'REPOSICION', 'RECUPERACION', 'PROGRAMADA', 'MOVIDA'];`;

const oldGetKey = `export const getSessionVisualKey = (sesion, now = new Date()) => {
  switch (sesion.estado) {`;

const newGetKey = `export const getSessionVisualKey = (sesion, now = new Date()) => {
  if (sesion.raw?.comentario?.includes('[FALTA_ANTICIPADA]') || sesion.raw?.falta_anticipada) {
    return 'FALTA_ANTICIPADA';
  }
  switch (sesion.estado) {`;

statusContent = statusContent.replace(oldFalta, newFalta);
statusContent = statusContent.replace(oldLegend, newLegend);
statusContent = statusContent.replace(oldGetKey, newGetKey);
if (statusIsCRLF) statusContent = statusContent.replace(/\n/g, '\r\n');
fs.writeFileSync(sessionStatusPath, statusContent, 'utf8');
console.log('Updated sessionStatus.js');

// 2. studentAgenda.js
const studentAgendaPath = 'd:/AcademiaGema/academiaGemaFrontend/src/utils/studentAgenda.js';
let agendaContent = fs.readFileSync(studentAgendaPath, 'utf8');
const agendaIsCRLF = agendaContent.includes('\r\n');
agendaContent = agendaContent.replace(/\r\n/g, '\n');

const oldAsistRegistrada = `const ASISTENCIA_REGISTRADA = new Set(['COMPLETADA_PRESENTE', 'COMPLETADA_FALTA', 'JUSTIFICADO_LESION']);`;
const newAsistRegistrada = `const ASISTENCIA_REGISTRADA = new Set(['COMPLETADA_PRESENTE', 'COMPLETADA_FALTA', 'JUSTIFICADO_LESION', 'PRESENTE', 'FALTA']);`;

agendaContent = agendaContent.replace(oldAsistRegistrada, newAsistRegistrada);
if (agendaIsCRLF) agendaContent = agendaContent.replace(/\n/g, '\r\n');
fs.writeFileSync(studentAgendaPath, agendaContent, 'utf8');
console.log('Updated studentAgenda.js');

// 3. UpcomingAgenda.jsx
const upcomingPath = 'd:/AcademiaGema/academiaGemaFrontend/src/components/student/dashboard/UpcomingAgenda.jsx';
let upcomingContent = fs.readFileSync(upcomingPath, 'utf8');
const upcomingIsCRLF = upcomingContent.includes('\r\n');
upcomingContent = upcomingContent.replace(/\r\n/g, '\n');

const oldUpcomingSig = `const UpcomingAgenda = ({ proximas, pasadas, now, onVerCalendario }) => {`;
const newUpcomingSig = `const UpcomingAgenda = ({ proximas, pasadas, now, onVerCalendario, onAgendaChange }) => {`;

const oldModal = `<AdvanceRecoveryModal
        isOpen={showAdvanceModal}
        onClose={() => setShowAdvanceModal(false)}
      />`;
const newModal = `<AdvanceRecoveryModal
        isOpen={showAdvanceModal}
        onClose={() => setShowAdvanceModal(false)}
        onSuccess={onAgendaChange}
      />`;

upcomingContent = upcomingContent.replace(oldUpcomingSig, newUpcomingSig);
upcomingContent = upcomingContent.replace(oldModal, newModal);
if (upcomingIsCRLF) upcomingContent = upcomingContent.replace(/\n/g, '\r\n');
fs.writeFileSync(upcomingPath, upcomingContent, 'utf8');
console.log('Updated UpcomingAgenda.jsx');

// 4. DashboardEstudiante.jsx
const dashPath = 'd:/AcademiaGema/academiaGemaFrontend/src/pages/DashboardEstudiante.jsx';
let dashContent = fs.readFileSync(dashPath, 'utf8');
const dashIsCRLF = dashContent.includes('\r\n');
dashContent = dashContent.replace(/\r\n/g, '\n');

const oldUpcomingDash = `<UpcomingAgenda proximas={proximas} pasadas={pasadas} now={now} onVerCalendario={handleVerCalendario} />`;
const newUpcomingDash = `<UpcomingAgenda proximas={proximas} pasadas={pasadas} now={now} onVerCalendario={handleVerCalendario} onAgendaChange={refetch} />`;

dashContent = dashContent.replace(oldUpcomingDash, newUpcomingDash);
if (dashIsCRLF) dashContent = dashContent.replace(/\n/g, '\r\n');
fs.writeFileSync(dashPath, dashContent, 'utf8');
console.log('Updated DashboardEstudiante.jsx');

