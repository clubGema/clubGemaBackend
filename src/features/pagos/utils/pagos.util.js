export const validarInputPago = (data) => {
  const { deuda_id, monto } = data;
  if (!deuda_id || !monto) {
    throw new Error('Faltan datos obligatorios: deuda_id y monto.');
  }
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