import { setAuthCookies, clearAuthCookies, isSafariUserAgent } from '../../config/cookie.config.js';
import { authService } from './auth.service.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';
import { apiResponse } from '../../shared/utils/response.util.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { logger } from '../../shared/utils/logger.util.js';

/**
 * Extrae y valida el refresh token desde cookie o body para fallback cross-site.
 */
const getRefreshTokenFromRequest = (req) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    throw new ApiError('Refresh token es requerido o inválido', 401);
  }
  return refreshToken;
};

const buildAuthResponseData = (req, result) => {
  if (isSafariUserAgent(req.headers['user-agent'])) {
    return result;
  }

  return { user: result.user };
};

export const authController = {
  login: catchAsync(async (req, res) => {
    const { username, password } = req.body;
    const result = await authService.login({ username, password });

    setAuthCookies(res, result, req.headers['user-agent']);
    logger.info(`Usuario '${username}' inició sesión desde la IP: ${req.ip}`);

    return apiResponse.success(res, {
      message: 'Login exitoso',
      data: buildAuthResponseData(req, result),
    });
  }),

  getProfile: catchAsync(async (req, res) => {
    const profile = await authService.getProfile(req.user.id);
    return apiResponse.success(res, {
      message: 'Perfil obtenido exitosamente',
      data: profile,
    });
  }),

  refresh: catchAsync(async (req, res) => {
    const refreshToken = getRefreshTokenFromRequest(req);
    const result = await authService.refreshAccessToken(refreshToken);

    setAuthCookies(res, result, req.headers['user-agent']);

    return apiResponse.success(res, {
      message: 'Access token renovado',
      data: buildAuthResponseData(req, result),
    });
  }),

  logout: catchAsync(async (req, res) => {
    const refreshToken = getRefreshTokenFromRequest(req);
    await authService.logout(refreshToken);

    clearAuthCookies(res, req.headers['user-agent']);
    logger.info(`Sesión cerrada desde IP: ${req.ip}`);

    return apiResponse.success(res, {
      message: 'Sesión cerrada exitosamente',
    });
  }),

  revokeAllSessions: catchAsync(async (req, res) => {
    await authService.revokeAllTokens(req.user.id);

    clearAuthCookies(res, req.headers['user-agent']);
    logger.info(`Usuario ID '${req.user.id}' ha revocado globalmente todas sus sesiones.`);

    return apiResponse.success(res, {
      message: 'Todas las sesiones cerradas exitosamente',
    });
  }),

  completarEmail: catchAsync(async (req, res) => {
    const { email } = req.body;
    const usuarioActualizado = await authService.actualizarEmailPrimerLogin(req.user.id, email);

    return apiResponse.success(res, {
      message: 'Email actualizado correctamente',
      data: { user: usuarioActualizado },
    });
  }),

  forgotPassword: catchAsync(async (req, res) => {
    const { username } = req.body;
    await authService.forgotPassword(username);

    logger.info(`Solicitud temporal de reseteo de clave generada para username: '${username}'`);

    return apiResponse.success(res, {
      message: 'Enlace enviado al correo registrado del usuario',
    });
  }),

  resetPassword: catchAsync(async (req, res) => {
    const { token, newPassword } = req.body;
    await authService.resetPassword(token, newPassword);

    logger.info(`Contraseña actualizada exitosamente vía token de recuperación.`);

    return apiResponse.success(res, { message: 'Contraseña actualizada con éxito' });
  }),

  resetPasswordByAdmin: catchAsync(async (req, res) => {
    const { userId, newPassword } = req.body;
    await authService.resetPasswordByAdmin(userId, newPassword);

    logger.info(`Contraseña del usuario con ID ${userId} actualizada correctamente.`)

    return apiResponse.success(res, { message: 'Contraseña actualizada con éxito' })
  }),

  changePassword: catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user.id, currentPassword, newPassword);

    logger.info(`Usuario ID '${req.user.id}' actualizó su contraseña.`);

    return apiResponse.success(res, { message: 'Contraseña actualizada correctamente' });
  }),

  updateProfile: catchAsync(async (req, res) => {
    const updatedUser = await authService.updateProfile(req.user.id, req.body);
    logger.info(`Usuario ID '${req.user.id}' actualizó sus datos de perfil.`);
    return apiResponse.success(res, {
      message: 'Perfil actualizado exitosamente',
      data: updatedUser,
    });
  }),
};
