-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "inventoryQuantityBefore" INTEGER,
ADD COLUMN     "inventoryStatusBefore" "InventoryStatus";
