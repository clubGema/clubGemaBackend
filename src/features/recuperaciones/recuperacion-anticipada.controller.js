import { recuperacionAnticipadaService } from './recuperacion-anticipada.service.js';
import { catchAsync } from '../../shared/utils/catchAsync.util.js';
import { apiResponse } from '../../shared/utils/response.util.js';
import { ApiError } from '../../shared/utils/error.util.js';

const obtenerClases = catchAsync(async (req, res) => {
    const { id: alumnoId } = req.user;
    const data = await recuperacionAnticipadaService.obtenerClasesAnticipables(alumnoId);
    return apiResponse.success(res, { data, message: 'Próximas clases obtenidas.' });
});

const marcarFalta = catchAsync(async (req, res) => {
    const { id: alumnoId } = req.user;
    const { registroId, horarioDestinoId, fechaProgramada } = req.body || {};

    if (!registroId) {
        throw new ApiError('Falta el dato obligatorio registroId.', 400);
    }

    const data = await recuperacionAnticipadaService.marcarFaltaAnticipada(alumnoId, {
        registroId,
        horarioDestinoId,
        fechaProgramada,
    });

    return apiResponse.created(res, {
        data,
        message: data.agendada
            ? 'Falta avisada y recuperación agendada.'
            : 'Falta avisada. Tu ticket de recuperación quedó pendiente.',
    });
});

const cancelarFalta = catchAsync(async (req, res) => {
    const { id: alumnoId } = req.user;
    const data = await recuperacionAnticipadaService.cancelarFaltaAnticipada(alumnoId, req.params.registroId);
    return apiResponse.success(res, { data, message: 'Aviso de falta cancelado.' });
});

export const recuperacionAnticipadaController = {
    obtenerClases,
    marcarFalta,
    cancelarFalta,
};

