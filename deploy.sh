#!/bin/bash
# ============================================
# Deploy Tasami OS to Google Cloud Run
# استخدم هذا السكريبت في Google Cloud Shell
# ============================================

set -e

echo "================================="
echo "🚀 Tasami OS - Google Cloud Deploy"
echo "================================="

# 1. تكوين المتغيرات
PROJECT_ID=$(gcloud config get-value project)
REGION="me-central1"  # قطر - الأقرب للوطن العربي
SERVICE_NAME="tasami-os"

echo "📦 Project: $PROJECT_ID"
echo "📍 Region: $REGION"

# 2. تفعيل الخدمات المطلوبة
echo "🔧 Enabling APIs..."
gcloud services enable \
  cloudrun.googleapis.com \
  sqladmin.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

# 3. إنشاء قاعدة بيانات PostgreSQL
echo "🗄️  Creating Cloud SQL instance..."
gcloud sql instances create tasami-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=$REGION \
  --availability-type=zonal \
  --root-password=tasami-secure-password-2025

gcloud sql databases create tasami \
  --instance=tasami-db

# 4. إنشاء Cloud SQL connector (بين Cloud Run و Cloud SQL)
echo "🔌 Setting up Cloud SQL connection..."

# 5. تخزين المفاتيح السرية
echo "🔐 Storing secrets..."
echo -n "your-gemini-api-key" | gcloud secrets create gemini-api-key --data-file=-
echo -n "your-openai-api-key" | gcloud secrets create openai-api-key --data-file=-
echo -n "your-anthropic-api-key" | gcloud secrets create anthropic-api-key --data-file=-
echo -n "nextauth-secret-value" | gcloud secrets create nextauth-secret --data-file=-

# 6. منح الصلاحيات
echo "🔑 Granting permissions..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 7. بناء ونشر على Cloud Run
echo "🐳 Building & deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --source=. \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --add-cloudsql-instances=$PROJECT_ID:$REGION:tasami-db \
  --set-env-vars="DATABASE_URL=postgresql://postgres:tasami-secure-password-2025@localhost:5432/tasami?schema=public" \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="NEXT_PUBLIC_APP_URL=https://$SERVICE_NAME-$PROJECT_NUMBER.$REGION.run.app" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest" \
  --set-secrets="OPENAI_API_KEY=openai-api-key:latest" \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest" \
  --set-secrets="NEXTAUTH_SECRET=nextauth-secret:latest" \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10

# 8. تشغيل الترحيلات (migrations)
echo "🔄 Running Prisma migrations..."
gcloud run jobs execute $SERVICE_NAME-migrate --wait

# 9. عرض رابط التطبيق
echo "================================="
echo "✅ Deployment complete!"
echo "🌐 URL: $(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')"
echo "================================="
