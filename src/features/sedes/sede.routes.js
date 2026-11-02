import { Router } from 'express';
import { sedeController } from './sede.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';
import {
  validate,
  validateParams,
  validateQuery,
} from '../../shared/middlewares/validate.middleware.js';
import { sedeSchema } from './sede.schema.js';

const router = Router();

router.get('/', validateQuery(sedeSchema.sedeQuerySchema), sedeController.getAllSedes);
router.get(
  '/canchas/conteo',
  validateQuery(sedeSchema.sedeQuerySchema),
  sedeController.getCanchaForSedeCount
);
router.get('/:id', validateParams(sedeSchema.sedeIdParamSchema), sedeController.getSedeById);

router.post(
  '/',
  authenticate,
  authorize('Administrador'),
  validate(sedeSchema.createSedeSchema),
  sedeController.createSede
);

router.put(
  '/:id',
  authenticate,
  authorize('Administrador'),
  validateParams(sedeSchema.sedeIdParamSchema),
  validate(sedeSchema.updateSedeSchema),
  sedeController.updateSede
);

router.patch(
  '/:id/desactivar',
  authenticate,
  authorize('Administrador'),
  validateParams(sedeSchema.sedeIdParamSchema),
  sedeController.updateDefuseSede
);

router.patch(
  '/:id/activar',
  authenticate,
  authorize('Administrador'),
  validateParams(sedeSchema.sedeIdParamSchema),
  sedeController.updateActiveSede
);

router.delete(
  '/:id',
  authenticate,
  authorize('Administrador'),
  validateParams(sedeSchema.sedeIdParamSchema),
  sedeController.deleteSede
);

router.get(
  '/dashboard/ocupacion', 
  authenticate, 
  authorize('Administrador'), 
  sedeController.getOcupacionDashboard
);

router.get(
  '/reporte-ocupacion',
  authenticate,
  authorize('Administrador', 'Coordinador'),
  sedeController.getReporteOcupacionDetallado
);

export default router;
