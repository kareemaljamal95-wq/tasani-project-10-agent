-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_userId_externalSource_externalId_key" ON "Lead"("userId", "externalSource", "externalId");

-- AlterEnum
ALTER TYPE "AuditType" ADD VALUE 'discovery_scan';

