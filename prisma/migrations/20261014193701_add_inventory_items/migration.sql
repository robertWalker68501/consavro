-- CreateTable
CREATE TABLE "inventory_item" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_item_businessId_archivedAt_idx" ON "inventory_item"("businessId", "archivedAt");

-- AddForeignKey
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
