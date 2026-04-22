import { Router } from 'express';
import { recuperacionController } from './recuperacion.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';

const router = Router();

router.use(authenticate);

router.get(
    '/', 
    authorize('Administrador'), 
    recuperacionController.listarTodas
);

// GET /api/recuperaciones/pendientes
router.get(
    '/pendientes',
    authorize('Alumno'),
    recuperacionController.obtenerPendientes
);

// POST /api/recuperaciones/validar-elegibilidad
router.post(
    '/validar-elegibilidad',
    authorize('Alumno', 'Administrador'),
    recuperacionController.validarElegibilidad
);

// POST /api/recuperaciones
router.post(
    '/agendar-recuperacion',
    authorize('Alumno', 'Administrador'),
    recuperacionController.agendarRecuperacion
);

// POST /api/recuperaciones/cancelar-recuperacion
router.post(
    '/cancelar-recuperacion/:recuperacionId',
    authorize('Alumno', 'Administrador'),
    recuperacionController.cancelarRecuperacion
);

// GET /api/recuperaciones/historial
router.get(
    '/historial',
    authorize('Alumno'),
    recuperacionController.obtenerHistorial
);

router.delete(
    '/:id', 
    authorize('Administrador'), 
    recuperacionController.eliminarRecuperacion
);

router.get(
    '/depuracion', 
    authorize('Administrador'), 
    recuperacionController.listarParaDepuracion
);

export default router;