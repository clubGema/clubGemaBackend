import { Router } from 'express';
import { historialAcademicoController } from './historial_academico.controller.js';

const router = Router();

// GET /api/historial-academico/alumno/:alumnoId
router.get('/alumno/:alumnoId', historialAcademicoController.getHistorialPorAlumno);

export default router;