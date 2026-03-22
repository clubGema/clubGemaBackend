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
 * Determina si es un Upgrade y calcula la fecha de corte del ciclo actual.
 */
/**
 * Determina si es un Upgrade y calcula la fecha de corte del ciclo actual.
 */
/**
 * Determina si es un Upgrade y calcula la fecha de corte del ciclo actual.
 */
/**
 * Determina si es un Upgrade y calcula la fecha de corte del ciclo actual.
 * 🛡️ BLINDAJE: Caso 9 (Pagador Adelantado) y Caso 5 (Anti-Limbo).
 */
export const calcularCicloUpgrade = async (tx, alumnoId) => {
  const hoyRaw = new Date();
  const hoy = new Date(
    Date.UTC(hoyRaw.getUTCFullYear(), hoyRaw.getUTCMonth(), hoyRaw.getUTCDate())
  );

  // 1️⃣ [NUEVO] Traemos el valor real de la base de datos (tu captura de DBeaver)
  const parametroTolerancia = await tx.parametros_sistema.findUnique({
    where: { clave: 'DIAS_TOLERANCIA_VENCIMIENTO' },
  });

  // Si por alguna razón no existe en la BD, usamos 5 por defecto por seguridad
  const diasTolerancia = parametroTolerancia ? parseInt(parametroTolerancia.valor) : 5;

  const inscripcionMadre = await tx.inscripciones.findFirst({
    where: { alumno_id: parseInt(alumnoId), estado: 'ACTIVO' },
    orderBy: { fecha_inscripcion: 'asc' },
  });

  if (inscripcionMadre) {
    const fechaInicioCiclo = new Date(inscripcionMadre.fecha_inscripcion);
    const inicioLimpio = new Date(
      Date.UTC(
        fechaInicioCiclo.getUTCFullYear(),
        fechaInicioCiclo.getUTCMonth(),
        fechaInicioCiclo.getUTCDate()
      )
    );

    // CASO 9: Bloqueo de futuro
    if (inicioLimpio > hoy) {
      throw new Error(
        `⛔ CIERRE DE CICLO: Ya adelantaste el pago de tu próximo mes (inicia el ${inicioLimpio.toLocaleDateString('es-PE')}).`
      );
    }

    const fechaFinCiclo = new Date(fechaInicioCiclo);
    fechaFinCiclo.setDate(fechaFinCiclo.getDate() + 30);

    const finLimpio = new Date(
      Date.UTC(
        fechaFinCiclo.getUTCFullYear(),
        fechaFinCiclo.getUTCMonth(),
        fechaFinCiclo.getUTCDate()
      )
    );
    const diasParaFinCiclo = Math.round(
      (finLimpio.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
    );

    // 2️⃣ [CORRECCIÓN DINÁMICA] Usamos "diasTolerancia" de la BD
    // Bloqueamos si faltan 5 días (o lo que diga la BD) o si ya venció
    if (diasParaFinCiclo <= diasTolerancia) {
      throw new Error(
        `⛔ CIERRE DE VENTAS: Estás en los últimos ${diasTolerancia} días de tu ciclo (o ya venció). Por orden administrativo, no se permiten Upgrades para evitar descuadres en tu próxima facturación.`
      );
    }

    if (fechaFinCiclo > hoyRaw) {
      return {
        fechaCorte: fechaFinCiclo,
        fechaMadre: fechaInicioCiclo,
      };
    }
  }

  return null;
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
