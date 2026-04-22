-- AlterTable
ALTER TABLE "inscripciones" ADD COLUMN     "id_grupo_transaccion" UUID;

-- CreateTable
CREATE TABLE "inscripciones_deudas_link" (
    "id" SERIAL NOT NULL,
    "inscripcion_id" INTEGER NOT NULL,
    "cuenta_id" INTEGER NOT NULL,
    "monto_asignado" DECIMAL(10,2) NOT NULL,
    "creado_en" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inscripciones_deudas_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inscripciones_deudas_link_inscripcion_id_idx" ON "inscripciones_deudas_link"("inscripcion_id");

-- CreateIndex
CREATE INDEX "inscripciones_deudas_link_cuenta_id_idx" ON "inscripciones_deudas_link"("cuenta_id");

-- AddForeignKey
ALTER TABLE "inscripciones_deudas_link" ADD CONSTRAINT "inscripciones_deudas_link_inscripcion_id_fkey" FOREIGN KEY ("inscripcion_id") REFERENCES "inscripciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscripciones_deudas_link" ADD CONSTRAINT "inscripciones_deudas_link_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuentas_por_cobrar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
