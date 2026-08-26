-- CreateTable
CREATE TABLE "GeneratedSite" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "name" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "theme" TEXT NOT NULL,
    "html" TEXT NOT NULL,

    CONSTRAINT "GeneratedSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedSite_userId_createdAt_idx" ON "GeneratedSite"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedSite_userId_leadId_idx" ON "GeneratedSite"("userId", "leadId");

-- AddForeignKey
ALTER TABLE "GeneratedSite" ADD CONSTRAINT "GeneratedSite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedSite" ADD CONSTRAINT "GeneratedSite_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
