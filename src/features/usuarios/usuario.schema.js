import z from 'zod';
import { userCommonValidation } from '../../shared/validation/common.validation.js';
import { VALID_ROLES_ARRAY, ROLE_REQUIRED_FIELDS } from '../roles/roles.constants.js';
import { rolesSpecificSchemas } from './schemas/roles.schema.js';
import { commonUsuarioSchemas } from './schemas/common.schema.js';

const emptyToUndefined = (schema) =>
  z.preprocess((val) => (val === '' || val === null ? undefined : val), schema);

const baseUserSchema = z.object({
  username: z
    .string({ required_error: 'El nombre de usuario es obligatorio' })
    .trim()
    .toLowerCase()
    .min(3, 'El username debe tener al menos 3 caracteres')
    .max(50)
    .regex(/^[a-z0-9._]+$/, 'Solo letras, números, puntos y guiones bajos')
    .optional(),
  email: z
    .string({ required_error: 'El correo electrónico es requerido' })
    .trim()
    .toLowerCase()
    .email('Email inválido'),
  password: userCommonValidation.passwordSchema,
  nombres: userCommonValidation.nameSchema,
  apellidos: userCommonValidation.nameSchema,
  tipo_documento_id: emptyToUndefined(userCommonValidation.stringIdSchema).optional().nullable(),
  numero_documento: emptyToUndefined(
    z
      .string()
      .min(5, 'El número de documento debe tener al menos 5 caracteres')
      .max(20, 'El número de documento debe tener menos de 15 caracteres')
  ).optional().nullable(),
  rol_id: z
    .union([
      z.enum(VALID_ROLES_ARRAY, {
        errorMap: () => ({
          message: `Rol inválido. Valores permitidos: ${VALID_ROLES_ARRAY.join(', ')}`,
        }),
      }),
      z.number().int().positive('El ID del rol debe ser un número positivo'),
    ])
    .default('alumno'),
  telefono_personal: z
    .string({ required_error: 'El celular es requerido' })
    .regex(/^\+?[0-9]{7,15}$/, 'Formato de teléfono inválido'),
  fecha_nacimiento: z.preprocess(
    (val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim().slice(0, 10);
      if (val instanceof Date) return val.toISOString().slice(0, 10);
      return val;
    },
    z
      .string({ required_error: 'La fecha de nacimiento es requerida' })
      .min(1, 'La fecha de nacimiento es requerida')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)')
      .transform((val) => new Date(val))
  ),
  genero: emptyToUndefined(
    z
      .enum(['M', 'F', 'O'], {
        errorMap: () => ({ message: 'Género debe ser M (Masculino), F (Femenino) u O (Otro)' }),
      })
  ).optional().nullable(),
});

export const usuarioSchema = {
  ...commonUsuarioSchemas, // idParamSchema, rolParamSchema, validateRoleSchema

  registerUserSchema: baseUserSchema
    .extend({
      datosRolEspecifico: z.record(z.any()).optional(),
    })
    .superRefine((data, ctx) => {
      let rol = data.rol_id;
      if (typeof rol === 'string') {
        rol = rol.toLowerCase();
      } else if (!rol) {
        rol = 'alumno';
      }
      const datos = data.datosRolEspecifico || {};

      if (typeof rol === 'number') return;

      if (!VALID_ROLES_ARRAY.includes(rol)) {
        ctx.addIssue({
          code: z.ZodIssueCode.invalid_enum_value,
          path: ['rol_id'],
          message: `Rol inválido. Valores permitidos: ${VALID_ROLES_ARRAY.join(', ')}`,
          options: VALID_ROLES_ARRAY,
          received: rol,
        });
      }

      const schemasMap = {
        alumno: rolesSpecificSchemas.alumnoSpecificSchema,
        coordinador: rolesSpecificSchemas.coordinadorSpecificSchema,
        administrador: rolesSpecificSchemas.administradorSpecificSchema,
      };

      if (schemasMap[rol]) {
        const result = schemasMap[rol].safeParse(datos);
        if (!result.success) {
          result.error.issues.forEach((issue) => {
            ctx.addIssue({
              ...issue,
              path: ['datosRolEspecifico', ...issue.path],
            });
          });
        }
      }

      const requiredFields = ROLE_REQUIRED_FIELDS[rol] || [];
      requiredFields.forEach((field) => {
        if (!datos[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.invalid_type,
            path: ['datosRolEspecifico', field],
            expected: 'string',
            received: typeof datos[field],
            message: `Campo "${field}" es obligatorio para el rol ${rol}`,
          });
        }
      });
    }),

  updateUserSchema: z
    .object({
      username: z.string().trim().toLowerCase().min(3).max(50).optional(),
      nombres: emptyToUndefined(userCommonValidation.nameSchema).optional(),
      apellidos: emptyToUndefined(userCommonValidation.nameSchema).optional(),
      email: z.string().trim().toLowerCase().email().nullable().optional(),
      telefono_personal: emptyToUndefined(userCommonValidation.phoneSchema).optional(),
      tipo_documento_id: emptyToUndefined(userCommonValidation.stringIdSchema).optional().nullable(),
      numero_documento: emptyToUndefined(z.string().min(5).max(20)).optional().nullable(),
      fecha_nacimiento: emptyToUndefined(userCommonValidation.dateSchema).optional().nullable(),
      genero: emptyToUndefined(z.enum(['M', 'F', 'O'])).optional().nullable(),
      password: emptyToUndefined(userCommonValidation.passwordSchema).optional(),
      direccion_completa: emptyToUndefined(z.string().trim().min(3).max(255)).optional(),
      distrito: emptyToUndefined(z.string().trim().min(1).max(100)).optional(),
      ciudad: emptyToUndefined(z.string().trim().min(1).max(100)).optional(),
      referencia: emptyToUndefined(z.string().trim().min(1).max(255)).optional().nullable(),
      contacto_emergencia: z
        .object({
          nombre_completo: emptyToUndefined(z.string().trim().min(3).max(150)).optional(),
          telefono: emptyToUndefined(z.string().trim().min(7).max(20)).optional(),
          relacion: emptyToUndefined(z.string().trim().min(1).max(50)).optional().nullable(),
        })
        .optional(),
      datosRolEspecifico: z
        .object({
          condiciones_medicas: emptyToUndefined(z.string().max(500)).optional(),
          seguro_medico: emptyToUndefined(z.string().max(100)).optional(),
          grupo_sanguineo: emptyToUndefined(
            z.enum(['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'])
          ).optional(),
        })
        .optional(),
    })
    .superRefine((data, ctx) => {
      const { contacto_emergencia, ...otrosCampos } = data;
      const hasAnyField =
        Object.values(otrosCampos).some((v) => v !== undefined) ||
        contacto_emergencia !== undefined;

      if (!hasAnyField) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: 'Debe proporcionar al menos un campo para actualizar',
        });
      }

      if (contacto_emergencia) {
        const { nombre_completo, telefono } = contacto_emergencia;
        if (Object.values(contacto_emergencia).some((v) => v !== undefined)) {
          if (!nombre_completo) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['contacto_emergencia', 'nombre_completo'],
              message: 'Nombre completo es requerido para el contacto de emergencia',
            });
          }
          if (!telefono) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['contacto_emergencia', 'telefono'],
              message: 'Teléfono es requerido para el contacto de emergencia',
            });
          }
        }
      }
    }),
};
