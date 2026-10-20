CREATE TYPE "PickupProcessingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'READY', 'ON_HOLD');
ALTER TABLE "seller_pickup_item" ADD COLUMN "processingStatus" "PickupProcessingStatus" NOT NULL DEFAULT 'PENDING', ADD COLUMN "inventoryItemId" TEXT;
CREATE UNIQUE INDEX "seller_pickup_item_inventoryItemId_key" ON "seller_pickup_item"("inventoryItemId");
ALTER TABLE "seller_pickup_item" ADD CONSTRAINT "seller_pickup_item_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
