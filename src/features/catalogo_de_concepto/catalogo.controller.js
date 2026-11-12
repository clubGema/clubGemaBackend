import { catalogoService } from './catalogo.service.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';
import { apiResponse } from '../../shared/utils/response.util.js';

export const catalogoController = {
  getAll: catchAsync(async (req, res) => {
    const data = await catalogoService.findAll();
    return apiResponse.success(res, {
      message: 'Catálogo de conceptos obtenido',
      data,
    });
  }),

  getVigentes: catchAsync(async (req, res) => {
    const data = await catalogoService.findVigentes();
    return apiResponse.success(res, {
      message: 'Planes vigentes obtenidos',
      data,
    });
  }),

  getLegacy: catchAsync(async (req, res) => {
    const data = await catalogoService.findLegacy();
    return apiResponse.success(res, {
      message: 'Planes Legacy obtenidos',
      data,
    });
  }),

  getById: catchAsync(async (req, res) => {
    const data = await catalogoService.findOne(req.params.id); // req.params.id is parsed by Zod now
    return apiResponse.success(res, {
      message: 'Concepto obtenido',
      data,
    });
  }),

  create: catchAsync(async (req, res) => {
    const data = await catalogoService.create(req.body);
    return apiResponse.created(res, {
      message: 'Concepto creado exitosamente',
      data,
    });
  }),

  update: catchAsync(async (req, res) => {
    const data = await catalogoService.update(req.params.id, req.body);
    return apiResponse.success(res, {
      message: 'Concepto actualizado exitosamente',
      data,
    });
  }),

  delete: catchAsync(async (req, res) => {
    await catalogoService.delete(req.params.id);
    return apiResponse.success(res, {
      message: 'Concepto desactivado exitosamente',
    });
  }),
};
