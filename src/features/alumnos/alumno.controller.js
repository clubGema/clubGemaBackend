import { alumnoService } from './alumno.service.js';
import { apiResponse } from '../../shared/utils/response.util.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';

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
    // Extraemos el ID y el Rol del token de sesión
    const { id: usuarioId, role } = req.user; 
    
    let data;

    if (role === 'Administrador') {
        // Si es Admin, llama al service global (sin filtro de ID)
        data = await alumnoService.listarAlumnosResumen();
    } else {
        // Si es Coordinador, pasamos su ID para filtrar sus alumnos
        data = await alumnoService.listarAlumnosResumenPorCoordinador(usuarioId);
    }

    return apiResponse.success(res, {
        message: 'Resumen de cortes para gestión de alumnos cargado con éxito',
        data: data,
    });
}),
};
