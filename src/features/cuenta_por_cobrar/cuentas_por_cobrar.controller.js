import { CuentasPorCobrarService } from './cuentas_por_cobrar.service.js';

export const CuentasPorCobrarController = {
  async crear(req, res) {
    try {
      const result = await CuentasPorCobrarService.crear(req.body);
      res.status(201).json({ ok: true, data: result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  },

  async listar(req, res) {
    try {
      const result = await CuentasPorCobrarService.obtenerTodas();
      res.json({ ok: true, data: result });
    } catch (error) {
      res.status(500).json({ ok: false, error: "Error al listar cuentas" });
    }
  },

  async obtenerUno(req, res) {
    try {
      const result = await CuentasPorCobrarService.obtenerPorId(req.params.id);
      res.json({ ok: true, data: result });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  },

  async actualizar(req, res) {
    try {
      const result = await CuentasPorCobrarService.actualizar(req.params.id, req.body);
      res.json({ ok: true, message: "Cuenta actualizada", data: result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  },
 async obtenerHistorialAlumno(req, res) {
    try {
      const { alumnoId } = req.params;
      const result = await CuentasPorCobrarService.obtenerTodoPorAlumno(alumnoId);
      res.json({ 
        ok: true, 
        total_registros: result.length,
        data: result 
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: "Error al recuperar el historial del alumno" });
    }
  },

  async eliminar(req, res) {
    try {
      await CuentasPorCobrarService.eliminar(req.params.id);
      res.json({ ok: true, message: "Cuenta eliminada exitosamente" });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  },

 async previsualizarFechaRenovacion(req, res) {
    try {
      const { grupoUuid } = req.params;
      const fechaSugerida = await CuentasPorCobrarService.obtenerFechaSugeridaPaquete(grupoUuid);
      res.json({ ok: true, fechaSugerida });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  },

  // 🔥 ACTUALIZADO: Ahora recibe grupoUuid en lugar de inscripcionId
  async generarAdelantado(req, res) {
    try {
      const { grupoUuid } = req.params; // Cambiamos esto
      const { fecha_inicio } = req.body;
      
      if (!fecha_inicio) throw new Error("La fecha de inicio es obligatoria");

      const result = await CuentasPorCobrarService.generarRenovacionPaquete(grupoUuid, fecha_inicio);
      
      res.json({ 
        ok: true, 
        message: "Paquete renovado exitosamente.",
        data: result 
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  },
  
};