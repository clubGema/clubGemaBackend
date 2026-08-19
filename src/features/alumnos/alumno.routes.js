import { Router } from 'express';
import { alumnoController } from './alumno.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';
import { validate } from '../../shared/middlewares/validate.middleware.js';
import {
  actualizarPerfilSchema,
  crearContactoSchema,
  actualizarContactoSchema,
} from './alumno.schema.js';

const router = Router();

router.use(authenticate);

router.get('/mi-perfil/contactos', alumnoController.listarMisContactos);

router.post(
  '/mi-perfil/contactos',
  validate(crearContactoSchema),
  alumnoController.crearContacto
);

router.patch(
  '/mi-perfil/contactos/:contactoId',
  validate(actualizarContactoSchema),
  alumnoController.actualizarContacto
);

router.delete(
  '/mi-perfil/contactos/:contactoId',
  alumnoController.eliminarContacto
);

router.get('/mi-perfil', alumnoController.obtenerMiPerfil);
// PATCH /api/alumno/mi-perfil
router.patch('/mi-perfil', validate(actualizarPerfilSchema), alumnoController.actualizarMiPerfil);

router.get(
    '/gestion/resumen-cortes',
    authorize('Administrador', 'Coordinador'),
    alumnoController.listarAlumnosResumen
);

router.get(
    '/gestion/cortes-alumnos',
    authorize('Administrador', 'Coordinador'),
    alumnoController.listarAlumnosResumenPorCoordinador
);

router.post(
    '/gestion/cambiar-historial',
    authorize('Administrador'),
    alumnoController.cambiarHistorialAlumno
)

export default router;