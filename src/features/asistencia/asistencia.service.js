import { prisma } from '../../config/database.config.js';
import { recuperacionService } from '../recuperaciones/recuperacion.service.js';

/**
 * Función auxiliar para calcular fechas DENTRO DE UN RANGO (Dinámico) 📅
 * Garantiza que la primera clase sea IGUAL o POSTERIOR a la fecha de inicio.
 */
const calcularProximasFechas = (fechaInicio, diaSemanaClase, fechaLimite) => {
  const fechas = [];
  const fechaActual = new Date(fechaInicio);
  const diaSemanaNormalizado = diaSemanaClase === 7 ? 0 : Number(diaSemanaClase);

  if (!Number.isInteger(diaSemanaNormalizado) || diaSemanaNormalizado < 0 || diaSemanaNormalizado > 6) {
    throw new Error(`Dia de semana invalido para generar clases: ${diaSemanaClase}`);
  }

  // 🔥 CORRECCIÓN DE ZONA HORARIA (Mediodía para evitar saltos de día)
  fechaActual.setHours(12, 0, 0, 0);

  const limiteFijo = new Date(fechaLimite);
  limiteFijo.setHours(12, 0, 0, 0);

  // 1. Buscamos el primer día de clase válido que sea >= fechaInicio
  // Si la fechaInicio ya coincide con diaSemanaClase, se queda ahí.
  const diasHastaPrimeraClase = (diaSemanaNormalizado - fechaActual.getDay() + 7) % 7;
  fechaActual.setDate(fechaActual.getDate() + diasHastaPrimeraClase);

  // 2. Generamos fechas MIENTRAS no superemos el límite de los 30 días
  // Importante: Si la primera fecha encontrada ya se pasó del límite, no agrega nada.
  while (fechaActual <= limiteFijo) {
    fechas.push(new Date(fechaActual));
    fechaActual.setDate(fechaActual.getDate() + 7);
  }

  return fechas;
};

