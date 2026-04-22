import { Router } from 'express';
import { alumnoController } from './alumno.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';
import { validate } from '../../shared/middlewares/validate.middleware.js';
import { actualizarPerfilSchema } from './alumno.schema.js';

const router = Router();

router.use(authenticate);


router.get('/mi-perfil', alumnoController.obtenerMiPerfil);
// PATCH /api/alumno/mi-perfil
router.patch('/mi-perfil', validate(actualizarPerfilSchema), alumnoController.actualizarMiPerfil);

router.get(
    '/gestion/resumen-cortes', 
    authorize('Administrador', 'Coordinador'), 
    alumnoController.listarAlumnosResumen
);

router.get(
    '/gestion/cortes-alumnos', // 👈 Nuevo nombre de la ruta
    authorize('Administrador', 'Coordinador'), 
    alumnoController.listarAlumnosResumenPorCoordinador 
);

export default router;
