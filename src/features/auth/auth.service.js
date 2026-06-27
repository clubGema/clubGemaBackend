import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { tokenUtils } from './utils/token.util.js';
import { prisma } from '../../config/database.config.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { JWT_SECRET } from '../../config/secret.config.js';
import { emailService } from '../../shared/services/brevo.email.service.js';
import { authLogic } from './logic/auth.logic.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export const authService = {
  /**
   * Autentica a un usuario verificando sus credenciales y genera tokens de acceso.
   * @param {Object} loginData - Datos de inicio de sesión.
   * @param {string} loginData.username - Nombre de usuario.
   * @param {string} loginData.password - Contraseña en texto plano.
   * @returns {Promise<{accessToken: string, refreshToken: string, user: Object}>} Tokens y datos básicos del usuario.
   * @throws {ApiError} 401 si las credenciales son inválidas, 403 si el usuario está inactivo, bloqueado o sin credenciales.
   */
  login: async (loginData) => {
    const { username, password } = loginData;

    const usuario = await prisma.usuarios.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        email: true,
        nombres: true,
        apellidos: true,
        activo: true,
        rol_id: true,
        credenciales_usuario: {
          select: { hash_contrasena: true, bloqueado: true },
        },
        roles: { select: { nombre: true } },
        alumnos: { select: { usuario_id: true } },
      },
    });

    if (!usuario) {
      throw new ApiError('Credenciales inválidas', 401);
    }

    authLogic.validarEstadoUsuario(usuario);

    const passwordValida = await bcrypt.compare(
      password,
      usuario.credenciales_usuario.hash_contrasena
    );

    if (!passwordValida) {
      throw new ApiError('Credenciales inválidas', 401);
    }

    const { accessToken, refreshToken, expiresAt } = authLogic.generarSesionTokens(usuario);

    await Promise.all([
      prisma.credenciales_usuario.update({
        where: { usuario_id: usuario.id },
        data: { ultimo_login: new Date() },
      }),
      prisma.refresh_tokens.create({
        data: {
          usuario_id: usuario.id,
          token: tokenUtils.hashToken(refreshToken),
          expires_at: expiresAt,
        },
      }),
    ]);

    const esLoginNuevo = true;
    return {
      accessToken,
      refreshToken,
      user: authLogic.construirInformacionPerfilUsuario(usuario, esLoginNuevo),
    };
  },

  /**
   * Obtiene el perfil completo de un usuario con información específica de su rol (alumno, coordinador, admin).
   * @param {number} userId - ID del usuario.
   * @returns {Promise<Object>} Datos estructurados del perfil del usuario.
   * @throws {ApiError} 404 si el usuario no existe.
   */
  getProfile: async (userId) => {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nombres: true,
        apellidos: true,
        telefono_personal: true,
        fecha_nacimiento: true,
        genero: true,
        roles: { select: { nombre: true } },
        alumnos: {
          select: {
            condiciones_medicas: true,
            seguro_medico: true,
            grupo_sanguineo: true,
          },
        },
        coordinadores: {
          select: {
            especializacion: true,
            tarifa_hora: true,
          },
        },
        administrador: {
          select: {
            cargo: true,
            area: true,
            sedes: { select: { nombre: true } },
          },
        },
      },
    });

    if (!usuario) {
      throw new ApiError('Usuario no encontrado', 404);
    }

    const baseData = {
      id: usuario.id,
      email: usuario.email,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      telefono_personal: usuario.telefono_personal,
      fecha_nacimiento: usuario.fecha_nacimiento,
      genero: usuario.genero,
      rol: usuario.roles?.nombre,
    };

    if (usuario.alumnos) {
      baseData.alumno = {
        condiciones_medicas: usuario.alumnos.condiciones_medicas,
        seguro_medico: usuario.alumnos.seguro_medico,
        grupo_sanguineo: usuario.alumnos.grupo_sanguineo,
      };
    }

    if (usuario.coordinadores) {
      baseData.coordinador = {
        especializacion: usuario.coordinadores.especializacion,
        tarifa_hora: usuario.coordinadores.tarifa_hora,
      };
    }

    if (usuario.administrador) {
      baseData.administrador = {
        cargo: usuario.administrador.cargo,
        area: usuario.administrador.area,
        sede: usuario.administrador.sedes?.nombre,
      };
    }

    return baseData;
  },

  /**
   * Renueva el accessToken utilizando un refreshToken válido y rota los tokens por seguridad.
   * @param {string} refreshToken - Token de refresco actual enviado por el cliente.
   * @returns {Promise<{accessToken: string, refreshToken: string, user: Object}>} Nuevos tokens y datos básicos del usuario.
   * @throws {ApiError} 401 si el token es inválido o expiró, 403 si el usuario/token está revocado, inactivo o bloqueado.
   */
  refreshAccessToken: async (refreshToken) => {
    const tokenRecord = await prisma.refresh_tokens.findUnique({
      where: { token: tokenUtils.hashToken(refreshToken) },
      select: {
        token: true,
        revoked: true,
        expires_at: true,
        usuario_id: true,
        usuarios: {
          select: {
            id: true,
            username: true,
            email: true,
            nombres: true,
            apellidos: true,
            activo: true,
            rol_id: true,
            roles: { select: { nombre: true } },
            credenciales_usuario: { select: { bloqueado: true } },
          },
        },
      },
    });

    if (!tokenRecord) {
      throw new ApiError('Refresh token inválido', 401);
    }

    if (tokenRecord.revoked) {
      await prisma.refresh_tokens.updateMany({
        where: { usuario_id: tokenRecord.usuario_id },
        data: { revoked: true },
      });
      throw new ApiError('Intento de reuso de sesión detectado. Sesiones revocadas.', 403);
    }

    if (tokenUtils.isTokenExpired(tokenRecord.expires_at)) {
      throw new ApiError('Refresh token expirado', 401);
    }

    const { usuarios: usuario } = tokenRecord;

    authLogic.validarEstadoUsuario(usuario);

    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
    } = authLogic.generarSesionTokens(usuario);

    await prisma.$transaction([
      prisma.refresh_tokens.update({
        where: { token: tokenUtils.hashToken(refreshToken) },
        data: { revoked: true },
      }),
      prisma.refresh_tokens.create({
        data: {
          usuario_id: usuario.id,
          token: tokenUtils.hashToken(newRefreshToken),
          expires_at: expiresAt,
        },
      }),
    ]);

    const esLoginNuevo = false;
    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: authLogic.construirInformacionPerfilUsuario(usuario, esLoginNuevo),
    };
  },

  /**
   * Cierra la sesión activa de un usuario invalidando su refreshToken actual.
   * @param {string} refreshToken - Token de refresco de la sesión a cerrar.
   * @returns {Promise<{message: string}>} Mensaje de éxito.
   * @throws {ApiError} 404 si el token no se encuentra en la base de datos.
   */
  logout: async (refreshToken) => {
    try {
      await prisma.refresh_tokens.update({
        where: { token: tokenUtils.hashToken(refreshToken) },
        data: { revoked: true },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new ApiError('Refresh token no encontrado', 404);
      }
      throw error;
    }

    return { message: 'Sesión cerrada exitosamente' };
  },

  /**
   * Invalida de forma masiva todas las sesiones (refresh tokens activos) de un usuario.
   * @param {number} userId - ID del usuario a desconectar en todos sus dispositivos.
   * @returns {Promise<{message: string}>} Mensaje de éxito.
   */
  revokeAllTokens: async (userId) => {
    await prisma.refresh_tokens.updateMany({
      where: {
        usuario_id: userId,
        revoked: false,
      },
      data: { revoked: true },
    });

    return { message: 'Todas las sesiones han sido cerradas' };
  },

  /**
   * Actualiza el correo electrónico de un usuario, generalmente requerido en el primer inicio de sesión
   * para cuentas creadas de forma masiva sin e-mail.
   * @param {number} usuarioId - ID del usuario.
   * @param {string} nuevoEmail - Nuevo correo electrónico a asociar.
   * @returns {Promise<Object>} Datos básicos del usuario con su e-mail actualizado.
   */
  actualizarEmailPrimerLogin: async (usuarioId, nuevoEmail) => {
    const usuario = await prisma.usuarios.update({
      where: { id: usuarioId },
      data: { email: nuevoEmail },
      select: {
        id: true,
        username: true,
        email: true,
        nombres: true,
        apellidos: true,
      },
    });

    return usuario;
  },

  /**
   * Inicia el flujo de recuperación de contraseña generando un token temporal.
   * @param {string} username - Nombre de usuario que solicita recuperar la contraseña.
   * @returns {Promise<void>}
   * @throws {ApiError} 404 si el usuario no existe o no tiene correo electrónico asociado.
   */
  forgotPassword: async (username) => {
    const user = await prisma.usuarios.findUnique({
      where: { username },
      select: { id: true, email: true, nombres: true },
    });

    if (!user?.email) {
      throw new ApiError('Usuario no encontrado o no tiene correo asociado', 404);
    }

    const resetToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });

    const emailSent = await emailService.sendPasswordRecoveryEmail(
      user.email,
      user.nombres,
      resetToken
    );

    if (!emailSent) {
      throw new ApiError('No se pudo enviar el correo de recuperación. Intente más tarde.', 500);
    }
  },

  /**
   * Finaliza el flujo de recuperación validando el token temporal y estableciendo la nueva contraseña segura.
   * Esta función también desbloquea la cuenta del usuario si previamente estaba bloqueada.
   * @param {string} token - Token JWT temporal recibido en el enlace de recuperación (enviado por email).
   * @param {string} newPassword - Nueva contraseña en texto plano provista por el usuario.
   * @returns {Promise<void>}
   * @throws {ApiError} 400 si el token de recuperación es inválido, manipulado o ya expiró.
   */
  resetPassword: async (token, newPassword) => {
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      throw new ApiError('El enlace es inválido o ha expirado', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    try {
      await prisma.credenciales_usuario.update({
        where: { usuario_id: decoded.id },
        data: {
          hash_contrasena: hashedPassword,
          bloqueado: false,
        },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new ApiError('El usuario ya no existe', 404);
      }
      throw error;
    }
  },

  resetPasswordByAdmin: async (userId, newPassword) => {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    try {
      await prisma.credenciales_usuario.update({
        where: { usuario_id: Number(userId) },
        data: { hash_contrasena: hashedPassword },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError) {
        throw new ApiError(e.message, 400, { prismaCode: e.code, meta: e.meta })
      };
      throw new ApiError(e instanceof Error ? e.message : 'Error interno', 500);
    };
  },

  /**
   * Cambia la contraseña de un usuario autenticado prevalidando su contraseña actual.
   * @param {number} userId - ID del usuario autenticado.
   * @param {string} currentPassword - Contraseña actual sin encriptar.
   * @param {string} newPassword - Nueva contraseña sin encriptar.
   * @throws {ApiError} 401 si la contraseña actual es incorrecta.
   */
  changePassword: async (userId, currentPassword, newPassword) => {
    const credenciales = await prisma.credenciales_usuario.findUnique({
      where: { usuario_id: userId },
      select: { hash_contrasena: true }
    });

    if (!credenciales) {
      throw new ApiError('Credenciales no encontradas', 404);
    }

    const passwordValida = await bcrypt.compare(currentPassword, credenciales.hash_contrasena);
    if (!passwordValida) {
      throw new ApiError('La contraseña actual es incorrecta', 401);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.credenciales_usuario.update({
      where: { usuario_id: userId },
      data: { hash_contrasena: hashedPassword }
    });
  },

  /**
   * Actualiza el perfil de un usuario autenticado (datos generales y específicos del rol)
   * @param {number} userId - ID del usuario.
   * @param {Object} payload - Objeto con los datos a actualizar
   */
  updateProfile: async (userId, payload) => {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: userId },
      select: { id: true, rol_id: true },
    });

    if (!usuario) {
      throw new ApiError('Usuario no encontrado', 404);
    }

    await Promise.all([
      authService._updateBaseUser(userId, payload),
      authService._updateRoleSpecificData(userId, usuario.rol_id, payload),
    ]);

    return await authService.getProfile(userId);
  },

  /** @private */
  _updateBaseUser: async (userId, payload) => {
    const { email, telefono_personal, nombres, apellidos, genero } = payload;
    const userUpdates = {};

    if (email !== undefined) userUpdates.email = email === '' ? null : email;
    if (telefono_personal !== undefined) userUpdates.telefono_personal = telefono_personal;
    if (nombres !== undefined) userUpdates.nombres = nombres;
    if (apellidos !== undefined) userUpdates.apellidos = apellidos;
    if (genero !== undefined) userUpdates.genero = genero;

    if (Object.keys(userUpdates).length > 0) {
      await prisma.usuarios.update({
        where: { id: userId },
        data: userUpdates,
      });
    }
  },

  /** @private */
  _updateRoleSpecificData: async (userId, rolId, payload) => {
    // Alumno = 1, Profesor = 2, Coordinador = 3
    if (rolId === 1) {
      const { condiciones_medicas, seguro_medico, grupo_sanguineo } = payload;
      const alumnoUpdates = {};
      if (condiciones_medicas !== undefined) alumnoUpdates.condiciones_medicas = condiciones_medicas;
      if (seguro_medico !== undefined) alumnoUpdates.seguro_medico = seguro_medico;
      if (grupo_sanguineo !== undefined) alumnoUpdates.grupo_sanguineo = grupo_sanguineo;

      if (Object.keys(alumnoUpdates).length > 0) {
        await prisma.alumnos.updateMany({ where: { usuario_id: userId }, data: alumnoUpdates });
      }
    } else if (rolId === 2 || rolId === 3) {
      const { especializacion } = payload;
      if (especializacion !== undefined) {
        await prisma.coordinadores.updateMany({
          where: { usuario_id: userId },
          data: { especializacion },
        });
      }
    }
  },
};
