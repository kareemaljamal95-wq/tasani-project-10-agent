#!/bin/sh
# Container entrypoint: apply migrations, then start the server.
#
# `set -e` matters here — without it a failed migration would be logged and the
# server would start anyway, serving traffic against a database whose shape
# does not match the code.
set -e

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Starting Tasami OS..."
exec node server.js
