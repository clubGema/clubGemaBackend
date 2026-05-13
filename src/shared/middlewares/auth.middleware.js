import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../config/secret.config.js';
import { prisma } from '../../config/database.config.js';
import { apiResponse } from '../utils/response.util.js';

const getAccessTokenFromRequest = (req) => {
  const cookieToken = req.cookies?.accessToken;
  if (cookieToken) return cookieToken;

  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;

  const bearerToken = authorization.slice('Bearer '.length).trim();
  return bearerToken.length > 0 ? bearerToken : null;
};

export const authenticate = async (req, res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);

    if (!token) {
      return apiResponse.error(res, 'No se proporcionó token de autenticación', 401);
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const usuario = await prisma.usuarios.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        activo: true,
        credenciales_usuario: {
          select: { bloqueado: true },
        },
        roles: {
          select: { id: true, nombre: true },
        },
      },
    });

    if (!usuario) {
      return apiResponse.error(res, 'Usuario no encontrado', 401);
    }

    if (!usuario.activo) {
      return apiResponse.error(res, 'Usuario inactivo', 401);
    }

    if (usuario.credenciales_usuario?.bloqueado) {
      return apiResponse.error(res, 'Cuenta bloqueada. Contacta al administrador.', 403);
    }

    req.user = {
      id: usuario.id,
      email: usuario.email,
      rol_id: usuario.roles.id,
      rol_nombre: usuario.roles.nombre,
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return apiResponse.error(res, 'Token inválido', 401);
    }

    if (error.name === 'TokenExpiredError') {
      return apiResponse.error(res, 'Token expirado', 401);
    }

    return apiResponse.error(res, 'Error al verificar token', 500);
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const usuario = await prisma.usuarios.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        activo: true,
        credenciales_usuario: {
          select: { bloqueado: true },
        },
        roles: {
          select: { id: true, nombre: true },
        },
      },
    });

    if (usuario && usuario.activo && !usuario.credenciales_usuario?.bloqueado) {
      req.user = {
        id: decoded.id,
        email: decoded.email,
        rol_id: decoded.rol_id,
        rol_nombre: usuario.roles.nombre,
      };
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    req.user = error || null;
    next();
  }
};
