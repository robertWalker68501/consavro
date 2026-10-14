-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'SOLD');

-- AlterTable
ALTER TABLE "inventory_item" ADD COLUMN     "status" "InventoryStatus" NOT NULL DEFAULT 'IN_STOCK';

-- CreateIndex
CREATE INDEX "inventory_item_businessId_status_idx" ON "inventory_item"("businessId", "status");
