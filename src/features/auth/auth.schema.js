import z from 'zod';

export const authSchema = {
  loginSchema: z.object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'El nombre de usuario debe tener al menos 3 caracteres')
      .max(50, 'El nombre de usuario no puede exceder los 50 caracteres')
      .regex(
        /^[a-z0-9._áéíóúüñ]+$/,
        'El username solo permite letras, números, puntos y guiones bajos'
      ),
    password: z.string().min(1, 'La contraseña es obligatoria'),
  }),

  completarEmailSchema: z.object({
    email: z.string().trim().toLowerCase().email('Email inválido'),
  }),

  forgotPasswordSchema: z.object({
    username: z.string().trim().toLowerCase().min(3).max(50),
  }),

  resetPasswordSchema: z.object({
    userId: z.number().optional(),
    token: z.string().min(1, 'El token es obligatorio').optional(),
    newPassword: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  }),

  changePasswordSchema: z.object({
    currentPassword: z.string().min(1, 'La contraseña actual es obligatoria'),
    newPassword: z.string().min(6, 'La nueva contraseña debe tener al menos 6 caracteres'),
  }),

  updateProfileSchema: z.object({
    email: z.string().email('Email inválido').optional().or(z.literal('')),
    telefono_personal: z.string().optional(),
    nombres: z.string().optional(),
    apellidos: z.string().optional(),
    genero: z.string().optional(),
    condiciones_medicas: z.string().optional(),
    seguro_medico: z.string().optional(),
    grupo_sanguineo: z.string().optional(),
    especializacion: z.string().optional(),
  }),
};
