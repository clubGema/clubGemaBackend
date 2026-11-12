// Helpers PUROS del historial de ciclos (sin Prisma, testeables).

/** Inscripciones que ya no consumen ciclo aunque su link siga sin fecha_fin_ciclo. */
const ESTADOS_INSCRIPCION_TERMINALES = ['FINALIZADO', 'CANCELADO'];

/**
 * Estado real de un ciclo.
 *  - CERRADO : tiene fecha_fin_ciclo, o su inscripción ya terminó (dato viejo sin cerrar).
 *  - VENCIDO : sigue abierto pero el corte (inicio + 30d) ya pasó; está en tolerancia
 *              hasta que el cron VERDUGO lo cierre.
 *  - VIGENTE : abierto y dentro de sus 30 días.
 * `hoy` y `corte` son medianoche UTC del día calendario.
 */
export const calcularEstadoCiclo = ({ fechaFin, corte, estadoInscripcion, hoy }) => {
    if (fechaFin) return 'CERRADO';
    if (ESTADOS_INSCRIPCION_TERMINALES.includes(estadoInscripcion)) return 'CERRADO';
    if (corte && hoy && corte.getTime() < hoy.getTime()) return 'VENCIDO';
    return 'VIGENTE';
};

const sumar2 = (a, b) => Math.round((a + b) * 100) / 100;

const fusionarDesglose = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const clases = [...a.clases, ...b.clases].sort((x, y) => new Date(x.fecha) - new Date(y.fecha));
    return {
        dias_del_ciclo_en_el_mes: Math.max(a.dias_del_ciclo_en_el_mes, b.dias_del_ciclo_en_el_mes),
        total_clases: a.total_clases + b.total_clases,
        clases_presente: a.clases_presente + b.clases_presente,
        clases_falta: a.clases_falta + b.clases_falta,
        clases_programadas: a.clases_programadas + b.clases_programadas,
        clases,
    };
};

const horarioDeFila = (f) => ({
    inscripcion_id: f.inscripcion_id,
    sede: f.sede,
    nivel: f.nivel,
    profesor: f.profesor,
    estado_inscripcion: f.estado_inscripcion,
});

/**
 * Un paquete de N clases/semana genera N filas (una por inscripción) que
 * comparten cuenta y ciclo. Para quien lo mira es UN ciclo y UN pago: se
 * fusionan en una sola fila con el monto sumado (= lo que se pagó) y la lista
 * de horarios. Las filas sin cuenta o INDIVIDUALES no se fusionan.
 * Conserva el orden de entrada (ya viene ordenado).
 */
export const agruparCiclosPorCuenta = (filas) => {
    const grupos = new Map();
    const salida = [];

    for (const fila of filas) {
        const agrupable = fila.cuenta_id != null && fila.tipo_inscripcion !== 'INDIVIDUAL';
        const inicio = fila.fecha_inicio_ciclo ? fila.fecha_inicio_ciclo.getTime() : 'sin-inicio';
        const clave = `${fila.cuenta_id}|${inicio}`;

        if (!agrupable) {
            salida.push({ ...fila, inscripcion_ids: [fila.inscripcion_id], horarios: [horarioDeFila(fila)] });
            continue;
        }

        const existente = grupos.get(clave);
        if (!existente) {
            const nueva = { ...fila, inscripcion_ids: [fila.inscripcion_id], horarios: [horarioDeFila(fila)] };
            grupos.set(clave, nueva);
            salida.push(nueva);
            continue;
        }

        existente.inscripcion_ids.push(fila.inscripcion_id);
        existente.horarios.push(horarioDeFila(fila));
        existente.monto_mes = sumar2(existente.monto_mes, fila.monto_mes);
        if (existente.desglose_mes || fila.desglose_mes) {
            existente.desglose_mes = fusionarDesglose(existente.desglose_mes, fila.desglose_mes);
        }
    }

    return salida;
};

/** Ids de horario que el alumno ya tiene en curso entre los que quiere inscribir. */
export const horariosYaEnCurso = (horarioIds, inscripcionesEnCurso) => {
    const pedidos = new Set((horarioIds ?? []).map(Number));
    return [...new Set((inscripcionesEnCurso ?? []).map((i) => i.horario_id))].filter((id) => pedidos.has(id));
};