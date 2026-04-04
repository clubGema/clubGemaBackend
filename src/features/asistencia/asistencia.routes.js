import { Router } from 'express';
import { asistenciaController } from './asistencia.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { authorize } from '../../shared/middlewares/authorize.middleware.js';
import {
  validate,
  validateParams,
  validateQuery,
} from '../../shared/middlewares/validate.middleware.js';
import { asistenciaSchema } from './asistencia.schema.js';

const router = Router();

// ======================================================
// 🔒 RUTAS PROTEGIDAS
// ======================================================
router.use(authenticate);


// ======================================================
// 📊 RUTAS DE ESTADÍSTICAS
// ======================================================
router.get(
  '/alumno/:alumnoId/estadisticas',
  authorize('Administrador', 'Coordinador', 'Alumno'),
  validateParams(asistenciaSchema.alumnoIdParamSchema),
  asistenciaController.obtenerEstadisticasAlumno
);
// Listado general de asistencias (Solo Admin/Coordinador)
router.get('/', authorize('Administrador', 'Coordinador'), asistenciaController.listarTodas);

// Buscar asistencias por ID de alumno (Admin, Coordinador, Alumno)
router.get(
  '/alumno/:alumnoId',
  authorize('Administrador', 'Coordinador', 'Alumno'),
  validateParams(asistenciaSchema.alumnoIdParamSchema),
  asistenciaController.listarPorAlumno
);

router.get(
  '/agenda/hoy',
  authorize('Coordinador'),
  validateQuery(asistenciaSchema.agendaQuerySchema),
  asistenciaController.listarClasesHoy
);

router.get(
  '/agenda',
  authorize('Coordinador'),
  validateQuery(asistenciaSchema.agendaQuerySchema),
  asistenciaController.listarAgenda
);

router.post(
  '/masiva',
  authorize('Coordinador'),
  validate(asistenciaSchema.masivaSchema),
  asistenciaController.marcarAsistenciaMasiva
);

router.post(
  '/previsualizar-fechas',
  authorize('Administrador', 'Coordinador', 'Alumno'),
  asistenciaController.previsualizarClasesFuturas
)

export default router;
