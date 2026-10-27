#!/usr/bin/env bash
# Commits data/public/ once (only if it changed) and pushes it to the branch, then prints the
# pushed SHA as `sha=<sha>` to $GITHUB_OUTPUT. On a rejected push it fetches, resets to the
# upstream branch, re-runs the publish command, commits if changed and retries: 3 attempts in all.
#
# Env:
#   PUBLISH_CMD      command that regenerates data/public/ (default: npm run pipeline)
#   GIT_AUTH_HEADER  optional `AUTHORIZATION: …` header, passed to git fetch/push only, scoped to
#                    https://github.com/ so git never sends it to any other host
#   REMOTE           remote name or URL (default: origin)
#   BRANCH           branch to push to (default: main)
#   GITHUB_OUTPUT    optional file the `sha=` line is appended to
set -euo pipefail

PUBLISH_CMD="${PUBLISH_CMD:-npm run pipeline}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
ATTEMPTS=3
BOT_NAME='github-actions[bot]'
BOT_EMAIL='41898282+github-actions[bot]@users.noreply.github.com'

# Keep the credential out of the environment of everything else this script runs (the publish
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
	local_git add -- data/public
	if ! local_git diff --cached --quiet -- data/public; then
		local_git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit --quiet -m 'data: publish snapshot' -- data/public
		echo "attempt $attempt: committed data/public/"
	else
		echo "attempt $attempt: data/public/ unchanged, nothing to commit"
	fi
	if remote_git push "$REMOTE" "HEAD:refs/heads/$BRANCH"; then
		sha="$(local_git rev-parse HEAD)"
		echo "pushed $sha to $BRANCH"
		echo "sha=$sha" >> "${GITHUB_OUTPUT:-/dev/null}"
		exit 0
	fi
	if [ "$attempt" -eq "$ATTEMPTS" ]; then break; fi
	echo "attempt $attempt: push rejected; resetting to $REMOTE/$BRANCH and publishing again" >&2
	remote_git fetch --quiet "$REMOTE" "$BRANCH"
	local_git reset --quiet --hard FETCH_HEAD
	sh -c "$PUBLISH_CMD"
done

echo "push to $BRANCH rejected $ATTEMPTS times; giving up" >&2
exit 1
