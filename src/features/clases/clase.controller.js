import { claseService } from './clase.service.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';
import { apiResponse } from '../../shared/utils/response.util.js';

export const claseController = {
  reprogramarMasivo: catchAsync(async (req, res) => {
    const {
      horario_origen_id,
      fecha_origen,
      motivo,
    } = req.body;
    const usuario_admin_id = req.user.id; // Asumimos que viene del token (admin)

    const resultado = await claseService.reprogramarMasivamente({
      horario_origen_id,
      fecha_origen,
      motivo,
      usuario_admin_id,
    });

    return apiResponse.success(res, {
      message: 'Proceso de reprogramación masiva completado',
      data: resultado,
    });
  }),

  obtenerDetalle: catchAsync(async (req, res) => {
    const { horario_id } = req.params;
    const detalle = await claseService.obtenerDetalleClase(horario_id);
    return apiResponse.success(res, { data: detalle });
  }),

  revertirMasivo: catchAsync(async (req, res) => {
    const { grupo_uuid } = req.body;
    const resultado = await claseService.revertirReprogramacionMasiva(grupo_uuid);
    return apiResponse.success(res, {
      message: 'Reprogramación masiva revertida exitosamente',
      data: resultado,
    });
  }),

  obtenerMasivasActivas: catchAsync(async (req, res) => {
    const list = await claseService.obtenerMasivasActivas();
    return apiResponse.success(res, { data: list });
  }),

  obtenerFechasDisponibles: catchAsync(async (req, res) => {
    const { horario_id } = req.params;
    const fechas = await claseService.obtenerFechasDisponibles(horario_id);
    return apiResponse.success(res, { data: fechas });
  }),

  obtenerHorariosConAsistencia: catchAsync(async (req, res) => {
    const horarios = await claseService.obtenerHorariosConAsistencia();
    return apiResponse.success(res, { data: horarios });
  }),
  obtenerFechasPasadas: catchAsync(async (req, res) => {
  const { horario_id } = req.params;
  const fechas = await claseService.obtenerFechasPasadas(horario_id);
  return apiResponse.success(res, { data: fechas });
}),
};
