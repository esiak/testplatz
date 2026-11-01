#!/usr/bin/env bash
# Records a failed collecting run's visits on main (Story 3.11): fetches the branch, resets to it,
# runs the record command (adds this run's visits to data/state/visits.json), commits only that
# file (if it changed) and pushes it. On a rejected push it repeats fetch, reset and record. 3 push
# attempts in all. Nothing but data/state/visits.json is ever committed: the reset discards the
# failed run's tracked changes and local commits, and only that file is ever added (`git reset
# --hard` keeps untracked files, which therefore stay out of the commit).
#
# Env:
#   RECORD_CMD       command that adds the run's visits to data/state/visits.json (required)
#   GIT_AUTH_HEADER  optional `AUTHORIZATION: …` header, passed to git fetch/push only, scoped to
#                    https://github.com/ so git never sends it to any other host
#   REMOTE           remote name or URL (default: origin)
#   BRANCH           branch to push to (default: main)
set -euo pipefail

: "${RECORD_CMD:?RECORD_CMD is required}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
ATTEMPTS=3
BOT_NAME='github-actions[bot]'
BOT_EMAIL='41898282+github-actions[bot]@users.noreply.github.com'
VISITS=data/state/visits.json

# Keep the credential out of the environment of everything else this script runs (the record
# command, git commit/reset); it reaches git only as a command-line config on fetch/push.
auth_header="${GIT_AUTH_HEADER:-}"
unset GIT_AUTH_HEADER

# Every git call runs with hooks disabled, so no hook sees the credential or alters the commit.
local_git() { git -c core.hooksPath=/dev/null "$@"; }
remote_git() {
	if [ -n "$auth_header" ]; then
		git -c core.hooksPath=/dev/null -c "http.https://github.com/.extraheader=$auth_header" "$@"
	else
		git -c core.hooksPath=/dev/null "$@"
	fi
}

for attempt in $(seq 1 "$ATTEMPTS"); do
	remote_git fetch --quiet "$REMOTE" "$BRANCH"
	local_git reset --quiet --hard FETCH_HEAD
	sh -c "$RECORD_CMD"
	local_git add -- "$VISITS"
	if local_git diff --cached --quiet -- "$VISITS"; then
		echo "attempt $attempt: $VISITS already holds this run's visits, nothing to commit"
		exit 0
	fi
	local_git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit --quiet -m 'data: record visits from a failed run' -- "$VISITS"
	echo "attempt $attempt: committed $VISITS"
	if remote_git push "$REMOTE" "HEAD:refs/heads/$BRANCH"; then
		echo "pushed $(local_git rev-parse HEAD) to $BRANCH"
		exit 0
	fi
	echo "attempt $attempt: push rejected; fetching $REMOTE/$BRANCH and recording again" >&2
done

echo "push to $BRANCH rejected $ATTEMPTS times; giving up" >&2
exit 1
