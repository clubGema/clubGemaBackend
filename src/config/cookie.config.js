import {
  NODE_ENV,
  REFRESH_TOKEN_EXPIRATION_DAYS,
  JWT_EXPIRES_IN,
  COOKIE_CROSS_SITE,
  COOKIE_PARTITIONED,
} from './secret.config.js';
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

const SAFARI_REGEX = /Safari/i;
const NON_SAFARI_REGEX = /Chrome|Chromium|Edg|OPR|CriOS|FxiOS/i;

export const isSafariUserAgent = (userAgent = '') =>
  SAFARI_REGEX.test(userAgent) && !NON_SAFARI_REGEX.test(userAgent);

export const getCookieOptions = (userAgent = '') => {
  const isProd = NODE_ENV === 'production';
  const isCrossSite = COOKIE_CROSS_SITE;
  const usePartitioned = isCrossSite && COOKIE_PARTITIONED && !isSafariUserAgent(userAgent);
  return {
    httpOnly: true,
    secure: isCrossSite ? true : isProd,
    sameSite: isCrossSite ? 'none' : 'lax',
    ...(usePartitioned ? { partitioned: true } : {}),
    path: '/',
  };
};

export const getAccessTokenCookieOptions = (userAgent = '') => ({
  ...getCookieOptions(userAgent),
  maxAge: ACCESS_TOKEN_MAX_AGE,
});

export const getRefreshTokenCookieOptions = (userAgent = '') => ({
  ...getCookieOptions(userAgent),
  maxAge: REFRESH_TOKEN_MAX_AGE,
});

export const setAuthCookies = (res, { accessToken, refreshToken }, userAgent = '') => {
  res.cookie('accessToken', accessToken, getAccessTokenCookieOptions(userAgent));
  res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions(userAgent));
};

export const clearAuthCookies = (res, userAgent = '') => {
  const options = getCookieOptions(userAgent);
  res.clearCookie('accessToken', { ...options });
  res.clearCookie('refreshToken', { ...options });
};
