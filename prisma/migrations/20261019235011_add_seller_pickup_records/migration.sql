-- CreateEnum
CREATE TYPE "SellerPickupStatus" AS ENUM ('SCHEDULED', 'PICKED_UP', 'PROCESSING', 'COMPLETED');

-- CreateTable
CREATE TABLE "seller_pickup" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "pickedUpAt" TIMESTAMP(3),
    "status" "SellerPickupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "location" VARCHAR(500),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_pickup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_pickup_reference_key" ON "seller_pickup"("reference");

-- CreateIndex
CREATE INDEX "seller_pickup_businessId_status_scheduledAt_idx" ON "seller_pickup"("businessId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "seller_pickup_businessId_clientId_idx" ON "seller_pickup"("businessId", "clientId");

-- AddForeignKey
ALTER TABLE "seller_pickup" ADD CONSTRAINT "seller_pickup_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_pickup" ADD CONSTRAINT "seller_pickup_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
