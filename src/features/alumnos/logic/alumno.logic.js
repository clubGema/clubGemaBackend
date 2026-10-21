export const alumnoLogic = {
  /**
   * Actualiza los datos base de la cuenta (tabla 'usuarios')
   * @param {Object} tx Prisma transaction
   * @param {number} usuarioId Id del usuario
   * @param {Object} datos Campos a actualizar (email, telefono, fecha...)
   */
  async actualizarDatosBaseUsuario(tx, usuarioId, datos) {
    const {
      nombres,
      apellidos,
      email,
      telefono_personal,
      fecha_nacimiento,
      tipo_documento_id,
      numero_documento,
      genero,
    } = datos;

    const dataUsuario = {};
    if (nombres) dataUsuario.nombres = nombres;
    if (apellidos) dataUsuario.apellidos = apellidos;
    if (email) dataUsuario.email = email;
    if (telefono_personal) dataUsuario.telefono_personal = telefono_personal;
    if (fecha_nacimiento) dataUsuario.fecha_nacimiento = new Date(fecha_nacimiento);
    if (tipo_documento_id) dataUsuario.tipo_documento_id = tipo_documento_id;
    if (numero_documento) dataUsuario.numero_documento = numero_documento;
    if (genero) dataUsuario.genero = genero;

    if (Object.keys(dataUsuario).length > 0) {
      await tx.usuarios.update({ where: { id: usuarioId }, data: dataUsuario });
    }
  },

  /**
   * Crea o actualiza la dirección ligada al id de un alumno.
   * @param {Object} tx Prisma transaction
   * @param {number} direccionIdActual ID actual (si la tiene)
   * @param {Object} datos Detalles de la dirección (calle, ciudad...)
   * @returns {Promise<number|null>} El ID de la dirección resolutoria
   */
  async gestionarDireccion(tx, direccionIdActual, datos) {
    const { direccion_completa, distrito, ciudad, referencia } = datos;

    const hayDatosDireccion = direccion_completa || distrito || referencia;
    if (!hayDatosDireccion) return direccionIdActual;

    const dataDir = {
      ...(direccion_completa && { direccion_completa }),
      ...(distrito && { distrito }),
      ...(referencia && { referencia }),
      ciudad: ciudad || 'Lima',
    };

    if (direccionIdActual) {
      await tx.direcciones.update({ where: { id: direccionIdActual }, data: dataDir });
      return direccionIdActual;
    }

    if (direccion_completa && distrito) {
      const nuevaDir = await tx.direcciones.create({ data: dataDir });
      return nuevaDir.id;
    }

    return null;
  },

  /**
   * Aglutina las condicione médicas y registra la actualización final devolviendo el perfil del alumno actual.
   * @param {Object} tx Prisma transaction
   * @param {number} usuarioId Id del usuario
   * @param {number|null} direccionId Id de la dirección (actualizada o nueva)
   * @param {Object} datos Elementos médicos del alumno
   * @returns {Promise<Object>} Formato de perfil actualizado consumible
   */
  async actualizarPerfilMedico(tx, usuarioId, direccionId, datos) {
    const { condiciones_medicas, seguro_medico, grupo_sanguineo } = datos;

    const dataAlumno = {
      ...(condiciones_medicas && { condiciones_medicas }),
      ...(seguro_medico && { seguro_medico }),
      ...(grupo_sanguineo && { grupo_sanguineo }),
      ...(direccionId && { direccion_id: direccionId }),
    };

    return await tx.alumnos.update({
      where: { usuario_id: usuarioId },
      data: dataAlumno,
      select: {
        usuario_id: true,
        condiciones_medicas: true,
        seguro_medico: true,
        grupo_sanguineo: true,
        usuarios: {
          select: {
            id: true,
            nombres: true,
            apellidos: true,
            email: true,
            telefono_personal: true,
            fecha_nacimiento: true,
            tipo_documento_id: true,
            numero_documento: true,
            genero: true,
          },
        },
        direcciones: {
          select: {
            id: true,
            direccion_completa: true,
            distrito: true,
            ciudad: true,
            referencia: true,
          },
        },
      },
    });
  },
};
