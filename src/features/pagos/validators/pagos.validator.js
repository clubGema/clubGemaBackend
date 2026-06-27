/**
 * Valida que la deuda exista y sea apta para recibir pagos.
 */
export const validarDeudaParaPago = async (tx, deudaId) => {
  const deuda = await tx.cuentas_por_cobrar.findUnique({
    where: { id: Number.parseInt(deudaId) },
  });

  if (!deuda) throw new Error('La deuda indicada no existe.');
  if (deuda.estado === 'PAGADA') throw new Error('Esta deuda ya fue pagada completamente.');

  return deuda;
};
/**
 * Busca un pago y verifica que esté pendiente de validación.
 */
export const buscarYValidarPagoPendiente = async (tx, pagoId) => {
  const pago = await tx.pagos.findUnique({
    where: { id: Number.parseInt(pagoId) },
    include: { cuentas_por_cobrar: true },
  });

  if (!pago) throw new Error('El pago ID indicado no existe.');
  if (pago.estado_validacion !== 'PENDIENTE') {
    throw new Error('Este pago ya fue validado anteriormente.');
  }

  return pago;
};


