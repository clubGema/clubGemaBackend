import { prisma } from '../../config/database.config.js';

export const notificacionesService = {
  // Para que los Crons y transacciones usen esta función
  crear: async (data, db = prisma) => {
    return await db.notificaciones.create({
      data: {
        usuario_id: data.usuarioId || null,
        alumno_id: data.alumnoId || null,
        titulo: data.titulo,
        mensaje: data.mensaje,
        tipo: data.tipo || 'INFO',
        categoria: data.categoria || 'SISTEMA'
      }
    });
  },

  // Para el Dashboard (Frontend)
  obtenerTodas: async () => {
    return await prisma.notificaciones.findMany({
      include: {
        alumnos: {
          include: { usuarios: { select: { nombres: true, apellidos: true } } }
        }
      },
      orderBy: { creado_en: 'desc' },
      take: 50 // Para no saturar el front, traemos las últimas 50
    });
  },

  marcarComoLeida: async (id) => {
    return await prisma.notificaciones.update({
      where: { id: Number.parseInt(id) },
      data: { leido: true }
    });
  },

  // 🔥 SOLUCIÓN: Busca tanto en usuario_id como en alumno_id
  obtenerPorUsuario: async (usuarioId) => {
    return await prisma.notificaciones.findMany({
      where: { 
        OR: [
          { usuario_id: usuarioId },
          { alumno_id: usuarioId }
        ]
      },
      include: {
        alumnos: {
          include: { usuarios: { select: { nombres: true, apellidos: true } } }
        }
      },
      orderBy: { creado_en: 'desc' },
      take: 50
    });
  },

  // 🔥 SOLUCIÓN: Aplica el mismo OR para el contador de la campanita
  obtenerConteoNoLeidas: async (usuarioId) => {
    return await prisma.notificaciones.count({
      where: {
        OR: [
          { usuario_id: usuarioId },
          { alumno_id: usuarioId }
        ],
        leido: false
      }
    });
  },
};