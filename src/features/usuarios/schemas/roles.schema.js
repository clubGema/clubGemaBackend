import z from 'zod';

const direccionSchema = z.object({
  direccion_completa: z
    .string({
      required_error: 'La dirección es requerida',
    })
    .trim()
    .min(3, 'La dirección debe tener al menos 3 caracteres')
    .max(255),
  distrito: z
    .string({
      required_error: 'El distrito es requerido',
    })
    .trim()
    .min(1, 'El distrito es requerido')
    .max(100),
  ciudad: z.string().trim().min(1, 'La ciudad es requerida').max(100).default('Lima').optional(),
  referencia: z.string().trim().min(1, 'La referencia es requerida').max(255).nullable().optional(),
});

export const rolesSpecificSchemas = {
  alumnoSpecificSchema: z.object({
    condiciones_medicas: z
      .string()
      .max(500, 'Condiciones médicas no puede exceder 500 caracteres')
      .optional(),
    seguro_medico: z
      .string()
      .max(100, 'Nombre del seguro no puede exceder 100 caracteres')
      .optional(),
    grupo_sanguineo: z
      .enum(['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'], {
        errorMap: () => ({
          message: 'Grupo sanguíneo inválido. Valores permitidos: O+, O-, A+, A-, B+, B-, AB+, AB-',
        }),
      })
      .optional(),
    direccion: direccionSchema.optional(),
  }),

  coordinadorSpecificSchema: z.object({
    especializacion: z
      .string()
      .min(3, 'Especialización debe tener al menos 3 caracteres')
      .max(100, 'Especialización no puede exceder 100 caracteres')
      .optional(),
    tarifa_hora: z
      .union([
        z.number().positive('Tarifa por hora debe ser un número positivo').max(9999),
        z.string().transform((val) => Number.parseFloat(val)),
      ])
      .refine((val) => val > 0, 'Tarifa por hora debe ser mayor a 0')
      .optional(),
  }),

  administradorSpecificSchema: z.object({
    cargo: z
      .string({
        required_error: 'Campo "cargo" es obligatorio para administradores',
      })
      .min(3, 'Cargo debe tener al menos 3 caracteres')
      .max(100, 'Cargo no puede exceder 100 caracteres'),

    sede_id: z.number().int().positive('Sede ID debe ser un número positivo').nullable().optional(),

    area: z
      .string()
      .min(3, 'Área debe tener al menos 3 caracteres')
      .max(100, 'Área no puede exceder 100 caracteres')
      .optional(),
  }),
};
