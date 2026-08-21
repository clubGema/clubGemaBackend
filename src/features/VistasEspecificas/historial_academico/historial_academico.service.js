import { prisma } from '../../../config/database.config.js';
import { ApiError } from '../../../shared/utils/error.util.js';


const MAPA_DIAS = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };

const formatTime = (date) => (date ? date.toISOString().substring(11, 16) : null);

// 🎯 Estados reales de registros_asistencia: PRESENTE | FALTA | CANCELADO | PROGRAMADA
const ESTADOS_VALIDOS_PARA_CICLO = ['PRESENTE', 'FALTA', 'PROGRAMADA'];

// 🔧 FIX: esta función se usaba en obtenerFlagsIndividualPorSede pero nunca
// estaba definida en el archivo — causaba ReferenceError en tiempo de ejecución.
const esConceptoIndividual = (nombreConcepto, detalleAdicional) => {
  const texto = `${nombreConcepto || ''} ${detalleAdicional || ''}`.toLowerCase();
  return texto.includes('plan individual');
};

// 🎯 Misma regla de vigencia que usaba el frontend (addDays 29 + isPast),
// pero calculada en el backend para no duplicar lógica ni mandar de más.
const DIAS_VIGENCIA_INSCRIPCION = 29;

const calcularFechaCorte = (fechaInscripcion) => {
  if (!fechaInscripcion) return null;
  const fecha = new Date(fechaInscripcion);
  fecha.setDate(fecha.getDate() + DIAS_VIGENCIA_INSCRIPCION);
  return fecha;
};

const estaVencida = (fechaCorte) => {
  if (!fechaCorte) return false;
  return fechaCorte.getTime() < Date.now();
};

