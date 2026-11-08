import { sedeService } from './sede.service.js';
import { apiResponse } from '../../shared/utils/response.util.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';

export const sedeController = {
  createSede: catchAsync(async (req, res) => {
    const sede = await sedeService.createSede(req.body);
    return apiResponse.created(res, {
      message: 'Sede creada exitosamente',
      data: sede,
    });
  }),

  getAllSedes: catchAsync(async (req, res) => {
    const result = await sedeService.getAllSedes(req.query);
    return apiResponse.success(res, {
      message: 'Sedes obtenidas exitosamente',
      data: result.sedes,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  }),

  getCanchaForSedeCount: catchAsync(async (req, res) => {
    const result = await sedeService.getCanchaForSedeCount(req.query);
    return apiResponse.success(res, {
      message: 'Conteo de canchas por sede obtenido exitosamente',
      data: result.sedes,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  }),

  getSedeById: catchAsync(async (req, res) => {
    const sede = await sedeService.getSedeById(req.params.id);
    return apiResponse.success(res, {
      message: 'Sede obtenida exitosamente',
      data: sede,
    });
  }),

  updateSede: catchAsync(async (req, res) => {
    const sede = await sedeService.updateSede(req.params.id, req.body);
    return apiResponse.success(res, {
      message: 'Sede actualizada exitosamente',
      data: sede,
    });
  }),

  updateDefuseSede: catchAsync(async (req, res) => {
    await sedeService.updateDefuseSede(req.params.id);
    return apiResponse.noContent(res);
  }),

  updateActiveSede: catchAsync(async (req, res) => {
    await sedeService.updateActiveSede(req.params.id);
    return apiResponse.noContent(res);
  }),

  deleteSede: catchAsync(async (req, res) => {
    const result = await sedeService.deleteSede(req.params.id);
    return apiResponse.success(res, {
      message: result.message,
      data: null,
    });
  }),
  getReporteOcupacionDetallado: catchAsync(async (req, res) => {
    const { mes, anio, sedeId } = req.query;
    const reporte = await sedeService.obtenerReporteOcupacionDetallado({ mes, anio, sedeId });
    return apiResponse.success(res, {
      message: 'Reporte detallado de ocupación de sedes obtenido con éxito',
      data: reporte
    });
  }),

  getOcupacionDashboard: catchAsync(async (req, res) => {
    const ocupacion = await sedeService.obtenerOcupacionDashboard();
    return apiResponse.success(res, {
      message: 'Ocupación de sedes obtenida con éxito',
      data: ocupacion
    });
  }),
};
