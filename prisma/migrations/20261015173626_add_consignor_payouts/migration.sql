-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('CASH', 'CHECK', 'BANK_TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "payout" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "reference" VARCHAR(200),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_saleId_key" ON "payout"("saleId");

-- CreateIndex
CREATE INDEX "payout_businessId_paidAt_idx" ON "payout"("businessId", "paidAt");

-- CreateIndex
CREATE INDEX "payout_businessId_clientId_idx" ON "payout"("businessId", "clientId");

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