export const historialAcademicoService = {
  // =================================================================
  // 📊 HISTORIAL REAL DE CICLOS (sin cambios)
  // =================================================================
  obtenerHistorialPorAlumno: async (alumnoId) => {
    const id = parseInt(alumnoId);
    if (!id) throw new ApiError('ID de alumno inválido', 400);

    try {
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

        const esIndividual = inscripcionesInfo.some((i) => i.tipo_inscripcion === 'INDIVIDUAL');

        return {
          cuenta_id: cuenta.id,
          concepto: cuenta.catalogo_conceptos?.nombre || cuenta.detalle_adicional,
          estado_pago: cuenta.estado,
          monto_final: Number(cuenta.monto_final),
          fecha_vencimiento_pago: cuenta.fecha_vencimiento,
          fecha_inicio_real: todasLasFechas[0] ?? null,
          fecha_fin_real: todasLasFechas[todasLasFechas.length - 1] ?? null,
          total_clases_paquete: todasLasFechas.length,
          sin_registros: todasLasFechas.length === 0,
          es_individual: esIndividual,
          horarios: Array.from(horariosUnicos.values()),
          inscripciones: inscripcionesInfo,
        };
      });

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

  // =================================================================
  // 🆕 RESUMEN DE TABLA (reemplaza a usuarioService.getUsersByRol para
  // la vista de Gestión de Alumnos). Trae SOLO lo que la tabla pinta:
  // nombre, dni, teléfono, sede/nivel/estado de la inscripción vigente,
  // deuda pendiente y si el alumno tiene un plan individual.
  //
  // Optimización clave frente al endpoint viejo:
  // - No trae horarios completos (dia/hora/cancha) — la tabla no los pinta.
  // - No trae direcciones/contacto de emergencia/salud — eso vive en
  //   StudentDetails, que pide su propio detalle solo al abrir el expediente.
  // - Calcula vigencia y flag individual EN EL SERVIDOR (una sola pasada),
  //   así el frontend recibe filas casi listas para pintar, sin duplicar
  //   la lógica de fechaCorte/vencida que antes vivía en el componente.
  // =================================================================
  obtenerResumenTablaAlumnos: async (sedeId) => {
    try {
      const sedeIdInt = sedeId ? parseInt(sedeId) : null;

      const whereClause = {
        activo: true,
        roles: { nombre: { equals: 'Alumno', mode: 'insensitive' } },
      };

      if (sedeIdInt) {
        whereClause.alumnos = {
          inscripciones: {
            some: {
              horarios_clases: { canchas: { sede_id: sedeIdInt } },
            },
          },
        };
      }

      const usuarios = await prisma.usuarios.findMany({
        where: whereClause,
        select: {
          id: true,
          nombres: true,
          apellidos: true,
          numero_documento: true,
          telefono_personal: true,
          alumnos: {
            select: {
              cuentas_por_cobrar: {
                select: {
                  estado: true,
                  monto_final: true,
                  detalle_adicional: true,
                  catalogo_conceptos: { select: { nombre: true } },
                },
              },
              inscripciones: {
                // 🎯 Si se filtra por sede, solo traemos inscripciones DE esa
                // sede — evita mezclar sede/nivel de otra sede en el cálculo.
                where: sedeIdInt
                  ? { horarios_clases: { canchas: { sede_id: sedeIdInt } } }
                  : undefined,
                orderBy: { fecha_inscripcion: 'desc' },
                select: {
                  estado: true,
                  fecha_inscripcion: true,
                  tipo_inscripcion: true,
                  horarios_clases: {
                    select: {
                      niveles_entrenamiento: { select: { nombre: true } },
                      canchas: { select: { sedes: { select: { nombre: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { nombres: 'asc' },
      });

      return usuarios.map((user) => {
        const alumnoData = user.alumnos || {};
        const inscripciones = alumnoData.inscripciones || [];
        const cuentas = alumnoData.cuentas_por_cobrar || [];

        // --- Deuda pendiente ---
        const montoPendiente = cuentas
          .filter((c) => c.estado === 'PENDIENTE')
          .reduce((acc, c) => acc + Number(c.monto_final || 0), 0);

        // --- Flag de Plan Individual: basta con UNA cuenta que cumpla ---
        const esIndividual = cuentas.some((c) =>
          esConceptoIndividual(c.catalogo_conceptos?.nombre, c.detalle_adicional)
        );

        // --- Misma prioridad que antes: vigentes > activas-vencidas > última ---
        const inscripcionesActivas = inscripciones.filter((i) => i.estado === 'ACTIVO');
        const inscripcionesConCorte = inscripcionesActivas.map((i) => {
          const fechaCorte = calcularFechaCorte(i.fecha_inscripcion);
          return { ...i, __fechaCorte: fechaCorte, __vencida: estaVencida(fechaCorte) };
        });
        const inscripcionesVigentes = inscripcionesConCorte.filter((i) => !i.__vencida);

        let inscripcionesAMostrar = [];
        let estadoVisual = 'SIN INSCRIPCIÓN';

        if (inscripcionesVigentes.length > 0) {
          inscripcionesAMostrar = inscripcionesVigentes;
          estadoVisual = 'ACTIVO';
        } else if (inscripcionesConCorte.length > 0) {
          inscripcionesAMostrar = inscripcionesConCorte;
          estadoVisual = 'ACTIVO';
        } else if (inscripciones.length > 0) {
          inscripcionesAMostrar = [inscripciones[0]];
          estadoVisual = inscripciones[0].estado;
        }

        const sedes = [...new Set(
          inscripcionesAMostrar.map((i) => i.horarios_clases?.canchas?.sedes?.nombre).filter(Boolean)
        )];
        const niveles = [...new Set(
          inscripcionesAMostrar.map((i) => i.horarios_clases?.niveles_entrenamiento?.nombre).filter(Boolean)
        )];

        const ultimaInsc = inscripcionesAMostrar[0];
        const fechaCorte = ultimaInsc?.fecha_inscripcion ? calcularFechaCorte(ultimaInsc.fecha_inscripcion) : null;

        return {
          id: user.id,
          nombres: user.nombres,
          apellidos: user.apellidos,
          full_name: `${user.nombres} ${user.apellidos}`,
          dni: user.numero_documento || '---',
          telefono: user.telefono_personal || 'S/N',

          sedes,
          niveles,
          estadoVisual,
          estaVencido: fechaCorte ? estaVencida(fechaCorte) : false,
          fechaCorte,
          multiplesActivas: inscripcionesActivas.length > 1,

          monto_pendiente: montoPendiente,
          esClaseUnica: esIndividual,
        };
      });
    } catch (error) {
      console.error(`❌ [ERROR RESUMEN TABLA ALUMNOS] Sede: ${sedeId} | ${error.message}`);
      throw new ApiError('Error al obtener el resumen de alumnos', 500);
    }
  },

  // =================================================================
  // 🆕 RESUMEN MASIVO de "Plan Individual" (se mantiene por si otra
  // pantalla lo usa suelto, pero ya NO hace falta llamarlo desde la
  // tabla principal — obtenerResumenTablaAlumnos ya trae esClaseUnica).
  // =================================================================
  obtenerFlagsIndividualPorSede: async (sedeId) => {
    try {
      const whereSede = sedeId
        ? {
            inscripciones_deudas_link: {
              some: {
                inscripciones: {
                  horarios_clases: {
                    canchas: { sede_id: parseInt(sedeId) },
                  },
                },
              },
            },
          }
        : {};

      const cuentas = await prisma.cuentas_por_cobrar.findMany({
        where: whereSede,
        select: {
          alumno_id: true,
          detalle_adicional: true,
          catalogo_conceptos: { select: { nombre: true } },
        },
      });

      const flagsPorAlumno = {};

      for (const cuenta of cuentas) {
        if (flagsPorAlumno[cuenta.alumno_id]) continue;

        const esIndividual = esConceptoIndividual(
          cuenta.catalogo_conceptos?.nombre,
          cuenta.detalle_adicional
        );

        if (esIndividual) {
          flagsPorAlumno[cuenta.alumno_id] = true;
        }
      }

      return flagsPorAlumno;
    } catch (error) {
      console.error(`❌ [ERROR RESUMEN MASIVO INDIVIDUAL] Sede: ${sedeId} | ${error.message}`);
      throw new ApiError('Error al obtener el resumen de planes individuales', 500);
    }
  },

};