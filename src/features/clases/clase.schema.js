import { z } from 'zod';

export const claseSchema = {
  reprogramarMasivoSchema: z.object({
    horario_origen_id: z.union([
      z.number().int().positive('ID de horario origen inválido'),
      z.string().regex(/^\d+$/, 'ID de horario origen debe ser numérico').transform(Number),
    ]),
    fecha_origen: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha origen debe tener formato YYYY-MM-DD'),
    fecha_destino: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha destino debe tener formato YYYY-MM-DD')
      .optional(),
    hora_inicio_destino: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Hora de inicio debe tener formato HH:mm')
      .optional(),
    hora_fin_destino: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Hora de fin debe tener formato HH:mm')
      .optional(),
    motivo: z
      .string()
      .min(3, 'El motivo debe tener al menos 3 caracteres')
      .max(200, 'El motivo es muy largo'),
  }),
  horarioIdParamSchema: z.object({
    horario_id: z
      .string()
      .regex(/^\d+$/, 'El ID del horario debe ser un número')
      .transform(Number)
      .refine((val) => val > 0, 'El ID del horario debe ser mayor a 0'),
  }),
};
