import express from 'express';
import {
  obtenerActivos,
  obtenerTodos,
  crear,
  actualizar,
  eliminar
} from './anunciosBeneficios.controller.js';

// 🛡️ IMPORTAMOS AMBOS: El que verifica que estés logueado y el que verifica tu rol
import { authenticate } from '../../shared/middlewares/auth.middleware.js'; 
import { authorize } from '../../shared/middlewares/authorize.middleware.js'; 

const router = express.Router();

// ======================================================
// 🔒 RUTAS PROTEGIDAS (Obligatorio estar logueado)
// ======================================================
router.use(authenticate); // 👈 ¡ESTA ES LA PIEZA QUE FALTABA!


// 🟢 Para Alumnos, Admins y Coordinadores: Ver los beneficios del carrusel
router.get('/activos', authorize('Alumno', 'Administrador', 'Coordinador'), obtenerActivos);

// 🔴 Solo para el Administrador: Gestión total (CRUD)
router.get('/', authorize('Administrador'), obtenerTodos);
router.post('/', authorize('Administrador'), crear);
router.patch('/:id', authorize('Administrador'), actualizar);
router.delete('/:id', authorize('Administrador'), eliminar);

export default router;