import { Router } from 'express';
import multer from 'multer';
import { pagosController } from './pagos.controller.js';

const router = Router();

// Configuración de Multer para manejar archivos en memoria
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('¡Solo se permiten imágenes!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
});

// GET: Pagos de un alumno específico (Vista de Dashboard Estudiante)
// Esta es la ruta que acabamos de crear: http://localhost:3000/api/pagos/alumno/12
router.get('/alumno/:alumno_id', pagosController.obtenerPagosPorAlumno);

router.post(
  '/venta-express', 
  pagosController.registrarVentaExpress
);
// POST http://localhost:3000/api/pagos/reportar
// Ahora acepta tanto datos JSON como archivo de imagen
router.post('/reportar', upload.single('voucher'), pagosController.reportarPago);
router.post('/validar', pagosController.validarPagoAdmin);
// GET: Listar todos los pagos (Para la tabla de Admin)
router.get('/', pagosController.listarPagos);
// Ahora: Endpoint específico para la gestión administrativa
router.get('/gestion-admin', pagosController.listarPagosAdmin);

// GET: Ver detalle de un pago específico
router.get('/:id', pagosController.obtenerPago);

// DELETE: Borrar un registro (Cuidado: afecta auditoría)
router.delete('/:id', pagosController.eliminarPago);
// --- NUEVO ENDPOINT PARA EL MODAL (Búsqueda Profunda) ---
// Ponlo arriba para que no choque con el de /:id genérico
router.get('/detalle-maestro/:id', pagosController.obtenerDetalle);

export default router;
