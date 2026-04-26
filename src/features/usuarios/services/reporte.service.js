import { prisma } from '../../../config/database.config.js';

export const reporteService = {
  /**
   * Recopila un mega-reporte tridimensional (alumnos, pagos y deudas) con relaciones de profundidad.
   * Ahora incluye mapeo de morosidad.
   */
  async getDetailedExcelReport() {
    try {
      const [alumnos, pagos, deudas, inscripciones] = await Promise.all([
        // 1. Alumnos (Con check de deudas pendientes)
        prisma.alumnos.findMany({
          select: {
            usuario_id: true,
            condiciones_medicas: true,
            seguro_medico: true,
            grupo_sanguineo: true,
            usuarios: {
              select: {
                nombres: true,
                apellidos: true,
                email: true,
                telefono_personal: true,
                fecha_nacimiento: true,
                genero: true,
                activo: true,
                numero_documento: true,
              },
            },
            alumnos_contactos: {
              where: { es_principal: true },
              select: { nombre_completo: true, telefono: true, relacion: true },
            },
            // Traemos solo las deudas pendientes para saber si debe o no
            cuentas_por_cobrar: {
              where: { estado: 'PENDIENTE' },
              select: { id: true }
            }
          },
        }),
        // 2. Pagos
        prisma.pagos.findMany({
          orderBy: { fecha_pago: 'desc' },
          select: {
            fecha_pago: true,
            monto_pagado: true,
            estado_validacion: true,
            codigo_operacion: true,
            cuentas_por_cobrar: {
              select: {
                catalogo_conceptos: { select: { nombre: true } },
                detalle_adicional: true,
                alumnos: {
                  select: {
                    usuarios: {
                      select: { nombres: true, apellidos: true },
                    },
                  },
                },
              },
            },
            metodos_pago: {
              select: { nombre: true },
            },
          },
        }),
        // 3. Deudas
        prisma.cuentas_por_cobrar.findMany({
          where: { estado: 'PENDIENTE' },
          orderBy: { fecha_vencimiento: 'asc' },
          select: {
            monto_final: true,
            fecha_vencimiento: true,
            detalle_adicional: true,
            catalogo_conceptos: {
              select: { nombre: true },
            },
            alumnos: {
              select: {
                usuarios: {
                  select: { nombres: true, apellidos: true, telefono_personal: true },
                },
              },
            },
          },
        }),
        // 4. Inscripciones Activas
        prisma.inscripciones.findMany({
          where: { estado: { in: ['ACTIVO', 'PENDIENTE_PAGO'] } },
          select: {
            estado: true,
            fecha_inscripcion_original: true,
            alumnos: {
              select: { usuarios: { select: { nombres: true, apellidos: true } } },
            },
            horarios_clases: {
              select: {
                dia_semana: true,
                hora_inicio: true,
                hora_fin: true,
                niveles_entrenamiento: { select: { nombre: true } },
                canchas: {
                  select: { nombre: true, sedes: { select: { nombre: true } } },
                },
              },
            },
          },
        }),
      ]);

      const calcularEdad = (fechaNacimiento) => {
        if (!fechaNacimiento) return 'N/A';
        const hoy = new Date();
        const cumpleanos = new Date(fechaNacimiento);
        let edad = hoy.getFullYear() - cumpleanos.getFullYear();
        const m = hoy.getMonth() - cumpleanos.getMonth();
        if (m < 0 || (m === 0 && hoy.getDate() < cumpleanos.getDate())) {
          edad--;
        }
        return edad;
      };

      const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

      return {
        alumnos: alumnos.map((a) => ({
          ID: a.usuario_id,
          Estado: a.usuarios?.activo ? 'ACTIVO' : 'INACTIVO',
          Deuda_Pendiente: a.cuentas_por_cobrar.length > 0 ? 'SÍ' : 'NO', // Nueva columna
          Cant_Cuentas_Pendientes: a.cuentas_por_cobrar.length, // Opcional: cantidad de deudas
          Nombres: a.usuarios?.nombres || '',
          Apellidos: a.usuarios?.apellidos || '',
          DNI: a.usuarios?.numero_documento || 'N/A',
          Edad: calcularEdad(a.usuarios?.fecha_nacimiento),
          Genero: a.usuarios?.genero || 'N/A',
          Celular: a.usuarios?.telefono_personal || 'N/A',
          Email: a.usuarios?.email || 'N/A',
          Condiciones_Médicas: a.condiciones_medicas || 'Ninguna',
          Seguro: a.seguro_medico || 'N/A',
          Sangre: a.grupo_sanguineo || 'N/A',
          Contacto_Emergencia: a.alumnos_contactos[0]?.nombre_completo || 'N/A',
          Telefono_Emergencia: a.alumnos_contactos[0]?.telefono || 'N/A',
          Parentesco_Emergencia: a.alumnos_contactos[0]?.relacion || 'N/A',
        })),
        inscripciones: inscripciones.map((i) => ({
          Alumno: `${i.alumnos?.usuarios?.nombres || ''} ${i.alumnos?.usuarios?.apellidos || ''}`,
          Estado: i.estado,
          Sede: i.horarios_clases?.canchas?.sedes?.nombre || 'N/A',
          Cancha: i.horarios_clases?.canchas?.nombre || 'N/A',
          Nivel: i.horarios_clases?.niveles_entrenamiento?.nombre || 'N/A',
          Dia: diasSemana[i.horarios_clases?.dia_semana] || 'N/A',
          Horario: `${new Date(i.horarios_clases?.hora_inicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(i.horarios_clases?.hora_fin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          Fecha_Registro: i.fecha_inscripcion_original ? new Date(i.fecha_inscripcion_original).toLocaleDateString() : 'N/A',
        })),
        pagos: pagos.map((p) => ({
          Fecha: p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString() : 'N/A',
          Alumno: p.cuentas_por_cobrar?.alumnos?.usuarios
            ? `${p.cuentas_por_cobrar.alumnos.usuarios.nombres} ${p.cuentas_por_cobrar.alumnos.usuarios.apellidos}`
            : 'Desconocido',
          Concepto: p.cuentas_por_cobrar?.catalogo_conceptos?.nombre || p.cuentas_por_cobrar?.detalle_adicional || 'Varios',
          Monto: Number.parseFloat(p.monto_pagado || 0),
          Metodo: p.metodos_pago?.nombre || 'N/A',
          Operacion: p.codigo_operacion || 'N/A',
          Estado: p.estado_validacion,
        })),
        deudas: deudas.map((d) => ({
          Alumno: `${d.alumnos?.usuarios?.nombres || ''} ${d.alumnos?.usuarios?.apellidos || ''}`,
          Celular_Contacto: d.alumnos?.usuarios?.telefono_personal || 'N/A',
          Concepto: d.catalogo_conceptos?.nombre || d.detalle_adicional || 'Varios',
          Monto_Pendiente: Number.parseFloat(d.monto_final || 0),
          Dias_Vencidos: Math.max(0, Math.floor((new Date() - new Date(d.fecha_vencimiento)) / (1000 * 60 * 60 * 24))),
          Vencimiento: d.fecha_vencimiento
            ? new Date(d.fecha_vencimiento).toLocaleDateString()
            : 'N/A',
        })),
      };
    } catch (error) {
      console.error('Error detallado en Prisma:', error);
      throw error;
    }
  },
};