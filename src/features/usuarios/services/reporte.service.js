import { prisma } from '../../../config/database.config.js';

export const reporteService = {
  async getDetailedExcelReport() {
    try {
      const inscripciones = await prisma.inscripciones.findMany({
        where: {
          estado: { in: ['ACTIVO', 'PENDIENTE_PAGO'] }
        },
        include: {
          alumnos: {
            include: {
              usuarios: true,
              cuentas_por_cobrar: {
                orderBy: { fecha_vencimiento: 'desc' },
                take: 1
              }
            }
          },
          horarios_clases: {
            include: {
              niveles_entrenamiento: true,
              canchas: { include: { sedes: true } }
            }
          }
        }
      });

      // Si no hay datos, devolvemos un array vacío para evitar el error .length
      if (!inscripciones || inscripciones.length === 0) return [];

      const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

      return inscripciones.map((ins) => {
        const usu = ins?.alumnos?.usuarios;
        const hor = ins?.horarios_clases;

        // Separación segura de apellidos
        const apellidosArray = (usu?.apellidos || '').trim().split(' ');
        const apePaterno = apellidosArray[0] || '';
        const apeMaterno = apellidosArray.slice(1).join(' ') || '';

        const ultimaCuota = ins?.alumnos?.cuentas_por_cobrar?.[0];

        return {
          'Sede': hor?.canchas?.sedes?.nombre || 'N/A',
          'Nivel': hor?.niveles_entrenamiento?.nombre || 'N/A',
          'Modalidad': diasSemana[hor?.dia_semana] || 'N/A',
          'Nombres': usu?.nombres || 'N/A',
          'Apellido Paterno': apePaterno,
          'Apellido Materno': apeMaterno,
          'Nro Celular': usu?.telefono_personal || 'N/A',
          'Fecha de Nacimiento': usu?.fecha_nacimiento
            ? new Date(usu.fecha_nacimiento).toLocaleDateString('es-PE')
            : 'N/A',
          'Alumno Vigente': usu?.activo ? 'Si' : 'No',
          'Fecha de corte o fin de mensualidad': ultimaCuota?.fecha_vencimiento
            ? new Date(ultimaCuota.fecha_vencimiento).toLocaleDateString('es-PE')
            : 'Sin Fecha'
        };
      });
    } catch (error) {
      console.error('Error en reporteService:', error);
      return []; // Devolvemos array vacío en error para que no explote el .length
    }
  },
};