export const asistenciaService = {
  /**
   * Genera masivamente las clases futuras respetando el CICLO DE 30 DÍAS.
   * Ahora prioriza el parámetro 'fecha_inicio' para evitar solapamientos.
   */
  generarClasesFuturas: async (tx, params) => {
    // 🔥 Desestructuramos incluyendo el nuevo parámetro fecha_inicio
    const { inscripcion_id, dia_semana, usuario_admin_id, coordinador_id, fecha_inicio } = params;

    const DIAS_CICLO = 30;

    // =================================================================
    // 🧠 LÓGICA DE PUNTO DE PARTIDA (Prioridad de Negocio)
    // =================================================================
    let fechaInicioCalculo;

    if (fecha_inicio) {
      // 🌟 REGLA DE ORO: Si el pago ya definió cuándo empieza el ciclo (ej. 05/03), mandamos esa.
      fechaInicioCalculo = new Date(fecha_inicio);
      console.log(
        `🚀 Generando clases desde FECHA PROGRAMADA: ${fechaInicioCalculo.toLocaleDateString()}`
      );
    } else {
      // 🔄 FALLBACK: Lógica de empalme automática si se llama sin fecha_inicio
      const ultimaClase = await tx.registros_asistencia.findFirst({
        where: { inscripcion_id: inscripcion_id },
        orderBy: { fecha: 'desc' },
      });

      fechaInicioCalculo = new Date(); // Por defecto: HOY

      if (ultimaClase) {
        const fechaUltima = new Date(ultimaClase.fecha);
        if (fechaUltima > fechaInicioCalculo) {
          console.log(
            `📅 Detectada continuidad. Empalmando tras última clase: ${fechaUltima.toLocaleDateString()}`
          );
          fechaUltima.setDate(fechaUltima.getDate() + 1);
          fechaInicioCalculo = fechaUltima;
        }
      }
    }

    // =================================================================
    // 🧠 LÓGICA DE CÁLCULO DE LÍMITE (El "Hasta Cuándo")
    // =================================================================
    const fechaLimite = new Date(fechaInicioCalculo);
    fechaLimite.setDate(fechaLimite.getDate() + (DIAS_CICLO - 1));

    // 2. Calculamos las fechas reales de clase dentro de este ciclo
    const fechasClases = calcularProximasFechas(fechaInicioCalculo, dia_semana, fechaLimite);

    // 3. Preparamos los objetos para insertar
    const datosAsistencia = fechasClases.map((fecha) => ({
      inscripcion_id: inscripcion_id,
      fecha: fecha,
      estado: 'PROGRAMADA',
      registrado_por: coordinador_id,
      comentario: `Generado auto (Ciclo 30 días) - Admin ID: ${usuario_admin_id}`,
    }));

    // 4. Insertamos usando skipDuplicates para blindar la base de datos
    if (datosAsistencia.length > 0) {
      await tx.registros_asistencia.createMany({
        data: datosAsistencia,
        skipDuplicates: true,
      });
    }

    console.log(
      `✅ Ciclo generado: ${datosAsistencia.length} clases para ID ${inscripcion_id} (Hasta: ${fechaLimite.toLocaleDateString()})`
    );

    return datosAsistencia.length;
  },

  previsualizarfechasFuturas: async (dia_semana) => {

    const DIAS_CICLO = 30;

    const fechaInicioCalculo = new Date();

    const fechaLimite = new Date(fechaInicioCalculo);
    fechaLimite.setDate(fechaLimite.getDate() + (DIAS_CICLO - 1));

    let fechasTotales = [];

    for (const dia of dia_semana) {
      const fechasClases = calcularProximasFechas(fechaInicioCalculo, dia, fechaLimite);
      fechasTotales.push(fechasClases)
    }
    return fechasTotales;
  },

  // NO SE USA
  // marcarAsistencia: async (asistenciaId, estado, comentario) => {
  //   const asistenciaRegistrada = await prisma.registros_asistencia.update({
  //     where: { id: asistenciaId },
  //     data: {
  //       estado,
  //       comentario,
  //       actualizado_en: new Date()
  //     },
  //     include: {
  //       inscripciones: true
  //     }
  //   });

  //   // Crea un registro en la tabla recuperaciones con estado PENDIENTE en caso la asistencia sea registrada como FALTA.
  //   if (asistenciaRegistrada.estado === "FALTA") {
  //     const idAlumnoInscripcion = asistenciaRegistrada.inscripciones.alumno_id;
  //     await recuperacionService.registrarFaltaPendiente(idAlumnoInscripcion, asistenciaRegistrada.fecha)
  //   }

  //   return asistenciaRegistrada
  // },

  obtenerHistorial: async (inscripcionId) => {
    return await prisma.registros_asistencia.findMany({
      where: { inscripcion_id: parseInt(inscripcionId) },
      orderBy: { fecha: 'asc' },
    });
  },
  obtenerPorAlumno: async (alumnoId) => {
    return await prisma.registros_asistencia.findMany({
      where: {
        inscripciones: {
          alumno_id: parseInt(alumnoId),
        },
      },
      include: {
        reprogramaciones_clases: true,
        inscripciones: {
          include: {
            horarios_clases: {
              include: {
                canchas: { include: { sedes: true } },
                coordinadores: {
                  select: {
                    usuarios: {
                      select: {
                        nombres: true,
                        apellidos: true,
                      },
                    },
                  },
                },
                niveles_entrenamiento: true,
              },
            },
          },
        },
      },
      orderBy: { fecha: 'asc' }, // Recomendado 'asc' para ver cronológicamente
    });
  },

  /**
   * 🆕 Obtener todas las asistencias (Vista Admin)
   */
  obtenerTodas: async () => {
    return await prisma.registros_asistencia.findMany({
      include: {
        inscripciones: {
          include: {
            alumnos: {
              select: {
                usuarios: {
                  select: {
                    nombres: true,
                    apellidos: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { fecha: 'desc' },
    });
  },

  obtenerClasesDelDiaPorCoordinador: async (coordinadorId, fecha) => {
    const fechaConsulta = new Date(fecha);
    fechaConsulta.setHours(0, 0, 0, 0);
    const diaSemana = fechaConsulta.getDay();

    return await prisma.horarios_clases.findMany({
      where: {
        coordinador_id: coordinadorId,
        activo: true,
        OR: [
          { dia_semana: diaSemana },
          {
            inscripciones: {
              some: {
                registros_asistencia: {
                  some: {
                    fecha: fechaConsulta,
                    reprogramacion_clase_id: { not: null }
                  }
                }
              }
            }
          }
        ]
      },
      include: {
        niveles_entrenamiento: true,
        canchas: { include: { sedes: true } },
        inscripciones: {
          where: { estado: { in: ['ACTIVO', 'PEN-RECU'] } },
          include: {
            alumnos: {
              include: {
                usuarios: {
                  select: { id: true, nombres: true, apellidos: true },
                },
              },
            },
            // IMPORTANTE: Buscamos el registro de asistencia específico para este día
            registros_asistencia: {
              where: { fecha: fechaConsulta },
              select: {
                id: true, // Este es el ID que usará el coordinador para marcar
                estado: true, // Saldrá "PROGRAMADA" inicialmente
                comentario: true,
                reprogramaciones_clases: {
                  select: {
                    hora_inicio_destino: true,
                    hora_fin_destino: true
                  }
                },
              },
            },
          },
        },
      },
      orderBy: { hora_inicio: 'asc' },
    });
  },
  // En asistencia.service.js
  obtenerAgendaCoordinador: async (coordinadorId, fecha = null) => {
    const whereCondition = {
      coordinador_id: coordinadorId,
      activo: true,
    };

    if (fecha) {
      const fechaConsulta = new Date(fecha);
      fechaConsulta.setHours(0, 0, 0, 0);
      const diaSemana = fechaConsulta.getDay();

      whereCondition.OR = [
        { dia_semana: diaSemana },
        {
          inscripciones: {
            some: {
              registros_asistencia: {
                some: {
                  fecha: fechaConsulta,
                  reprogramacion_clase_id: { not: null }
                }
              }
            }
          }
        }
      ];
    }

    const horarios = await prisma.horarios_clases.findMany({
      where: whereCondition,
      include: {
        niveles_entrenamiento: true,
        canchas: { include: { sedes: true } },
        inscripciones: {
          where: { estado: { in: ['ACTIVO', 'PEN-RECU'] } },
          include: {
            alumnos: {
              include: {
                usuarios: {
                  select: { id: true, nombres: true, apellidos: true, numero_documento: true },
                },
              },
            },
            registros_asistencia: {
              where: fecha
                ? {
                  OR: [
                    { fecha: new Date(fecha) },
                    { reprogramacion_clase_id: { not: null } }
                  ]
                }
                : undefined,
              orderBy: { fecha: 'asc' },
              select: {
                id: true,
                fecha: true,
                estado: true,
                comentario: true,
                fecha_original: true,
                reprogramacion_clase_id: true,
                reprogramaciones_clases: {
                  select: {
                    hora_inicio_destino: true,
                    hora_fin_destino: true
                  }
                },
              },
            },
          },
        },
      },
      orderBy: { hora_inicio: 'asc' },
    });

    // 🛡️ 2. SOLUCIÓN AL ERROR 500: Creamos un nuevo arreglo para NO mutar la data original de Prisma
    const horariosProcesados = [];

    // Lógica para sumar a los alumnos que recuperarán clases ese dia.
    for (let horario of horarios) {
      const alumnosRecuperadores = await prisma.recuperaciones.findMany({
        where: {
          horario_destino_id: horario.id,
          estado: { in: ['PROGRAMADA', 'COMPLETADA_PRESENTE', 'COMPLETADA_FALTA'] },
        },
        include: {
          alumnos: {
            include: {
              usuarios: {
                select: { id: true, nombres: true, apellidos: true, numero_documento: true },
              },
            },
          },
        },
      });

      // Damos format a los alumnos para el front
      const recuperadoresFormat = alumnosRecuperadores.map((rec) => {
        let estadoFormat = 'PROGRAMADA';
        if (rec.estado === 'COMPLETADA_PRESENTE') estadoFormat = 'PRESENTE';
        else if (rec.estado === 'COMPLETADA_FALTA') estadoFormat = 'FALTA';

        return {
          id: `insc-recu-${rec.id}`,
          estado: 'RECUPERACION',
          tipo_sesion: 'RECUPERACION',
          alumnos: rec.alumnos,
          registros_asistencia: [
            {
              id: `reg-asis-recu-${rec.id}`,
              fecha: rec.fecha_programada,
              estado: estadoFormat,
              comentario: 'Alumno en clase de recuperación',
              tipo_sesion: 'RECUPERACION'
            },
          ],
        };
      });

      // 🌟 Combinamos las inscripciones de forma segura en un NUEVO objeto
      horariosProcesados.push({
        ...horario,
        inscripciones: [
          ...horario.inscripciones.map(ins => {
            const reg = ins.registros_asistencia[0];
            const tipo = reg?.estado === 'REPROGRAMADO'
              ? 'REPROGRAMADO'
              : reg?.fecha_original
                ? 'REPOSICION'
                : 'REGULAR';

            return {
              ...ins,
              tipo_sesion: tipo,
              registros_asistencia: ins.registros_asistencia.map(r => ({
                ...r,
                tipo_sesion: r.estado === 'REPROGRAMADO'
                  ? 'REPROGRAMADO'
                  : r.fecha_original
                    ? 'REPOSICION'
                    : 'REGULAR'
              }))
            };
          }),
          ...recuperadoresFormat
        ],
      });
    }

    // TRANSFORMACIÓN: Limpiamos la data usando el nuevo arreglo procesado
    return horariosProcesados.map((h) => {
      // Filtramos los registros "Fantasma" de las inscripciones regulares
      h.inscripciones.forEach((insc) => {
        if (insc.estado !== 'RECUPERACION') {
          insc.registros_asistencia = insc.registros_asistencia.filter(
            (reg) => !reg.comentario?.includes('[RECUPERACION]')
          );
        }
      });

      // Función interna para extraer solo HH:mm y evitar el bug de 1970
      const formatTime = (timeField) => {
        if (!timeField) return '--:--';
        const d = new Date(timeField);
        // transformamos a string la hora y minutos para evitar el cambio de zona horario en el front.
        const horas = d.getUTCHours().toString().padStart(2, '0');
        const minutos = d.getUTCMinutes().toString().padStart(2, '0');
        return `${horas}:${minutos}`;
      };

      return {
        ...h,
        hora_inicio: formatTime(h.hora_inicio),
        hora_fin: formatTime(h.hora_fin),
      };
    });
  },

  procesarAsistenciaMasiva: async (asistencias) => {

    const esFechaFutura = (fechaClase) => {
      const hoy = new Date();
      const hoyUTC = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());

      const fecha = new Date(fechaClase);
      const fechaUTC = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());

      return fechaUTC > hoyUTC;
    };

    return await prisma.$transaction(async (tx) => {
      for (const a of asistencias) {
        // Por si el alumno es de recuperación
        if (typeof a.id === 'string' && a.id.startsWith('reg-asis-recu-')) {
          const recuperacionId = parseInt(a.id.split('-')[3]);

          // Marcar el ticket de recuperación
          const recu = await tx.recuperaciones.update({
            where: { id: recuperacionId },
            data: {
              estado: a.estado === 'FALTA'
                ? 'COMPLETADA_FALTA'
                : a.estado === 'PRESENTE'
                  ? 'COMPLETADA_PRESENTE'
                  : a.estado
            }
          });

          if (esFechaFutura(recu.fecha_programada)) {
            throw new Error("No se puede registrar recuperación en una fecha futura.");
          }

          const inscActiva = await tx.inscripciones.findFirst({
            where: { alumno_id: recu.alumno_id, estado: { in: ['ACTIVO', 'PEN-RECU'] } },
          });

          if (inscActiva) {
            // Obtenemos el registro si en caso existiera para manejarlo por posible error humano (marcar PRESENTE a un alumno que nunca llegó)
            const registroFisicoExistente = await tx.registros_asistencia.findFirst({
              where: {
                inscripcion_id: inscActiva.id,
                fecha: recu.fecha_programada,
                comentario: { contains: '[RECUPERACION]' }, // Usamos la etiqueta para encontrarlo
              },
            });

            if (a.estado === 'FALTA') {
              // Si se corrigió el registro como FALTA, lo borramos
              if (registroFisicoExistente) {
                await tx.registros_asistencia.delete({
                  where: { id: registroFisicoExistente.id },
                });
              }
            } else {
              if (registroFisicoExistente) {
                // Si es marcado como PRESENTE y el registro ya existia, solo se actualiza el estado.
                await tx.registros_asistencia.update({
                  where: { id: registroFisicoExistente.id },
                  data: {
                    estado: a.estado,
                  },
                });
              } else {
                // Si no existe, lo creamos
                await tx.registros_asistencia.create({
                  data: {
                    inscripcion_id: inscActiva.id,
                    fecha: recu.fecha_programada,
                    estado: a.estado,
                    comentario: `[RECUPERACION] ${a.comentario || ''}`,
                  },
                });
              }
            }
          }
          continue;
        }

        // Si el estado de la asistencia es JUSTIFICADO_LESION, se salta al siguiente alumno.
        const asistencia = await tx.registros_asistencia.findUnique({
          where: { id: Number(a.id) },
        });
        if (!asistencia || asistencia.estado === 'JUSTIFICADO_LESION') {
          continue;
        }

        if (esFechaFutura(asistencia.fecha)) {
          throw new Error("No se puede registrar asistencia en una fecha futura.");
        }

        // Si es un alumno fijo, simplemente se actualiza la asistencia
        const asistenciaRegistrada = await tx.registros_asistencia.update({
          where: { id: Number(a.id) },
          data: {
            estado: a.estado,
            comentario: a.comentario || '',
            registrado_en: new Date(),
          },
          include: {
            inscripciones: true,
          },
        });

        const idAlumnoInscripcion = asistenciaRegistrada.inscripciones.alumno_id;
        const fechaClase = asistenciaRegistrada.fecha;

        // 🔥 REGLA DE NEGOCIO: Si la clase es [NO_RECUPERABLE], saltamos la generación del ticket de falta.
        // Lo verificamos desde el objeto 'asistencia' que cargamos de la BD antes del update.
        const esNoRecuperable = asistencia.comentario?.includes('[NO_RECUPERABLE]');

        // Crea un registro en la tabla recuperaciones con estado PENDIENTE en caso la asistencia sea registrada como FALTA.
        if (asistenciaRegistrada.estado === 'FALTA' && !esNoRecuperable) {
          await recuperacionService.registrarFaltaPendiente(
            tx,
            idAlumnoInscripcion,
            fechaClase,
            asistencia.id
          );
        } else if (asistenciaRegistrada.estado === 'PRESENTE') {
          // En caso el alumno llegue tarde, se elimina la recuperación generada.
          await recuperacionService.anularFaltaPendiente(tx, idAlumnoInscripcion, asistencia.id);
        }

        // Si era no recuperable, nos aseguramos de que el tag persista si el coordinador escribió algo
        if (esNoRecuperable && !asistenciaRegistrada.comentario?.includes('[NO_RECUPERABLE]')) {
          await tx.registros_asistencia.update({
            where: { id: asistenciaRegistrada.id },
            data: { comentario: `[NO_RECUPERABLE] ${asistenciaRegistrada.comentario || ''}` }
          });
        }
      }
    });
  },
  obtenerEstadisticasAlumno: async (alumnoId) => {
    // 1. Traemos TODOS los registros del alumno
    const registros = await prisma.registros_asistencia.findMany({
      where: {
        inscripciones: {
          alumno_id: parseInt(alumnoId),
        }
      }
    });

    // 2. Inicializamos los contadores
    let presente = 0;
    let falta = 0;
    let programada = 0;
    let justificado_lesion = 0;

    // 3. Clasificamos cada clase según tu regla de negocio
    registros.forEach(reg => {
      // Agrupamos también las recuperaciones completadas para ser justos
      if (reg.estado === 'PRESENTE' || reg.estado === 'COMPLETADA_PRESENTE') {
        presente++;
      } else if (reg.estado === 'FALTA' || reg.estado === 'COMPLETADA_FALTA') {
        falta++;
      } else if (reg.estado === 'PROGRAMADA') {
        programada++;
      } else if (reg.estado === 'JUSTIFICADO_LESION') {
        justificado_lesion++;
      }
    });

    // 4. EL NÚCLEO DE LA EVALUACIÓN (Solo Presentes y Faltas)
    const clasesEvaluables = presente + falta;

    // 5. Matemáticas de porcentajes (evitando dividir por cero)
    const porcentajePresente = clasesEvaluables > 0 ? Math.round((presente / clasesEvaluables) * 100) : 0;
    const porcentajeFalta = clasesEvaluables > 0 ? Math.round((falta / clasesEvaluables) * 100) : 0;

    // 6. Armamos la respuesta perfecta para el Frontend
    return {
      porcentaje_asistencia_real: porcentajePresente, // El dato principal
      totales: {
        evaluadas: clasesEvaluables,
        ignoradas: programada + justificado_lesion,
        historico_completo: registros.length
      },
      detalle: {
        PRESENTE: {
          cantidad: presente,
          porcentaje: porcentajePresente
        },
        FALTA: {
          cantidad: falta,
          porcentaje: porcentajeFalta
        },
        PROGRAMADA: {
          cantidad: programada,
          porcentaje: null // Se ignora en el cálculo
        },
        JUSTIFICADO_LESION: {
          cantidad: justificado_lesion,
          porcentaje: null // Se ignora en el cálculo
        }
      }
    };
  },

  eliminarClases: async (tx, inscripcionId, fecha_inscripcion_original) => {
    // const hoy = new Date()
    // hoy.setHours(0, 0, 0, 0)

    const registros = await tx.registros_asistencia.deleteMany({
      where: {
        inscripcion_id: inscripcionId,
        fecha: {
          gte: fecha_inscripcion_original,
        }
      }
    })
    return registros.count;
  }
};
