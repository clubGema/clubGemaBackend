import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { alumnoService } from '../alumnos/alumno.service.js';

export const catalogoService = {
  findAll: async () => {
    return await prisma.catalogo_conceptos.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
  },

  findVigentes: async () => {
    return await prisma.catalogo_conceptos.findMany({
      where: {
        activo: true,
        es_vigente: true
      },
      orderBy: { precio_base: 'asc' },
    });
  },

  findLegacy: async () => {
    const conceptos = await prisma.catalogo_conceptos.findMany({
      where: {
        activo: true,
      },
      orderBy: { precio_base: 'asc' },
    });
    return conceptos.filter(c => c.codigo_interno.toLowerCase().includes("legacy"))
  },

  findOne: async (id) => {
    const concepto = await prisma.catalogo_conceptos.findUnique({
      where: { id },
    });
    if (!concepto || !concepto.activo) {
      throw new ApiError('Concepto no encontrado o inactivo', 404);
    }
    return concepto;
  },

  create: async (data) => {
    const existeCodigo = await prisma.catalogo_conceptos.findFirst({
      where: { codigo_interno: data.codigo_interno },
    });
    if (existeCodigo) {
      throw new ApiError(`El código interno ${data.codigo_interno} ya está en uso`, 400);
    }

    return await prisma.catalogo_conceptos.create({
      data: {
        codigo_interno: data.codigo_interno,
        nombre: data.nombre,
        precio_base: data.precio_base, // Ya convertido a Number por Zod
        cantidad_clases_semanal: data.cantidad_clases_semanal, // Zod coerces
        es_vigente: true,
        activo: true,
      },
    });
  },

  update: async (id, data) => {
    await catalogoService.findOne(id); // Validation

    // Si intenta actualizar el código, validamos unicidad
    if (data.codigo_interno) {
      const existeCodigo = await prisma.catalogo_conceptos.findFirst({
        where: {
          codigo_interno: data.codigo_interno,
          id: { not: id },
        },
      });
      if (existeCodigo) {
        throw new ApiError(
          `El código interno ${data.codigo_interno} ya está en uso por otro concepto`,
          400
        );
      }
    }

    return await prisma.catalogo_conceptos.update({
      where: { id },
      data: {
        ...data,
      },
    });
  },

  delete: async (id) => {
    await catalogoService.findOne(id); // Validation

    // Borrado lógico (activo: false) para no romper la relación con cuentas_por_cobrar
    return await prisma.catalogo_conceptos.update({
      where: { id },
      data: { activo: false, es_vigente: false },
    });
  },
};
