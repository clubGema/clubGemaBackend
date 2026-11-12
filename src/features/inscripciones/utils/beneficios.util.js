export const restaurarBeneficiosConsumidos = async (tx, alumnoId, descuentos) => {
    let restaurados = 0;
    for (const d of descuentos ?? []) {
        const consumido = await tx.beneficios_pendientes.findFirst({
            where: { alumno_id: alumnoId, tipo_beneficio_id: d.tipo_beneficio_id, usado: true },
            orderBy: { fecha_asignacion: 'desc' },
            select: { id: true },
        });
        if (!consumido) continue;
        await tx.beneficios_pendientes.update({ where: { id: consumido.id }, data: { usado: false } });
        restaurados++;
    }
    return restaurados;
};