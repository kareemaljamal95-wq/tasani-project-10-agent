#!/usr/bin/env bash
# Vercel build: migrate, then build.
#
# `prisma migrate deploy && next build` was the first attempt and it is too
# blunt. Three things go wrong with it:
#
#  - It fails the whole build when DATABASE_URL is absent, with Prisma's
#    "Validation Error Count: 1", which says nothing about what to fix.
#  - It runs on preview deployments too, so a preview build migrates whatever
#    database the environment points at — usually production.
#  - Migrations cannot run over a transaction pooler (pgBouncer, Supabase :6543,
#    a Neon pooled host). The app wants the pooled URL; migrations need a direct
#    one.
#
# What it must NOT do is carry on quietly: with no migrations applied the app
# serves against a database whose shape does not match the code, and
# /api/health answers 200 because SELECT 1 succeeds on an empty database.
set -euo pipefail

# VERCEL_ENV is production, preview or development. Empty when run locally.
environment="${VERCEL_ENV:-local}"

run_migrations() {
  # A transaction pooler cannot run migrations. Set DIRECT_DATABASE_URL to the
  # direct (non-pooled) connection string when DATABASE_URL is pooled; without
  # one, DATABASE_URL is used as-is, which is correct for a direct connection.
  local url="${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}"

  if [ -z "$url" ]; then
    echo "BUILD FAILED: DATABASE_URL is not set for the $environment environment." >&2
    echo "" >&2
    echo "Migrations run during the build, so the database must be reachable now." >&2
    echo "Set DATABASE_URL in Vercel -> Settings -> Environment Variables." >&2
    echo "If it is a pooled connection (pgBouncer, :6543, a *-pooler host), also" >&2
    echo "set DIRECT_DATABASE_URL to the direct connection string — migrations" >&2
    echo "cannot run over a transaction pooler." >&2
    exit 1
  fi

  echo "Applying migrations ($environment)..."
  DATABASE_URL="$url" npx prisma migrate deploy
}

case "$environment" in
  preview)
    # A preview build shares the environment's DATABASE_URL, so migrating from
    # here would apply an unreviewed migration to the production database.
    # Opt in with RUN_MIGRATIONS_ON_PREVIEW=1 when previews have their own.
    if [ "${RUN_MIGRATIONS_ON_PREVIEW:-}" = "1" ]; then
      run_migrations
    else
      echo "Preview build: skipping migrations."
      echo "Set RUN_MIGRATIONS_ON_PREVIEW=1 if previews use a separate database."
    fi
    ;;
  *)
    run_migrations
    ;;
esac

npx next build
