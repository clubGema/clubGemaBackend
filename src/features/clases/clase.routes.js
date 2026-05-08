import { Router } from 'express';
import { claseController } from './clase.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';
import { validate, validateParams } from '../../shared/middlewares/validate.middleware.js';
import { claseSchema } from './clase.schema.js';

const router = Router();

router.use(authenticate);

// Listar horarios que tienen asistencias (para filtro de reprogramación masiva)
router.get(
  '/horarios-con-asistencia',
  authorize('Administrador', 'Coordinador'),
  claseController.obtenerHorariosConAsistencia
);

// Solo administradores pueden reprogramar masivamente
router.post(
  '/reprogramar-masivo',
  authorize('Administrador'),
  validate(claseSchema.reprogramarMasivoSchema),
  claseController.reprogramarMasivo
);

// Revertir una reprogramación masiva
router.post(
  '/revertir-masivo',
  authorize('Administrador'),
  validate(claseSchema.revertirMasivoSchema),
  claseController.revertirMasivo
);

// Obtener lista de reprogramaciones masivas
router.get(
  '/reprogramaciones-masivas-activas',
  authorize('Administrador'),
  claseController.obtenerMasivasActivas
);

// Obtener fechas disponibles (registros_asistencia activos) de un horario específico
router.get(
  '/:horario_id/fechas-disponibles',
  authorize('Administrador', 'Coordinador'),
  validateParams(claseSchema.horarioIdParamSchema),
  claseController.obtenerFechasDisponibles
);

// Obtener detalle de un horario (alumnos inscritos, info general)
router.get(
  '/:horario_id/detalle',
  authorize('Administrador', 'Coordinador'),
  validateParams(claseSchema.horarioIdParamSchema),
  claseController.obtenerDetalle
);

router.get(
  '/:horario_id/fechas-pasadas',
  authorize('Administrador', 'Coordinador'),
  validateParams(claseSchema.horarioIdParamSchema), // Asumo que usas la misma validación del ID
  claseController.obtenerFechasPasadas
);

export default router;
