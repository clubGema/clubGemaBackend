import { NODE_ENV, REFRESH_TOKEN_EXPIRATION_DAYS, JWT_EXPIRES_IN, COOKIE_CROSS_SITE } from './secret.config.js';
import ms from 'ms';

const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const getJwtExpiresInMs = () => {
  const expires = JWT_EXPIRES_IN || '15m';
  return ms(expires) || 15 * ONE_MINUTE;
};

export const ACCESS_TOKEN_MAX_AGE = getJwtExpiresInMs();
export const REFRESH_TOKEN_MAX_AGE = REFRESH_TOKEN_EXPIRATION_DAYS * ONE_DAY;

export const getCookieOptions = () => {
  const isProd = NODE_ENV === 'production';
  const isCrossSite = isProd && COOKIE_CROSS_SITE;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isCrossSite ? 'none' : 'lax',
    ...(isCrossSite ? { partitioned: true } : {}),
    path: '/',
  };
};

export const getAccessTokenCookieOptions = () => ({
  ...getCookieOptions(),
  maxAge: ACCESS_TOKEN_MAX_AGE,
});

export const getRefreshTokenCookieOptions = () => ({
  ...getCookieOptions(),
  maxAge: REFRESH_TOKEN_MAX_AGE,
});

export const setAuthCookies = (res, { accessToken, refreshToken }) => {
  res.cookie('accessToken', accessToken, getAccessTokenCookieOptions());
  res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());
};

export const clearAuthCookies = (res) => {
  const options = getCookieOptions();
  res.clearCookie('accessToken', { ...options });
  res.clearCookie('refreshToken', { ...options });
};
