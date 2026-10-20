-- CreateEnum
CREATE TYPE "LegoCatalogSource" AS ENUM ('MANUAL', 'REBRICKABLE');

-- CreateEnum
CREATE TYPE "LegoSetVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "inventory_item" ADD COLUMN     "legoSetId" TEXT;

-- CreateTable
CREATE TABLE "lego_set" (
    "id" TEXT NOT NULL,
    "setNumber" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "theme" VARCHAR(120),
    "releaseYear" INTEGER,
    "pieceCount" INTEGER,
    "imageUrl" TEXT,
    "source" "LegoCatalogSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" VARCHAR(100),
    "sourceUrl" TEXT,
    "verificationStatus" "LegoSetVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lego_set_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lego_set_setNumber_key" ON "lego_set"("setNumber");

-- CreateIndex
CREATE INDEX "lego_set_name_idx" ON "lego_set"("name");

-- CreateIndex
CREATE INDEX "lego_set_theme_releaseYear_idx" ON "lego_set"("theme", "releaseYear");

-- CreateIndex
CREATE INDEX "lego_set_source_externalId_idx" ON "lego_set"("source", "externalId");

-- CreateIndex
CREATE INDEX "inventory_item_legoSetId_idx" ON "inventory_item"("legoSetId");

-- AddForeignKey
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_legoSetId_fkey" FOREIGN KEY ("legoSetId") REFERENCES "lego_set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
