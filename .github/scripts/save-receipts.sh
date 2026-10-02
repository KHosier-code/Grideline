#!/usr/bin/env bash
# Commits the payloads this run sent to the site to the `receipts` branch, as
# <season>/week-<NN>/<UTC time>-<kind>.json. The branch is append-only and its
# commits are timestamped by GitHub, so anyone can check a pick was posted
# before kickoff. Only payloads from steps that succeeded (were sent) are saved.
set -euo pipefail
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
files=()
[ "${TOUCHDOWNS:-}" = success ] && [ -f research/td-model/td_payload.json ] && files+=("research/td-model/td_payload.json:touchdowns")
if [ "${GAMES:-}" = success ]; then
  for file in research/game-model/games_payload_week*.json; do [ -f "$file" ] && files+=("$file:games"); done
fi
[ ${#files[@]} -gt 0 ] || { echo "Nothing was sent; no receipts to save."; exit 0; }

dir=$(mktemp -d)
if git ls-remote --exit-code --heads origin receipts >/dev/null; then
  git fetch --depth=1 origin receipts
  git worktree add --detach "$dir" FETCH_HEAD
else
  git worktree add --detach "$dir"
  git -C "$dir" checkout -q --orphan new-receipts
  git -C "$dir" rm -rfq --ignore-unmatch .
  printf '%s\n' "# Gridline receipts" "" \
    "Every model run's payload exactly as it was sent to the site, saved by the Weekly picks workflow." \
    "Folders are season/week; file names are the UTC time of the run. Nothing here is ever edited." > "$dir/README.md"
fi
for entry in "${files[@]}"; do
  file=${entry%%:*}; kind=${entry##*:}
  season=$(jq -r .season "$file"); week=$(jq -r .week "$file")
  dest="$dir/$season/week-$(printf %02d "$week")"
  mkdir -p "$dest"
  cp "$file" "$dest/$stamp-$kind.json"
  echo "Saved $dest/$stamp-$kind.json"
done
git -C "$dir" add -A
git -C "$dir" -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -qm "Receipts $stamp"
git -C "$dir" push origin HEAD:refs/heads/receipts
