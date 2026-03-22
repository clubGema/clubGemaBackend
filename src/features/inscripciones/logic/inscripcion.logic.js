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
  // 🕒 Medianoche UTC para comparar días exactos sin líos de horas
  const hoy = new Date(
    Date.UTC(hoyRaw.getUTCFullYear(), hoyRaw.getUTCMonth(), hoyRaw.getUTCDate())
  );

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

    // 🔥 REGLA DE ORO: BLOQUEO CASO 9 (Pagador Adelantado / Salto al Futuro)
    // Si su "Día 1" es después de hoy, significa que ya renovó.
    if (inicioLimpio > hoy) {
      throw new Error(
        `⛔ CIERRE DE CICLO: Ya adelantaste el pago de tu próximo mes (inicia el ${inicioLimpio.toLocaleDateString('es-PE')}). Por orden administrativo, no puedes sumar clases extras en este momento para evitar descuadres.`
      );
    }

    // 📅 CÁLCULO DEL FIN DE CICLO (Día 30)
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

    // 🧱 REGLA DE SEGURIDAD: CASO 5 (Bloqueo Anti-Limbo)
    // Si le quedan 5 días o menos para vencer, no lo dejamos hacer Upgrade.
    if (diasParaFinCiclo <= 5 && diasParaFinCiclo >= 0) {
      throw new Error(
        `⛔ BLOQUEO DE CICLO: Te quedan solo ${diasParaFinCiclo} días para terminar tu mes. No puedes agregar horarios ahora; espera a tu próxima renovación.`
      );
    }

    // ✅ RETORNO DE CICLO VÁLIDO
    // Permitimos Upgrades si el ciclo es vigente O si está en el margen de 15 días (tu colchón)
    if (fechaFinCiclo > hoyRaw || diasParaFinCiclo >= -15) {
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
