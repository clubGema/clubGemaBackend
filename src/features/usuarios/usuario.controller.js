import { usuarioService } from './usuario.service.js';
import { apiResponse } from '../../shared/utils/response.util.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';
import { validateRoleSpecificData } from './validators/usuario.validator.js';

export const usuarioController = {
  register: catchAsync(async (req, res) => {
    const usuario = await usuarioService.createUser(req.body);

    return apiResponse.created(res, {
      message:
        '¡Inscripción exitosa! Los detalles de tu cuenta han sido enviados a tu correo electrónico.',
      data: usuario,
    });
  }),

  getUserProfile: catchAsync(async (req, res) => {
    const usuario = await usuarioService.getUserById(req.params.id);

    return apiResponse.success(res, {
      data: usuario,
    });
  }),

  validateRole: catchAsync(async (req, res) => {
    const { rol_id, datosRolEspecifico } = req.body;

    const validationResult = validateRoleSpecificData(
      typeof rol_id === 'string' ? rol_id : '',
      datosRolEspecifico || {}
    );

    return apiResponse.success(res, {
      data: {
        rol: rol_id,
        valido: validationResult.valid,
        mensajes:
          validationResult.errors.length > 0 ? validationResult.errors : ['Rol y datos válidos'],
      },
    });
  }),

  getUsersByRol: catchAsync(async (req, res) => {
    const { sede_id } = req.query;
    const usuarios = await usuarioService.getUsersByRol(req.params.rol, sede_id);

    return apiResponse.success(res, {
      message: `Usuarios con rol ${req.params.rol} obtenidos exitosamente`,
      data: usuarios,
    });
  }),

  updateStudentProfile: catchAsync(async (req, res) => {
    const usuarioActualizado = await usuarioService.updateStudentProfile(req.params.id, req.body);

    return apiResponse.success(res, {
      message: 'Perfil del estudiante actualizado exitosamente',
      data: usuarioActualizado,
    });
  }),

  getUsuariosStats: catchAsync(async (req, res) => {
    const stats = await usuarioService.getDashboardStats();

    return apiResponse.success(res, {
      message: 'Estadísticas de usuarios obtenidas exitosamente',
      data: stats,
    });
  }),

  getDetailedReport: catchAsync(async (req, res) => {
    const reportData = await usuarioService.getDetailedExcelReport();
    return apiResponse.success(res, {
      message: 'Reporte generado',
      data: reportData,
    });
  }),

  getUserByDni: catchAsync(async (req, res) => {
    const { dni } = req.params;
    const usuario = await usuarioService.getUserByDni(dni);

    // Si no existe, devolvemos success pero con data en null
    return apiResponse.success(res, {
      message: usuario ? 'Usuario encontrado' : 'Usuario no existe',
      data: usuario || null, 
    });
  }),
};
