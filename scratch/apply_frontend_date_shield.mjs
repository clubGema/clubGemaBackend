import fs from 'fs';

// 1. AdvanceRecoveryModal.jsx
const modalPath = 'd:/AcademiaGema/academiaGemaFrontend/src/components/student/Recoveries/AdvanceRecoveryModal.jsx';
let modalContent = fs.readFileSync(modalPath, 'utf8');
const modalCRLF = modalContent.includes('\r\n');
modalContent = modalContent.replace(/\r\n/g, '\n');

const oldModalTarget = `        registroId: selectedClase.registro_id,
        horarioDestinoId: selectedSlot.horarioData.id,
        fechaProgramada: new Date(selectedSlot.fecha).toISOString(),`;

const newModalTarget = `        registroId: selectedClase.registro_id,
        horarioDestinoId: selectedSlot.horarioData.id,
        // fix de zona horaria - Fecha plana YYYY-MM-DD sin distorsión por huso horario del navegador
        fechaProgramada: String(selectedSlot.fecha).slice(0, 10),`;

modalContent = modalContent.replace(oldModalTarget, newModalTarget);
if (modalCRLF) modalContent = modalContent.replace(/\n/g, '\r\n');
fs.writeFileSync(modalPath, modalContent, 'utf8');
console.log('SUCCESS: AdvanceRecoveryModal.jsx updated!');

// 2. StudentRecoveries.jsx
const recuPath = 'd:/AcademiaGema/academiaGemaFrontend/src/pages/student/StudentRecoveries.jsx';
let recuContent = fs.readFileSync(recuPath, 'utf8');
const recuCRLF = recuContent.includes('\r\n');
recuContent = recuContent.replace(/\r\n/g, '\n');

const oldRecuTarget = `                alumnoId: userId,
                recuperacionId: selectedTicket.id,
                horarioDestinoId: slot.horarioData.id,
                fechaProgramada: new Date(slot.fecha).toISOString(),`;

const newRecuTarget = `                alumnoId: userId,
                recuperacionId: selectedTicket.id,
                horarioDestinoId: slot.horarioData.id,
                // fix de zona horaria - Fecha plana YYYY-MM-DD sin distorsión por huso horario del navegador
                fechaProgramada: String(slot.fecha).slice(0, 10),`;

recuContent = recuContent.replace(oldRecuTarget, newRecuTarget);
if (recuCRLF) recuContent = recuContent.replace(/\n/g, '\r\n');
fs.writeFileSync(recuPath, recuContent, 'utf8');
console.log('SUCCESS: StudentRecoveries.jsx updated!');

