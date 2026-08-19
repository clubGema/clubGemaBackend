import { alumnoService } from './alumno.service.js';
import { apiResponse } from '../../shared/utils/response.util.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';
import { ApiError } from '../../shared/utils/error.util.js';

export const alumnoController = {
  actualizarMiPerfil: catchAsync(async (req, res) => {
    const resultado = await alumnoService.actualizarMiPerfil(req.user.id, req.body);
    return apiResponse.success(res, {
      message: '¡Perfil actualizado correctamente!',
      data: resultado,
    });
  }),
  obtenerMiPerfil: catchAsync(async (req, res) => {
    const perfil = await alumnoService.obtenerMiPerfil(req.user.id);
    return apiResponse.success(res, {
      message: 'Perfil cargado',
      data: perfil,
    });
  }),

  listarAlumnosResumen: catchAsync(async (req, res) => {
    const data = await alumnoService.listarAlumnosResumen();
    return apiResponse.success(res, {
      message: 'Lista de alumnos para gestión de cortes cargada',
      data: data,
    });
  }),
  listarAlumnosResumenPorCoordinador: catchAsync(async (req, res) => {
    const { id: usuarioId, role } = req.user;

    let data;

    if (role === 'Administrador') {
      data = await alumnoService.listarAlumnosResumen();
    } else {
      data = await alumnoService.listarAlumnosResumenPorCoordinador(usuarioId);
    }

    return apiResponse.success(res, {
      message: 'Resumen de cortes para gestión de alumnos cargado con éxito',
      data: data,
    });
  }),
  cambiarHistorialAlumno: catchAsync(async (req, res) => {
    const { estado, alumnoId } = req.body;
    await alumnoService.cambiarHistorialAlumno(alumnoId, estado);
    return apiResponse.success(res, { message: `Historial deportivo cambiado a ${estado}` })
  }),

  // 🔥 Contactos de emergencia — usan alumnoService (todo mergeado en un solo archivo)
  listarMisContactos: catchAsync(async (req, res) => {
    const data = await alumnoService.listarMisContactos(req.user.id);
    return apiResponse.success(res, {
      message: 'Contactos de emergencia cargados',
      data,
    });
  }),

  crearContacto: catchAsync(async (req, res) => {
    const data = await alumnoService.crearContacto(req.user.id, req.body);
    return apiResponse.success(res, {
      message: 'Contacto agregado correctamente',
      data,
    });
  }),

  actualizarContacto: catchAsync(async (req, res) => {
    const contactoId = Number(req.params.contactoId);
    if (Number.isNaN(contactoId)) throw new ApiError('ID de contacto inválido', 400);

    const data = await alumnoService.actualizarContacto(req.user.id, contactoId, req.body);
    return apiResponse.success(res, {
      message: 'Contacto actualizado correctamente',
      data,
    });
  }),

  eliminarContacto: catchAsync(async (req, res) => {
    const contactoId = Number(req.params.contactoId);
    if (Number.isNaN(contactoId)) throw new ApiError('ID de contacto inválido', 400);

    await alumnoService.eliminarContacto(req.user.id, contactoId);
    return apiResponse.success(res, { message: 'Contacto eliminado correctamente' });
  }),
};