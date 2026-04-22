import { prisma } from '../../config/database.config.js'; // Ajusta la ruta a tu cliente de prisma

const anunciosBeneficiosService = {
  obtenerActivos: async () => {
    return await prisma.anuncios_beneficios.findMany({
      where: { activo: true },
      orderBy: { orden: 'asc' }
    });
  },

  obtenerTodos: async () => {
    return await prisma.anuncios_beneficios.findMany({
      orderBy: { orden: 'asc' }
    });
  },

  crear: async (data) => {
    return await prisma.anuncios_beneficios.create({
      data: {
        tipo: data.tipo,
        titulo: data.titulo,
        descripcion: data.descripcion,
        icono: data.icono || "Gift",
        gradiente: data.gradiente || "from-[#1e3a8a] to-blue-600",
        badge: data.badge,
        activo: data.activo ?? true,
        orden: data.orden ? Number(data.orden) : 0
      }
    });
  },

  actualizar: async (id, data) => {
    return await prisma.anuncios_beneficios.update({
      where: { id: Number(id) },
      data
    });
  },

  eliminar: async (id) => {
    return await prisma.anuncios_beneficios.delete({
      where: { id: Number(id) }
    });
  }
};

export default anunciosBeneficiosService;