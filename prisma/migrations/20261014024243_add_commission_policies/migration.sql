-- AlterTable
ALTER TABLE "business" ADD COLUMN     "defaultCommissionRate" DECIMAL(5,2) NOT NULL DEFAULT 30.00;

-- AlterTable
ALTER TABLE "client" ADD COLUMN     "commissionRateOverride" DECIMAL(5,2);
