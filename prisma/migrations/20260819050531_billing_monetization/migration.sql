-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('CREATED', 'APPROVED', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "limits" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT,
    "providerPriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "priceId" TEXT,
    "provider" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "userId" TEXT,
    "subscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "processedAt" TIMESTAMP(3),
    "payloadHash" TEXT,
    "metadata" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "durationMonths" INTEGER NOT NULL DEFAULT 3,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" INTEGER NOT NULL,
    "maxRedemptions" INTEGER NOT NULL,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "eligiblePlanCodes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "OfferRedemption" (
    "id" TEXT NOT NULL,
    "offerCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "OfferRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "offerCode" TEXT,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerApprovalUrl" TEXT,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL DEFAULT 'ai_actions',
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "Plan_active_sortOrder_idx" ON "Plan"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "Price_active_idx" ON "Price"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Price_planId_interval_currency_key" ON "Price"("planId", "interval", "currency");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_provider_providerSubscriptionId_key" ON "Subscription"("provider", "providerSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingEvent_eventType_createdAt_idx" ON "BillingEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEvent_userId_createdAt_idx" ON "BillingEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_provider_providerEventId_key" ON "BillingEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "OfferRedemption_userId_idx" ON "OfferRedemption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferRedemption_offerCode_userId_key" ON "OfferRedemption"("offerCode", "userId");

-- CreateIndex
CREATE INDEX "CheckoutSession_userId_status_idx" ON "CheckoutSession"("userId", "status");

-- CreateIndex
CREATE INDEX "CheckoutSession_provider_providerOrderId_idx" ON "CheckoutSession"("provider", "providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_userId_idempotencyKey_key" ON "CheckoutSession"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageCounter_userId_periodKey_idx" ON "UsageCounter"("userId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_userId_periodKey_metric_key" ON "UsageCounter"("userId", "periodKey", "metric");

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "Price"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_offerCode_fkey" FOREIGN KEY ("offerCode") REFERENCES "Offer"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "Price"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
