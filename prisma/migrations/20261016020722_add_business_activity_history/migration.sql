-- CreateTable
CREATE TABLE "business_activity_event" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_activity_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_activity_event_businessId_createdAt_id_idx" ON "business_activity_event"("businessId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "business_activity_event" ADD CONSTRAINT "business_activity_event_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_activity_event" ADD CONSTRAINT "business_activity_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
