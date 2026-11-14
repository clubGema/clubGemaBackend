export const validarInputPago = (data) => {
  const { deuda_id, monto } = data;
  // monto 0 es válido (deuda de S/ 0 por descuento del 100%); se controla en
  // registrarPago que solo se acepte cuando la deuda también es 0.
  const montoNum = Number.parseFloat(monto);
  if (!deuda_id || monto === undefined || monto === null || monto === '' || Number.isNaN(montoNum)) {
    throw new Error('Faltan datos obligatorios: deuda_id y monto.');
  }
  if (montoNum < 0) throw new Error('El monto no puede ser negativo.');
};
export const generarMensajeResultado = (accion, esPagoCompleto, saldo) => {
  if (accion !== 'APROBAR') {
    return '⛔ PAGO RECHAZADO. Se le envío al alumno un aviso del estado de su pago.';
  }
  if (esPagoCompleto) {
    return '✅ Deuda SALDADA. Alumno ACTIVO y limpio.';
  }
  return `⚠️ Abono registrado. Saldo: S/ ${saldo.toFixed(2)}. Alumno ACTIVO (con deuda PARCIAL).`;
};