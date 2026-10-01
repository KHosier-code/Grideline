#!/usr/bin/env bash
# Posts the site's watch-list alerts since STARTED_AT to its ntfy.sh topic
# (NTFY_TOPIC on the server), oldest first. Each workflow asks only for
# alerts since its own start, so an alert goes out once. Never fails the job.
set -u
[ -n "${GRIDLINE_INGEST_URL:-}" ] && [ -n "${STARTED_AT:-}" ] || { echo "No site URL or start time; skipping alerts."; exit 0; }
site="${GRIDLINE_INGEST_URL%/}"
if ! curl -fsS "$site/api/consumer/watch-alerts?since=$STARTED_AT" -o alerts.json; then
  echo "Could not read watch-list alerts; skipping."
  exit 0
fi
topic=$(jq -r '.ntfyTopic // empty' alerts.json)
echo "$(jq '.alerts | length' alerts.json) alert(s) since $STARTED_AT${topic:+, sending to ntfy.sh/$topic}"
jq -c '.alerts | reverse | .[]' alerts.json | while read -r alert; do
  title=$(jq -r '{"flagged": "New watch-list game", "moved-toward": "Line moved toward Gridline", "moved-away": "Line moved away from Gridline"}[.kind]' <<<"$alert")
  message=$(jq -r .message <<<"$alert")
  echo "- $title: $message"
  [ -n "$topic" ] || continue
  curl -sS -o /dev/null -H "Title: $title" -H "Tags: football" -H "Click: $site/performance#watch-list" \
    -d "$message" "https://ntfy.sh/$topic" || echo "  (ntfy post failed)"
done
exit 0
