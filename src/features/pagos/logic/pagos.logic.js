/**
 * Resuelve el ID del método de pago, ya sea por número o por nombre.
 */
export const resolverMetodoPagoId = async (tx, metodo_pago) => {
  if (!isNaN(metodo_pago)) {
    return Number.parseInt(metodo_pago);
  }

  const metodoEncontrado = await tx.metodos_pago.findFirst({
    where: { nombre: { contains: metodo_pago, mode: 'insensitive' } },
  });

  if (!metodoEncontrado) {
    const defaultMetodo = await tx.metodos_pago.findFirst();
    if (!defaultMetodo) throw new Error('Error técnico: No hay métodos de pago.');
    return defaultMetodo.id;
  }

  return metodoEncontrado.id;
};

/**
 * Suma TODOS los abonos aprobados históricamente para esta cuenta
 * y determina si con el pago actual se llega al total.
 */
export const calcularSaldosAlcancía = async (tx, pagoActual) => {
  // Buscamos la suma de todos los pagos que YA estaban aprobados antes de este
  const pagosAnteriores = await tx.pagos.aggregate({
    where: {
      cuenta_id: pagoActual.cuenta_id,
      estado_validacion: 'APROBADO',
      id: { not: pagoActual.id }, // Evitamos contar el pago que estamos procesando ahora
    },
    _sum: { monto_pagado: true },
  });

  const totalPrevio = Number(pagosAnteriores._sum.monto_pagado || 0);
  const totalConEstePago = totalPrevio + Number(pagoActual.monto_pagado);
  const deudaTotal = Number(pagoActual.cuentas_por_cobrar.monto_final);

  // El saldo real que queda después de esta aprobación
  const saldoRestante = Math.max(0, deudaTotal - totalConEstePago);

  // Solo marcamos como completo si el saldo es prácticamente 0 (margen de 1 céntimo)
  const esPagoCompleto = saldoRestante <= 0.01;

  return { saldoRestante, esPagoCompleto };
};

/**
 * Define los nuevos estados de la Deuda e Inscripción.
 * REGLA: El alumno SOLO se activa si la deuda está pagada al 100%.
 */
export const definirEvolucionDeEstados = async (tx, pago, esAprobado, esPagoCompleto) => {
  if (!esAprobado) {
    // Si el admin rechaza el pago, verificamos si ya tenía abonos previos aprobados
    const aprobados = await tx.pagos.count({
      where: { cuenta_id: pago.cuenta_id, estado_validacion: 'APROBADO' },
    });

    return {
      nuevoEstadoDeuda: aprobados > 0 ? 'PARCIAL' : 'RECHAZADO',
      activarAlumno: false // Si se rechaza un pago, no hay activación de nada
    };
  }

  // SI SE APRUEBA EL PAGO:
  return {
    // La deuda pasa a PAGADA solo si esPagoCompleto es true, sino se queda/pasa a PARCIAL
    nuevoEstadoDeuda: esPagoCompleto ? 'PAGADA' : 'PARCIAL',

    // CAMBIO CRÍTICO: El alumno SOLO se activa si terminó de pagar todo.
    // Si solo abonó una parte, sus inscripciones siguen en espera.
    activarAlumno: esAprobado
  };
};