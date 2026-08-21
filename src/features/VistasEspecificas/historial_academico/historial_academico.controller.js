import { historialAcademicoService } from './historial_academico.service.js';

export const historialAcademicoController = {
  getHistorialPorAlumno: async (req, res, next) => {
    try {
      const { alumnoId } = req.params;
      const data = await historialAcademicoService.obtenerHistorialPorAlumno(alumnoId);

      return res.status(200).json({
        success: true,
        data,
        message: 'Historial académico obtenido correctamente'
      });
    } catch (error) {
      next(error);
    }
  },
};