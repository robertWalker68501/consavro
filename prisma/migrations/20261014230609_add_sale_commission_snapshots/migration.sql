-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "commissionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "consignorId" TEXT,
ADD COLUMN     "consignorName" TEXT,
ADD COLUMN     "consignorProceeds" DECIMAL(12,2) NOT NULL DEFAULT 0;
