-- CreateTable
CREATE TABLE "anuncios_beneficios" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "titulo" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(255) NOT NULL,
    "icono" VARCHAR(50) NOT NULL DEFAULT 'Gift',
    "gradiente" VARCHAR(100) NOT NULL DEFAULT 'from-[#1e3a8a] to-blue-600',
    "badge" VARCHAR(50) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anuncios_beneficios_pkey" PRIMARY KEY ("id")
);
