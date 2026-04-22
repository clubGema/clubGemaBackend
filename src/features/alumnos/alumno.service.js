import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { alumnoLogic } from './logic/alumno.logic.js';

export const alumnoService = {
  actualizarMiPerfil: async (usuarioId, datos) => {
    return await prisma.$transaction(async (tx) => {
      await alumnoLogic.actualizarDatosBaseUsuario(tx, usuarioId, datos);

      const alumnoActual = await tx.alumnos.findUnique({
        where: { usuario_id: usuarioId },
        select: { usuario_id: true, direccion_id: true },
      });

      if (!alumnoActual) {
        throw new ApiError('Alumno no encontrado', 404);
      }

      const direccionId = await alumnoLogic.gestionarDireccion(
        tx,
        alumnoActual.direccion_id,
        datos
      );

      return await alumnoLogic.actualizarPerfilMedico(tx, usuarioId, direccionId, datos);
    });
  },
  obtenerMiPerfil: async (usuarioId) => {
    // Realizamos una consulta anidada para traer todo el expediente
    const perfil = await prisma.usuarios.findUnique({
      where: { id: usuarioId },
      include: {
        alumnos: {
          include: {
            direcciones: true, // Traemos calle, distrito y referencia
          },
        },
      },
    });

    if (!perfil) throw new ApiError('Alumno no encontrado', 404);
    return perfil;
  },

  listarAlumnosResumen: async () => {
    const alumnos = await prisma.alumnos.findMany({
      include: {
        usuarios: {
          select: {
            nombres: true,
            apellidos: true,
            numero_documento: true,
          }
        },
        inscripciones: {
          where: { estado: 'ACTIVO' }, // Solo jalamos lo que está pagado/activo
          select: {
            id: true,
            fecha_inscripcion: true,
          }
        }
      }
    });

    // Mapeamos para darte el formato exacto que necesitas
    return alumnos.map(alumno => {
      // Si tiene varias inscripciones, tomamos la más reciente para el "Día de Corte"
      // o puedes devolver un array de fechas si lo prefieres.
      const inscripcionesProcesadas = alumno.inscripciones.map(ins => {
        const fechaCorte = new Date(ins.fecha_inscripcion);
        fechaCorte.setDate(fechaCorte.getDate() + 3); // 🚨 REGLA: +3 días para el corte

        return {
          inscripcion_id: ins.id,
          fecha_inicio: ins.fecha_inscripcion,
          fecha_corte: fechaCorte
        };
      });

      return {
        id: alumno.usuario_id,
        nombre_completo: `${alumno.usuarios.nombres} ${alumno.usuarios.apellidos}`,
        dni: alumno.usuarios.numero_documento,
        // Enviamos todas sus inscripciones activas con sus respectivos cortes
        contratos: inscripcionesProcesadas,
        // Resumen rápido de la fecha de corte más cercana (opcional)
        fecha_corte_principal: inscripcionesProcesadas.length > 0 
          ? inscripcionesProcesadas[0].fecha_corte 
          : null
      };
    });
  },
  // alumno.service.js

listarAlumnosResumenPorCoordinador: async (coordinadorId) => {
  const diasMapa = { 1: 'LUN', 2: 'MAR', 3: 'MIE', 4: 'JUE', 5: 'VIE', 6: 'SAB', 7: 'DOM' };

  // Función interna para limpiar las horas y evitar el error de 1970
  const formatearHora = (hora) => {
    if (!hora) return "--:--";
    if (hora instanceof Date) {
      return hora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    // Si viene como string ISO o similar, extraemos solo HH:mm
    return hora.toString().includes('T') ? hora.toISOString().substring(11, 16) : hora.toString().substring(0, 5);
  };

  const alumnos = await prisma.alumnos.findMany({
    where: {
      inscripciones: {
        some: {
          estado: 'ACTIVO',
          horarios_clases: { coordinador_id: coordinadorId }
        }
      }
    },
    include: {
      usuarios: {
        select: { nombres: true, apellidos: true, numero_documento: true }
      },
      inscripciones: {
        where: { 
          estado: 'ACTIVO',
          horarios_clases: { coordinador_id: coordinadorId } 
        },
        include: {
          horarios_clases: {
            include: {
              canchas: { include: { sedes: true } }
            }
          }
        }
      }
    }
  });

  return alumnos.map(alumno => {
    // Ordenar por la inscripción más reciente
    const inscripcionesOrdenadas = [...alumno.inscripciones].sort(
      (a, b) => new Date(b.fecha_inscripcion) - new Date(a.fecha_inscripcion)
    );

    const inscripcionesProcesadas = inscripcionesOrdenadas.map(ins => {
      const h = ins.horarios_clases;
      const fechaCorte = new Date(ins.fecha_inscripcion);
      fechaCorte.setDate(fechaCorte.getDate() + 30); // ✅ REGLA 30 DÍAS

      return {
        inscripcion_id: ins.id,
        fecha_inicio: ins.fecha_inscripcion,
        fecha_corte: fechaCorte,
        sede: h.canchas?.sedes?.nombre || h.canchas?.nombre || "CALLAO",
        // ✅ Formato: LUN 20:30 - 22:00
        horario: `${diasMapa[h.dia_semana] || h.dia_semana} ${formatearHora(h.hora_inicio)} - ${formatearHora(h.hora_fin)}`
      };
    });

    return {
      id: alumno.usuario_id,
      nombre_completo: `${alumno.usuarios.nombres} ${alumno.usuarios.apellidos}`,
      dni: alumno.usuarios.numero_documento,
      contratos: inscripcionesProcesadas,
      fecha_corte_principal: inscripcionesProcesadas[0]?.fecha_corte || null
    };
  });
},
};
