import { Router } from 'express';
import { CuentasPorCobrarController } from './cuentas_por_cobrar.controller.js';

const router = Router();

router.post('/', CuentasPorCobrarController.crear);
router.get('/', CuentasPorCobrarController.listar);
router.get('/:id', CuentasPorCobrarController.obtenerUno);
router.put('/:id', CuentasPorCobrarController.actualizar);
router.delete('/:id', CuentasPorCobrarController.eliminar);
// GET /api/cuentas/historial/16 -> Trae todo lo del alumno con ID 16
router.get('/historial/:alumnoId', CuentasPorCobrarController.obtenerHistorialAlumno);
// 1. Ruta para que el Front consulte la fecha sugerida (Cerebro)
router.get('/renovacion-sugerida/:grupoUuid', CuentasPorCobrarController.previsualizarFechaRenovacion);

// 2. Ruta para ejecutar la renovación de todo el paquete
router.post('/generar-adelantado/:grupoUuid', CuentasPorCobrarController.generarAdelantado);
export default router;