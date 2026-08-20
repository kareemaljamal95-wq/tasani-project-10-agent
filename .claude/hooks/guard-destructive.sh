#!/usr/bin/env bash
# PreToolUse(Bash) guard.
#
# Refuses the specific commands that have already cost this project work, and
# nothing else. A guard that blocks broadly gets switched off, so this stays
# narrow and each rule names a real incident.
#
# Reads the hook payload on stdin, prints a deny decision when a rule matches,
# and otherwise stays silent and exits 0.
set -uo pipefail

command_text=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$command_text" ] && exit 0

deny() {
  jq -nc --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# A database command is treated as local only when it says so explicitly.
# Absence of a host is not evidence of localhost — DATABASE_URL may point
# anywhere — so anything unqualified is treated as remote.
targets_local() {
  printf '%s' "$command_text" | grep -qE 'localhost|127\.0\.0\.1|/tmp|tasami_(test|shadow|rehearse)'
}

case "$command_text" in
  *"db push"*"--accept-data-loss"*|*"--accept-data-loss"*"db push"*)
    deny "prisma db push --accept-data-loss skips migration history and drops columns and tables to force the database to match schema.prisma. It was in this project's boot path once and is the reason docker-entrypoint.sh now runs 'prisma migrate deploy' under 'set -e'. Generate a migration instead."
    ;;
esac

case "$command_text" in
  *"migrate reset"*)
    targets_local || deny "prisma migrate reset drops the database and replays every migration. Nothing in this command names a local target, so it may be pointing at DATABASE_URL. Name the local database explicitly if that is what you meant."
    ;;
esac

# --force-with-lease is fine: it refuses when the remote moved, which is the
# whole protection. Bare --force / -f is not.
case "$command_text" in
  *"git push"*)
    if printf '%s' "$command_text" | grep -qE 'git push .*(--force([^-]|$)|(^| )-f( |$))'; then
      printf '%s' "$command_text" | grep -q -- '--force-with-lease' ||
        deny "git push --force discards commits on the remote without checking whether anyone else pushed. Use --force-with-lease, which refuses if the remote moved."
    fi
    ;;
esac

case "$command_text" in
  *"DROP DATABASE"*|*"DROP TABLE"*|*"dropdb "*|*"TRUNCATE"*)
    targets_local || deny "This command destroys data and nothing in it names a local target, so it may reach production. Name the local host or database explicitly if that is what you meant."
    ;;
esac

exit 0
