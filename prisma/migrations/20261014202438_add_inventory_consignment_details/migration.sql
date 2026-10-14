-- CreateEnum
CREATE TYPE "LegoCondition" AS ENUM ('NEW_SEALED', 'NEW_OPEN_BOX', 'USED');

-- CreateEnum
CREATE TYPE "LegoCompleteness" AS ENUM ('COMPLETE', 'INCOMPLETE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "inventory_item" ADD COLUMN     "askingPrice" DECIMAL(12,2),
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "completeness" "LegoCompleteness",
ADD COLUMN     "condition" "LegoCondition",
ADD COLUMN     "estimatedValue" DECIMAL(12,2),
ADD COLUMN     "setNumber" TEXT,
ADD COLUMN     "theme" TEXT;

-- CreateIndex
CREATE INDEX "inventory_item_businessId_clientId_idx" ON "inventory_item"("businessId", "clientId");

-- AddForeignKey
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
