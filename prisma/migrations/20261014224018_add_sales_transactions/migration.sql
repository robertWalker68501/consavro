-- CreateTable
CREATE TABLE "sale" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_businessId_soldAt_idx" ON "sale"("businessId", "soldAt");

-- CreateIndex
CREATE INDEX "sale_businessId_inventoryItemId_idx" ON "sale"("businessId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
