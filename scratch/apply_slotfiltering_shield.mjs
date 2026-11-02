import fs from 'fs';

const filePath = 'd:/AcademiaGema/academiaGemaFrontend/src/pages/student/recoveries/slotFiltering.js';
let content = fs.readFileSync(filePath, 'utf8');
const isCRLF = content.includes('\r\n');
content = content.replace(/\r\n/g, '\n');

const newContent = `import { generarClasesDisponibles } from '../../../utils/schedulerUtils';

// Genera los slots disponibles para el ticket seleccionado, quitando los que el alumno
// ya tiene ocupados ('PROGRAMADA'), que corresponden a un horario regular protegido
// o que superan el último día de clases del ciclo (\`fechaFinCiclo\`).
export const calcularSlotsDisponibles = (horariosPatron, historial = [], stats = {}, fechaFinCiclo = null) => {
    const rawSlots = generarClasesDisponibles(horariosPatron, 8);
    // fix de zona horaria - Clave plana YYYY-MM-DD para fecha fin de ciclo
    const finKey = fechaFinCiclo ? String(fechaFinCiclo).slice(0, 10) : null;
    const regulares = stats?.fechas_clases_regulares || [];

    return rawSlots.filter(slot => {
        // fix de zona horaria - Extracción limpia YYYY-MM-DD del slot
        const fechaSlotTexto = String(slot.fecha).slice(0, 10);

        if (finKey && fechaSlotTexto > finKey) {
            return false;
        }

        // fix de zona horaria - Hora inicio/fin del slot en formato HH:mm
        const horaSlotInicio = (slot.horarioData?.hora_inicio || '').slice(0, 5);
        const horaSlotFin = (slot.horarioData?.hora_fin || '').slice(0, 5);

        // 1. Buscamos si el alumno ya tiene algo agendado ('PROGRAMADA') en este mismo día y a esta misma hora
        const yaLoTieneOcupado = historial.some(ticket => {
            if (ticket.estado !== 'PROGRAMADA' || !ticket.fecha_programada) return false;

            // fix de zona horaria - Comparación de fecha plana YYYY-MM-DD
            const fechaTicketTexto = String(ticket.fecha_programada).slice(0, 10);
            if (fechaTicketTexto !== fechaSlotTexto) return false;

            const ticketInicio = (ticket.horarios_clases?.hora_inicio ? String(ticket.horarios_clases.hora_inicio).slice(11, 16) : (ticket.horarioData?.hora_inicio || '')).slice(0, 5);
            const ticketFin = (ticket.horarios_clases?.hora_fin ? String(ticket.horarios_clases.hora_fin).slice(11, 16) : (ticket.horarioData?.hora_fin || '')).slice(0, 5);

            if (ticketInicio && ticketFin && horaSlotInicio && horaSlotFin) {
                return horaSlotInicio < ticketFin && horaSlotFin > ticketInicio;
            }

            return ticket.horario_destino_id === slot.horarioData.id;
        });

        // 2. fix de zona horaria - Detección de choque con clases regulares por fecha plana YYYY-MM-DD y hora HH:mm
        const esHorarioRegularProtegido = regulares.some(f => {
            const fFecha = String(f.fecha_clase || '').slice(0, 10);
            if (fFecha !== fechaSlotTexto) return false;

            const fHora = String(f.fecha_clase || '').slice(11, 16);
            if (fHora && horaSlotInicio) {
                return fHora === horaSlotInicio;
            }
            return f.id_horario === slot.horarioData.id;
        });

        return !yaLoTieneOcupado && !esHorarioRegularProtegido;
    });
};
`;

if (isCRLF) {
  fs.writeFileSync(filePath, newContent.replace(/\n/g, '\r\n'), 'utf8');
} else {
  fs.writeFileSync(filePath, newContent, 'utf8');
}
console.log('SUCCESS: slotFiltering.js updated with timezone shield!');

