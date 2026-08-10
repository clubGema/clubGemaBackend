-- AlterTable
ALTER TABLE "inscripciones_deudas_link" ADD COLUMN     "es_estimado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fecha_fin_ciclo" DATE,
ADD COLUMN     "fecha_inicio_ciclo" DATE;
