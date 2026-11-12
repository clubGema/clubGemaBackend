import { Router } from 'express';
import { catalogoController } from './catalogo.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';
import { validate, validateParams } from '../../shared/middlewares/validate.middleware.js';
import { catalogoSchema } from './catalogo.schema.js';

const router = Router();

// Ruta pública para consultar planes vigentes para el landing/precios
router.get('/vigentes', catalogoController.getVigentes);

router.get('/legacy', catalogoController.getLegacy);

// Todas las rutas del catálogo requieren autenticación mínima
router.use(authenticate);

// Ruta para obtener todos los conceptos activos (Admin/Coordinador)
router.get('/', authorize('Administrador', 'Coordinador'), catalogoController.getAll);

// Ruta para obtener un solo concepto por su ID
router.get(
  '/:id',
  authorize('Administrador', 'Coordinador'),
  validateParams(catalogoSchema.idParamSchema),
  catalogoController.getById
);

// MÉTODOS MUTABLES (Solo Admin)
router.post(
  '/',
  authorize('Administrador'),
  validate(catalogoSchema.createSchema),
  catalogoController.create
);

router.put(
  '/:id',
  authorize('Administrador'),
  validateParams(catalogoSchema.idParamSchema),
  validate(catalogoSchema.updateSchema),
  catalogoController.update
);

router.delete(
  '/:id',
  authorize('Administrador'),
  validateParams(catalogoSchema.idParamSchema),
  catalogoController.delete
);

export default router;
