import { Router } from 'express';
import { inscripcionController } from './inscripcion.controller.js';

const router = Router();

// POST http://localhost:3000/api/inscripciones
// ⚠️ CAMBIO AQUÍ: 'crearInscripcion' -> 'inscribir'
router.post('/', inscripcionController.inscribir);

// GET http://localhost:3000/api/inscripciones
router.get('/', inscripcionController.listarInscripciones);

// PATCH: Finalización voluntaria de la inscripción por el alumno
router.patch('/:id/finalizar', inscripcionController.finalizarVoluntaria);

// GET: Listado por alumno (CORREGIDO el nombre del controlador)
router.get('/alumno/:alumnoId', inscripcionController.listarPorAlumno); //

// GET: Detalle de una sola inscripción
router.get('/:id', inscripcionController.obtenerDetalle);

// DELETE: Cancelar inscripción
router.delete('/:id', inscripcionController.eliminar);

router.patch(
  '/:id/cancelar-reserva',
  inscripcionController.cancelarReserva
);

router.get('/alumno-no-finalizadas/:alumnoId', inscripcionController.listarNoFinalizadasPorAlumno);

router.put(
  '/horario-inscripcion',
  inscripcionController.updateInscripcion
)

export default router;