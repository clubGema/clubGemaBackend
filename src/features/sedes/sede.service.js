import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';

const DIRECCION_SELECT = {
  select: { id: true, direccion_completa: true, distrito: true, ciudad: true, referencia: true },
};

const SEDE_SELECT_FIELDS = {
  id: true,
  nombre: true,
  telefono_contacto: true,
  tipo_instalacion: true,
  activo: true,
  direcciones: DIRECCION_SELECT,
  canchas: {
    select: {
      id: true,
      nombre: true,
      descripcion: true,
      horarios_clases: {
        where: { activo: true },
        select: {
          id: true,
          dia_semana: true,
          hora_inicio: true,
          hora_fin: true,
          niveles_entrenamiento: true,
          coordinadores: {
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
  },
  administrador: {
    select: {
      usuarios: {
        select: {
          nombres: true,
          apellidos: true,
          email: true,
          telefono_personal: true,
        },
      },
    },
  },
};

/**
 * Construye el objeto `where` para filtrar sedes.
 */
const buildWhereFilters = ({ activo, distrito, tipo_instalacion }) => {
  const where = {};
  if (activo !== undefined) {
    where.activo = activo === true || activo === 'true';
  }
  if (distrito) {
    where.direcciones = { distrito: { contains: distrito, mode: 'insensitive' } };
  }
  if (tipo_instalacion) {
    where.tipo_instalacion = { contains: tipo_instalacion, mode: 'insensitive' };
  }
  return where;
};

export const sedeService = {
  createSede: async (sedeData) => {
    const { direccion, administrador_id, canchas } = sedeData;

    const adminRelacion = await prisma.administrador.findUnique({
      where: { usuario_id: administrador_id },
      select: { usuario_id: true },
    });

    if (!adminRelacion) throw new ApiError('Administrador no válido', 404);

    return await prisma.$transaction(
      async (tx) => {
        const nuevaDireccion = await tx.direcciones.create({
          data: {
            direccion_completa: direccion.direccion_completa,
            distrito: direccion.distrito,
            ciudad: direccion.ciudad || 'Lima',
            referencia: direccion.referencia || null,
          },
        });

        const sedeCreada = await tx.sedes.create({
          data: {
            nombre: sedeData.nombre,
            telefono_contacto: sedeData.telefono_contacto || null,
            tipo_instalacion: sedeData.tipo_instalacion || null,
            activo: true,
            direccion_id: nuevaDireccion.id,
            administrador: {
              connect: { usuario_id: adminRelacion.usuario_id },
            },
          },
        });

        if (canchas && canchas.length > 0) {
          await tx.canchas.createMany({
            data: canchas.map((c) => ({
              nombre: c.nombre,
              descripcion: c.descripcion || '',
              sede_id: sedeCreada.id,
            })),
          });
        }

        return await tx.sedes.findUnique({
          where: { id: sedeCreada.id },
          select: SEDE_SELECT_FIELDS,
        });
      },
      { timeout: 10000 }
    );
  },

  getAllSedes: async (filters = {}) => {
    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 10;
    const { page: _p, limit: _l, ...rest } = filters;

    const where = buildWhereFilters(rest);
    const skip = (page - 1) * limit;

    const [sedes, total] = await Promise.all([
      prisma.sedes.findMany({
        where,
        select: SEDE_SELECT_FIELDS,
        orderBy: { nombre: 'asc' },
        skip,
        take: limit,
      }),
      prisma.sedes.count({ where }),
    ]);

    return { sedes, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  getSedeById: async (id) => {
    const sede = await prisma.sedes.findUnique({
      where: { id },
      select: SEDE_SELECT_FIELDS,
    });

    if (!sede) throw new ApiError('Sede no encontrada', 404);

    return sede;
  },

  getCanchaForSedeCount: async (filters = {}) => {
    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 10;
    const { page: _p, limit: _l, ...rest } = filters;

    const where = buildWhereFilters(rest);
    const skip = (page - 1) * limit;

    const [sedes, total] = await Promise.all([
      prisma.sedes.findMany({
        where,
        select: {
          id: true,
          nombre: true,
          tipo_instalacion: true,
          activo: true,
          direcciones: DIRECCION_SELECT,
          _count: { select: { canchas: true } },
        },
        orderBy: { nombre: 'asc' },
        skip,
        take: limit,
      }),
      prisma.sedes.count({ where }),
    ]);

    const sedesConConteo = sedes.map(({ _count, ...restSede }) => ({
      ...restSede,
      canchas_count: _count?.canchas ?? 0,
    }));

    return { sedes: sedesConConteo, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

 updateSede: async (id, sedeData) => {
  return await prisma.$transaction(async (tx) => {
    // 1. Actualizar datos de Sede y Dirección (Se mantiene igual)
    await tx.sedes.update({
      where: { id },
      data: {
        ...(sedeData.nombre && { nombre: sedeData.nombre }),
        ...(sedeData.telefono_contacto !== undefined && {
          telefono_contacto: sedeData.telefono_contacto,
        }),
        ...(sedeData.tipo_instalacion !== undefined && {
          tipo_instalacion: sedeData.tipo_instalacion,
        }),
        ...(sedeData.activo !== undefined && { activo: sedeData.activo }),
        ...(sedeData.direccion && {
          direcciones: {
            update: {
              ...(sedeData.direccion.direccion_completa && {
                direccion_completa: sedeData.direccion.direccion_completa,
              }),
              ...(sedeData.direccion.distrito && {
                distrito: sedeData.direccion.distrito,
              }),
              ...(sedeData.direccion.ciudad && {
                ciudad: sedeData.direccion.ciudad,
              }),
              ...(sedeData.direccion.referencia !== undefined && {
                referencia: sedeData.direccion.referencia,
              }),
            },
          },
        }),
      },
    });

    // 2. Procesar Canchas
    if (sedeData.canchas && Array.isArray(sedeData.canchas)) {
      const canchasExistentes = sedeData.canchas.filter((c) => c.id);
      const canchasNuevas = sedeData.canchas.filter((c) => !c.id);
      const idsAMantener = canchasExistentes.map((c) => c.id);

      // --- CAMBIO AQUÍ: VALIDACIÓN ANTES DE BORRAR ---
      // Buscamos qué canchas se quieren eliminar y si tienen registros
      const canchasAELiminar = await tx.canchas.findMany({
        where: {
          sede_id: id,
          id: { notIn: idsAMantener },
        },
        include: {
          _count: {
            select: { horarios_clases: true } // Asegúrate que el nombre sea igual a tu relación en el esquema
          }
        }
      });

      // Si alguna tiene clases/inscripciones, lanzamos error controlado
      const conDatos = canchasAELiminar.filter(c => c._count.horarios_clases > 0);
      if (conDatos.length > 0) {
        throw new ApiError(
          `No se puede quitar la cancha "${conDatos[0].nombre}" porque ya tiene inscripciones o clases programadas.`, 
          400
        );
      }

      // Si no tienen datos, procedemos a borrar
      await tx.canchas.deleteMany({
        where: {
          sede_id: id,
          id: { notIn: idsAMantener },
        },
      });

      // Updates en paralelo (Se mantiene igual)
      if (canchasExistentes.length > 0) {
        await Promise.all(
          canchasExistentes.map((c) =>
            tx.canchas.update({
              where: { id: c.id },
              data: { nombre: c.nombre, descripcion: c.descripcion || '' },
            })
          )
        );
      }

      // Crear nuevas (Se mantiene igual)
      if (canchasNuevas.length > 0) {
        const nombresNuevos = canchasNuevas.map((c) => c.nombre.toLowerCase());
        const yaExisten = await tx.canchas.findMany({
          where: {
            sede_id: id,
            nombre: { in: nombresNuevos, mode: 'insensitive' },
          },
          select: { nombre: true },
        });
        const nombresExistentes = new Set(yaExisten.map((c) => c.nombre.toLowerCase()));
        const realmNuevas = canchasNuevas.filter(
          (c) => !nombresExistentes.has(c.nombre.toLowerCase())
        );

        if (realmNuevas.length > 0) {
          await tx.canchas.createMany({
            data: realmNuevas.map((c) => ({
              nombre: c.nombre,
              descripcion: c.descripcion || '',
              sede_id: id,
            })),
          });
        }
      }
    }

    // 3. Retornar sede actualizada
    return await tx.sedes.findUnique({
      where: { id },
      select: SEDE_SELECT_FIELDS,
    });
  });
},

  updateDefuseSede: async (id) => {
    return await prisma.sedes.update({
      where: { id },
      data: { activo: false },
      select: { id: true, nombre: true, activo: true, direcciones: DIRECCION_SELECT },
    });
  },

  updateActiveSede: async (id) => {
    return await prisma.sedes.update({
      where: { id },
      data: { activo: true },
      select: { id: true, nombre: true, activo: true, direcciones: DIRECCION_SELECT },
    });
  },

  deleteSede: async (id) => {
    return await prisma.$transaction(async (tx) => {
      const sede = await tx.sedes.findUnique({
        where: { id },
        select: { direccion_id: true },
      });

      if (!sede) throw new ApiError('Sede no encontrada', 404);

      await tx.sedes.delete({ where: { id } });

      if (sede.direccion_id) {
        await tx.direcciones.delete({ where: { id: sede.direccion_id } });
      }

      return { success: true, message: 'Sede, canchas y dirección eliminadas correctamente' };
    });
  },
  obtenerOcupacionDashboard: async () => {
    // 1. Traemos solo las columnas necesarias (muy optimizado)
    const sedes = await prisma.sedes.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        canchas: {
          select: {
            horarios_clases: {
              select: {
                inscripciones: {
                  where: { estado: { in: ['ACTIVO'] } },
                  select: { alumno_id: true }
                }
              }
            }
          }
        }
      }
    });

    // 2. Procesamos con la regla: 1 alumno = 1 conteo por Sede
    const resultado = sedes.map(sede => {
      const alumnosUnicos = new Set(); // El Set ignora los IDs duplicados

      sede.canchas.forEach(cancha => {
        cancha.horarios_clases.forEach(horario => {
          horario.inscripciones.forEach(insc => {
            alumnosUnicos.add(insc.alumno_id);
          });
        });
      });

      return {
        nombre: sede.nombre,
        valor: alumnosUnicos.size // El tamaño del Set es la cantidad real de alumnos
      };
    });

    // Retornamos solo las sedes que tienen al menos 1 alumno
    return resultado.filter(r => r.valor > 0);
  },
};
