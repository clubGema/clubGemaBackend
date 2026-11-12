// Elección del plan del catálogo según el régimen del alumno.
//
// Antes cada servicio hacía `findFirst({ es_vigente: !esLegacy })`. Eso dependía de
// un único booleano: si alguien dejaba los planes legacy con es_vigente = true,
// un alumno Antiguo se quedaba sin plan ("No existe un plan para 2 clases") y uno
// Nuevo recibía un precio al azar. Acá el régimen se decide por el código interno
// (*_LEGACY_*) y por es_vigente, y NUNCA se bloquea la inscripción: si no hay plan
// del régimen, se usa el otro.

const CODIGO_LEGACY = /legacy/i;

/** Un concepto es legacy si su código lo dice o si está marcado como no vigente. */
export const esConceptoLegacy = (c) => CODIGO_LEGACY.test(c?.codigo_interno ?? '') || !c?.es_vigente;

/** Un concepto es 2026 (vigente) si no es legacy por código y está marcado vigente. */
const esConceptoActual = (c) => !CODIGO_LEGACY.test(c?.codigo_interno ?? '') && Boolean(c?.es_vigente);

/**
 * Elige el plan de `cantidad` clases/semana para el régimen dado.
 * `candidatos` son conceptos activos; el orden de entrada resuelve los empates.
 */
export const elegirPlanPorRegimen = (candidatos, cantidad, esLegacy) => {
    const delTamano = (candidatos ?? []).filter((c) => c.activo && c.cantidad_clases_semanal === cantidad);
    const legacy = delTamano.filter(esConceptoLegacy);
    const actuales = delTamano.filter(esConceptoActual);

    if (esLegacy) return legacy[0] ?? actuales[0] ?? null;
    return actuales[0] ?? delTamano.find((c) => !CODIGO_LEGACY.test(c.codigo_interno ?? '')) ?? null;
};

/** Variante con acceso a la base (acepta prisma o una transacción). */
export const resolverPlanPorRegimen = async (db, cantidad, esLegacy) => {
    const candidatos = await db.catalogo_conceptos.findMany({
        where: { activo: true, cantidad_clases_semanal: cantidad },
        orderBy: { id: 'asc' },
    });
    return elegirPlanPorRegimen(candidatos, cantidad, esLegacy);
};