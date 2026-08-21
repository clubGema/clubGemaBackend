import { prisma } from '../../../config/database.config.js';
import { ApiError } from '../../../shared/utils/error.util.js';


const MAPA_DIAS = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };

const formatTime = (date) => (date ? date.toISOString().substring(11, 16) : null);

// 🎯 Estados reales de registros_asistencia: PRESENTE | FALTA | CANCELADO | PROGRAMADA
// - PRESENTE / FALTA: clases que ya ocurrieron -> SÍ cuentan para el rango del ciclo.
// - PROGRAMADA: clases futuras ya generadas -> SÍ cuentan (definen el fin del ciclo).
// - CANCELADO: la clase nunca ocurrió (reprogramada/anulada) -> NO cuenta, se excluye.
const ESTADOS_VALIDOS_PARA_CICLO = ['PRESENTE', 'FALTA', 'PROGRAMADA'];

export const historialAcademicoService = {
  // =================================================================
  // 📊 HISTORIAL REAL DE CICLOS: agrupado por cuenta_id (el "paquete"),
  // con fechas de inicio/fin calculadas desde las clases REALMENTE
  // generadas en registros_asistencia, no desde el link estimado.
  // =================================================================
  obtenerHistorialPorAlumno: async (alumnoId) => {
    const id = parseInt(alumnoId);
    if (!id) throw new ApiError('ID de alumno inválido', 400);

    try {
      // 1. Partimos de las CUENTAS (el paquete real de cobro), no de las inscripciones
      const cuentas = await prisma.cuentas_por_cobrar.findMany({
        where: { alumno_id: id },
        include: {
          catalogo_conceptos: { select: { nombre: true } },
          inscripciones_deudas_link: {
            include: {
              inscripciones: {
                include: {
                  horarios_clases: {
                    include: {
                      canchas: { include: { sedes: { select: { nombre: true } } } },
                      niveles_entrenamiento: { select: { nombre: true } },
                      coordinadores: { include: { usuarios: { select: { nombres: true } } } }
                    }
                  },
                  // 🎯 Fuente de verdad para las fechas reales del ciclo
                  registros_asistencia: {
                    where: { estado: { in: ESTADOS_VALIDOS_PARA_CICLO } },
                    select: { fecha: true, estado: true },
                    orderBy: { fecha: 'asc' }
                  }
                }
              }
            }
          }
        },
        orderBy: { creado_en: 'desc' }
      });

      // 2. Armamos una tarjeta por cuenta
      const historial = cuentas.map((cuenta) => {
        const links = cuenta.inscripciones_deudas_link;

        let todasLasFechas = [];
        const horariosUnicos = new Map();
        const inscripcionesInfo = [];

        for (const link of links) {
          const insc = link.inscripciones;
          const hc = insc.horarios_clases;
          const fechas = insc.registros_asistencia.map((r) => r.fecha);
          todasLasFechas = todasLasFechas.concat(fechas);

          const horarioKey = `${hc?.dia_semana}-${hc?.hora_inicio}`;
          if (hc && !horariosUnicos.has(horarioKey)) {
            horariosUnicos.set(horarioKey, {
              dia: MAPA_DIAS[hc.dia_semana] ?? 'S/D',
              hora_inicio: formatTime(hc.hora_inicio),
              hora_fin: formatTime(hc.hora_fin),
            });
          }

          inscripcionesInfo.push({
            inscripcion_id: insc.id,
            estado: insc.estado,
            tipo_inscripcion: insc.tipo_inscripcion,
            sede: hc?.canchas?.sedes?.nombre || 'S/D',
            nivel: hc?.niveles_entrenamiento?.nombre || 'S/D',
            profesor: hc?.coordinadores?.usuarios?.nombres || 'S/D',
            total_clases: fechas.length,
            clases_asistidas: insc.registros_asistencia.filter((r) => r.estado === 'PRESENTE').length,
            clases_falta: insc.registros_asistencia.filter((r) => r.estado === 'FALTA').length,
            clases_programadas: insc.registros_asistencia.filter((r) => r.estado === 'PROGRAMADA').length,
          });
        }

        todasLasFechas.sort((a, b) => new Date(a) - new Date(b));

        // 🎯 Si CUALQUIER inscripción del paquete es INDIVIDUAL, se marca el
        // paquete completo como individual (permite badge distinto en el front)
        const esIndividual = inscripcionesInfo.some((i) => i.tipo_inscripcion === 'INDIVIDUAL');

        return {
          cuenta_id: cuenta.id,
          concepto: cuenta.catalogo_conceptos?.nombre || cuenta.detalle_adicional,
          estado_pago: cuenta.estado,
          monto_final: Number(cuenta.monto_final),
          fecha_vencimiento_pago: cuenta.fecha_vencimiento, // corte ADMINISTRATIVO (plazo de pago, NO es fecha de clase)

          // 🎯 Estas dos reemplazan a fecha_inicio_ciclo/fecha_corte_ciclo del endpoint viejo
          fecha_inicio_real: todasLasFechas[0] ?? null,
          fecha_fin_real: todasLasFechas[todasLasFechas.length - 1] ?? null,

          total_clases_paquete: todasLasFechas.length,
          // 🚩 true cuando la cuenta no tiene NINGUNA clase con estado válido
          // (todas CANCELADO, o cuenta vieja sin registros_asistencia generados)
          sin_registros: todasLasFechas.length === 0,
          es_individual: esIndividual,
          horarios: Array.from(horariosUnicos.values()),
          inscripciones: inscripcionesInfo,
        };
      });

      // 🚩 Orden por fecha real del ciclo: más reciente primero.
      // Las cuentas "sin_registros" (fecha_inicio_real null) van al final,
      // no se mezclan al azar entre las fechas reales.
      historial.sort((a, b) => {
        if (!a.fecha_inicio_real && !b.fecha_inicio_real) return 0;
        if (!a.fecha_inicio_real) return 1;
        if (!b.fecha_inicio_real) return -1;
        return new Date(b.fecha_inicio_real) - new Date(a.fecha_inicio_real);
      });

      return historial;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error(`❌ [ERROR HISTORIAL ACADEMICO] Alumno: ${alumnoId} | ${error.message}`);
      throw new ApiError('Error al obtener el historial académico del alumno', 500);
    }
  },
};