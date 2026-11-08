/**
 * Determina si el alumno es Legacy (antiguo) basándose en su último pago aprobado.
 */
export const detectarRegimenAlumno = async (tx, alumnoId) => {
  // 1. Buscamos al alumno directamente por su ID y sacamos solo su historial
  const alumno = await tx.alumnos.findUnique({
    where: { usuario_id: parseInt(alumnoId) },
    select: { historial: true },
  });

  // 2. Si no existe o su historial está vacío (null), por defecto es alumno NUEVO (false)
  if (!alumno || !alumno.historial) {
    return false;
  }

  // 3. Verificamos si en su historial dice "Antiguo".
  // Lo pasamos a mayúsculas para que no falle si el admin escribe "antiguo", "Antiguo" o "ANTIGUO".
  const esLegacy = alumno.historial.toUpperCase().includes('ANTIGUO');

  return esLegacy;
};

/**
 * Busca y valida el plan que el alumno tiene actualmente para heredarlo.
 */
export const obtenerPlanParaRenovar = async (tx, alumnoId) => {
  const ultimaDeuda = await tx.cuentas_por_cobrar.findFirst({
    where: { alumno_id: alumnoId },
    orderBy: { id: 'desc' },
    include: { catalogo_conceptos: true },
  });

  if (!ultimaDeuda || !ultimaDeuda.catalogo_conceptos) return null;

  const concepto = ultimaDeuda.catalogo_conceptos;

  // Si el plan fue desactivado por administración, no se hereda
  if (!concepto.activo) return null;

  return concepto;
};
