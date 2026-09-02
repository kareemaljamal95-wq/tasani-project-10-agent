-- AlterTable
ALTER TABLE "GeneratedSite" ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "sharedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedSite_shareToken_key" ON "GeneratedSite"("shareToken");

