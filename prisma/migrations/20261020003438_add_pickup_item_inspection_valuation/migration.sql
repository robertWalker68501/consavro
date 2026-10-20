-- CreateEnum
CREATE TYPE "PickupItemCondition" AS ENUM ('UNKNOWN', 'NEW', 'USED');

-- CreateEnum
CREATE TYPE "PickupItemCompleteness" AS ENUM ('UNKNOWN', 'COMPLETE', 'INCOMPLETE');

-- AlterTable
ALTER TABLE "seller_pickup_item" ADD COLUMN     "askingPrice" DECIMAL(12,2),
ADD COLUMN     "completeness" "PickupItemCompleteness" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "condition" "PickupItemCondition" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "estimatedValue" DECIMAL(12,2),
ADD COLUMN     "inspectionNotes" TEXT;
