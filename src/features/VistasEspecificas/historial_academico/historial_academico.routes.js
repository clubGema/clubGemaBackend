import { Router } from 'express';
import { historialAcademicoController } from './historial_academico.controller.js';

const router = Router();

// GET /api/historial-academico/resumen-tabla?sede_id=...
router.get('/resumen-tabla', historialAcademicoController.getResumenTablaAlumnos);

// GET /api/historial-academico/resumen-individual?sede_id=...
router.get('/resumen-individual', historialAcademicoController.getFlagsIndividualPorSede);

// GET /api/historial-academico/alumno/:alumnoId
router.get('/alumno/:alumnoId', historialAcademicoController.getHistorialPorAlumno);

export default router;