import anunciosBeneficiosService from './anunciosBeneficios.service.js';
import { apiResponse } from '../../shared/utils/response.util.js'; // Ajusta la ruta a tu util
import { catchAsync } from '../../shared/utils/catchAsync.util.js';// Ajusta la ruta a tu util

export const obtenerActivos = catchAsync(async (req, res) => {
  const anuncios = await anunciosBeneficiosService.obtenerActivos();
  return apiResponse.success(res, {
    data: anuncios,
    message: 'Anuncios visuales activos obtenidos con éxito.',
  });
});

export const obtenerTodos = catchAsync(async (req, res) => {
  const anuncios = await anunciosBeneficiosService.obtenerTodos();
  return apiResponse.success(res, {
    data: anuncios,
    message: 'Todos los anuncios obtenidos (Admin).',
  });
});

export const crear = catchAsync(async (req, res) => {
  const nuevoAnuncio = await anunciosBeneficiosService.crear(req.body);
  return apiResponse.success(res, {
    data: nuevoAnuncio,
    message: 'Anuncio creado exitosamente.',
  }, 201);
});

export const actualizar = catchAsync(async (req, res) => {
  const { id } = req.params;
  const anuncioActualizado = await anunciosBeneficiosService.actualizar(id, req.body);
  return apiResponse.success(res, {
    data: anuncioActualizado,
    message: 'Anuncio actualizado correctamente.',
  });
});

export const eliminar = catchAsync(async (req, res) => {
  const { id } = req.params;
  await anunciosBeneficiosService.eliminar(id);
  return apiResponse.success(res, {
    message: 'Anuncio eliminado de la plataforma.',
  });
});