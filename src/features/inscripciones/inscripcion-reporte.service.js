import { prisma } from '../../config/database.config.js';
import crypto from 'crypto';
import * as Utils from './utils/inscripcion.util.js';
import * as Validators from './validators/inscripcion.validator.js';
import * as Logic from './logic/inscripcion.logic.js';
import { asistenciaService } from '../asistencia/asistencia.service.js';
import { ApiError } from '../../shared/utils/error.util.js';
import { CuentasPorCobrarService } from '../cuenta_por_cobrar/cuentas_por_cobrar.service.js';
import { pagosService } from '../pagos/pagos.service.js';

// 🔥 IMPORTAMOS DAYJS Y CONFIGURAMOS LIMA PARA LOS LOGS 🔥
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ_LIMA = 'America/Lima';

export const inscripcionReporteService = {
  
  /**
   * Obtiene el reporte detallado de inscripciones INDIVIDUALES
   * Listo para ser exportado a Excel
   */
 getReporteIndividuales: async () => {
    try {
      // 1. Consultar a Prisma todas las inscripciones tipo INDIVIDUAL
      const inscripcionesIndividuales = await prisma.inscripciones.findMany({
        where: {
          tipo_inscripcion: 'INDIVIDUAL'
        },
        include: {
          alumnos: {
            include: {
              usuarios: {
                // 🚀 CORREGIDO: Cambiado 'dni' por 'numero_documento'
                select: { 
                    nombres: true, 
                    apellidos: true, 
                    numero_documento: true, 
                    email: true, 
                    telefono_personal: true
                }
              }
            }
          },
          horarios_clases: {
            include: {
              niveles_entrenamiento: { select: { nombre: true } },
              canchas: {
                include: { sedes: { select: { nombre: true } } }
              }
            }
          },
          inscripciones_deudas_link: {
            include: {
              cuentas_por_cobrar: {
                include: {
                  pagos: true
                }
              }
            }
          }
        },
        orderBy: {
          fecha_inscripcion: 'desc'
        }
      });

      // 2. Formatear y "aplanar" la data
      const reporteExcel = inscripcionesIndividuales.map(insc => {
        
        // --- Extracción segura de datos ---
        const alumnoNombres = insc.alumnos?.usuarios?.nombres || 'Sin nombre';
        const alumnoApellidos = insc.alumnos?.usuarios?.apellidos || 'Sin apellido';
        // 🚀 CORREGIDO: Usamos numero_documento aquí también
        const alumnoDNI = insc.alumnos?.usuarios?.numero_documento || 'Sin DNI';
        const sede = insc.horarios_clases?.canchas?.sedes?.nombre || 'Sin Sede';
        const nivel = insc.horarios_clases?.niveles_entrenamiento?.nombre || 'Sin Nivel';
        
        // --- Cálculo de pagos ---
        let montoPagadoTotal = 0;
        let estadoPago = 'PENDIENTE';
        
        if (insc.inscripciones_deudas_link && insc.inscripciones_deudas_link.length > 0) {
          insc.inscripciones_deudas_link.forEach(link => {
            const pagos = link.cuentas_por_cobrar?.pagos || [];
            pagos.forEach(pago => {
              if (pago.estado_validacion === 'APROBADO') {
                montoPagadoTotal += parseFloat(pago.monto_pagado || 0);
              }
            });
          });
        }

        if (montoPagadoTotal > 0) {
          estadoPago = 'PAGADO';
        }

        return {
          "ID INSCRIPCIÓN": insc.id,
          "TIPO": insc.tipo_inscripcion,
          "FECHA DE REGISTRO": dayjs(insc.creado_en).tz(TZ_LIMA).format('DD/MM/YYYY HH:mm:ss'),
          "FECHA INSCRIPCIÓN": dayjs(insc.fecha_inscripcion).tz(TZ_LIMA).format('DD/MM/YYYY'),
          "ESTADO ACADÉMICO": insc.estado,
          "DNI": alumnoDNI,
          "ALUMNO": `${alumnoNombres} ${alumnoApellidos}`,
          "SEDE": sede,
          "NIVEL": nivel,
          "ESTADO FINANCIERO": estadoPago,
          "MONTO PAGADO (S/)": montoPagadoTotal.toFixed(2)
        };
      });

      return reporteExcel;

    } catch (error) {
      console.error(`[${dayjs().tz(TZ_LIMA).format('YYYY-MM-DD HH:mm:ss')}] Error generando reporte individual:`, error);
      throw new ApiError('Error al generar el reporte de inscripciones individuales', 500);
    }
  }

};