-- AlterTable
ALTER TABLE "inscripciones" ADD COLUMN     "fecha_clase_suelta" DATE,
ADD COLUMN     "tipo_inscripcion" VARCHAR(20) DEFAULT 'REGULAR';

-- CreateTable
CREATE TABLE "movimientos_financieros" (
    "id" SERIAL NOT NULL,
    "tipo_movimiento" VARCHAR(10) NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "concepto" VARCHAR(150) NOT NULL,
    "metodo_pago_id" INTEGER,
    "fecha_movimiento" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comprobante_url" VARCHAR(255),
    "registrado_por" INTEGER,
    "notas" TEXT,

    CONSTRAINT "movimientos_financieros_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "metodos_pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "administrador"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;
