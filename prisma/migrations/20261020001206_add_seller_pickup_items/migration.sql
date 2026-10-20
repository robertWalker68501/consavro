-- CreateEnum
CREATE TYPE "SellerPickupItemKind" AS ENUM ('CATALOG_SET', 'UNIDENTIFIED_SET', 'BULK_LOT');

-- CreateTable
CREATE TABLE "seller_pickup_item" (
    "id" TEXT NOT NULL,
    "pickupId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "SellerPickupItemKind" NOT NULL,
    "legoSetId" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "setNumber" VARCHAR(40),
    "theme" VARCHAR(120),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_pickup_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_pickup_item_pickupId_createdAt_idx" ON "seller_pickup_item"("pickupId", "createdAt");

-- CreateIndex
CREATE INDEX "seller_pickup_item_businessId_pickupId_idx" ON "seller_pickup_item"("businessId", "pickupId");

-- CreateIndex
CREATE INDEX "seller_pickup_item_legoSetId_idx" ON "seller_pickup_item"("legoSetId");

-- AddForeignKey
ALTER TABLE "seller_pickup_item" ADD CONSTRAINT "seller_pickup_item_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "seller_pickup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_pickup_item" ADD CONSTRAINT "seller_pickup_item_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_pickup_item" ADD CONSTRAINT "seller_pickup_item_legoSetId_fkey" FOREIGN KEY ("legoSetId") REFERENCES "lego_set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
