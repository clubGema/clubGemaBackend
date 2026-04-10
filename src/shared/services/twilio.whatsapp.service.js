import twilio from 'twilio';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} from '../../config/secret.config.js';
import { logger } from '../utils/logger.util.js';

const TWILIO_TIMEOUT_MS = 5000;

class TwilioProvider {
  constructor() {
    const missing = [];
    if (!TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
    if (!TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN');
    if (!TWILIO_PHONE_NUMBER) missing.push('TWILIO_PHONE_NUMBER');

    if (missing.length === 0) {
      this.client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, {
        timeout: TWILIO_TIMEOUT_MS,
      });
      this.isInitialized = true;
    } else {
      logger.warn(
        `[Twilio] Faltan variables requeridas (${missing.join(', ')}). El proveedor no se inicializo.`
      );
      this.isInitialized = false;
    }
  }

  /**
   * Valida si un numero telefonico tiene un formato aceptable.
   * @param {string} to
   * @param {boolean} [strict=true] true = solo celulares de Peru.
   */
  isValidFormat(to, strict = true) {
    const cleanTo = String(to ?? '').replace(/\D/g, '');

    if (!cleanTo) {
      logger.warn('[Twilio] Numero destino vacio o invalido.');
      return false;
    }

    let finalTo = cleanTo;

    if (cleanTo.startsWith('51') && cleanTo.length === 11) {
      finalTo = cleanTo.slice(2);
    }

    if (strict) {
      if (finalTo.length !== 9 || !finalTo.startsWith('9')) {
        logger.warn(`[Twilio] Numero detectado como invalido o no celular de Peru: ${to}`);
        return false;
      }
    } else if (cleanTo.length < 7) {
      logger.warn(`[Twilio] Numero demasiado corto para ser valido: ${to}`);
      return false;
    }

    return true;
  }

  formatNumber(to) {
    const cleanTo = String(to ?? '').replace(/\D/g, '');
    if (!cleanTo) return null;

    const finalTo = cleanTo.startsWith('51') ? cleanTo : `51${cleanTo}`;
    return `whatsapp:+${finalTo}`;
  }

  getTwilioSender() {
    const cleanFrom = String(TWILIO_PHONE_NUMBER ?? '').replace(/\D/g, '');

    if (!cleanFrom) {
      logger.error('[Twilio] TWILIO_PHONE_NUMBER no es valido o no esta configurado.');
      return null;
    }

    return `whatsapp:+${cleanFrom}`;
  }

  shouldRetry(error) {
    const status = Number(error?.status ?? error?.statusCode);

    if (!Number.isNaN(status)) {
      return status >= 500 || status === 429;
    }

    if (Number(error?.code) === 20429) return true;

    const message = String(error?.message ?? '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('econnreset') ||
      message.includes('socket hang up')
    );
  }

  /**
   * Envia un mensaje libre (sandbox o ventana de 24h).
   * @returns {Promise<{success: boolean, sid: string | null}>}
   */
  async sendWhatsAppMessage(to, message, maxRetries = 2) {
    if (!this.isInitialized) {
      logger.error('[Twilio] Intento de envio denegado: El cliente no esta configurado.');
      return { success: false, sid: null };
    }

    if (!this.isValidFormat(to)) {
      return { success: false, sid: null };
    }

    const formattedTo = this.formatNumber(to);
    const formattedFrom = this.getTwilioSender();

    if (!formattedTo || !formattedFrom) {
      return { success: false, sid: null };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create({
          body: message,
          from: formattedFrom,
          to: formattedTo,
        });

        logger.info(`[Twilio] Libre: WA enviado a ${formattedTo}. SID: ${response.sid}`);
        return { success: true, sid: response.sid };
      } catch (error) {
        const shouldRetry = attempt < maxRetries && this.shouldRetry(error);

        logger.warn(
          `[Twilio] Libre: Intento ${attempt} fallido al enviar a ${to}: ${error.message} (status: ${error?.status ?? 'N/A'})`
        );

        if (!shouldRetry) {
          const detalleReintento = attempt === maxRetries ? '' : ' (no reintentable)';
          logger.error(
            `[Twilio] Libre: Error definitivo al enviar a ${to} tras ${attempt} intentos${detalleReintento}.`
          );
          return { success: false, sid: null };
        }

        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    return { success: false, sid: null };
  }

  /**
   * Envia un mensaje de plantilla (Content API).
   * @returns {Promise<{success: boolean, sid: string | null}>}
   */
  async sendTemplateMessage(to, contentSid, variables = {}, maxRetries = 2) {
    if (!this.isInitialized) {
      logger.error('[Twilio] Intento de plantilla denegado: El cliente no esta configurado.');
      return { success: false, sid: null };
    }

    if (!contentSid) {
      logger.error('[Twilio] Content SID no proporcionado para la plantilla.');
      return { success: false, sid: null };
    }

    if (!this.isValidFormat(to)) {
      return { success: false, sid: null };
    }

    const formattedTo = this.formatNumber(to);
    const formattedFrom = this.getTwilioSender();

    if (!formattedTo || !formattedFrom) {
      return { success: false, sid: null };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const payload = {
          contentSid,
          from: formattedFrom,
          to: formattedTo,
        };

        if (Object.keys(variables).length > 0) {
          payload.contentVariables = JSON.stringify(variables);
        }

        const response = await this.client.messages.create(payload);

        logger.info(`[Twilio] Plantilla enviada a ${formattedTo}. SID: ${response.sid}`);
        return { success: true, sid: response.sid };
      } catch (error) {
        const shouldRetry = attempt < maxRetries && this.shouldRetry(error);

        logger.warn(
          `[Twilio] Plantilla: Intento ${attempt} fallido al enviar a ${to}: ${error.message} (status: ${error?.status ?? 'N/A'})`
        );

        if (!shouldRetry) {
          const detalleReintento = attempt === maxRetries ? '' : ' (no reintentable)';
          logger.error(
            `[Twilio] Plantilla: Error definitivo al enviar a ${to} tras ${attempt} intentos${detalleReintento}.`
          );
          return { success: false, sid: null };
        }

        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    return { success: false, sid: null };
  }
}

export const twilioProvider = new TwilioProvider();
