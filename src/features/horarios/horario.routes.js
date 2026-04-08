import { Router } from 'express';
import { horarioController } from './horario.controller.js';
import { validate, validateParams } from '../../shared/middlewares/validate.middleware.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';
import { horarioSchema } from './horario.schema.js';

const router = Router();

// Ruta pública — listar horarios disponibles
router.get('/', horarioController.getHorarios);

// Rutas protegidas — solo Administrador y Coordinador
router.post(
  '/',
  authenticate,
  authorize('Administrador', 'Coordinador'),
  validate(horarioSchema.createHorarioSchema),
  horarioController.createHorario
);

router.put(
  '/:id',
  authenticate,
  authorize('Administrador', 'Coordinador'),
  validateParams(horarioSchema.idParamSchema),
  validate(horarioSchema.updateHorarioSchema),
  horarioController.updateHorario
);

router.delete(
  '/:id',
  authenticate,
  authorize('Administrador'),
  validateParams(horarioSchema.idParamSchema),
  horarioController.deleteHorario
);

router.get(
  '/sede/:sedeId',
  authenticate,
  authorize('Administrador'),
  horarioController.getHorariosBySede
)

export default router;
