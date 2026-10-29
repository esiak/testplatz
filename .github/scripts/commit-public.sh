#!/usr/bin/env bash
# Commits data/state/ and data/public/ in one commit (only if they changed) and pushes it to the
# branch, then prints the pushed SHA as `sha=<sha>` to $GITHUB_OUTPUT. On a rejected push it
# fetches the branch, then:
#   - if every upstream commit since the merge base touches only data/state/ or data/public/
#     (another pipeline run), it rebases onto the upstream and pushes again;
#   - otherwise, or when that rebase conflicts (it is aborted), it resets to the upstream, re-runs
#     the publish command (merge + publish from this run's saved reader results), commits if
#     changed and pushes again.
# 3 push attempts in all; no sha is output unless a push succeeded.
#
# Env:
#   PUBLISH_CMD      command that regenerates data/state/ and data/public/ (default: npm run pipeline)
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

DATA_DIRS=(data/state data/public)

# The data folders git can take as a pathspec: present on disk or tracked (a pathspec matching
# nothing makes `git add` / `git commit` fail).
data_paths() {
	local dir
	for dir in "${DATA_DIRS[@]}"; do
		if [ -e "$dir" ] || [ -n "$(local_git ls-files -- "$dir")" ]; then printf '%s\n' "$dir"; fi
	done
}

# True when the upstream tree changed since <base> only under data/state/ or data/public/. A tree
# diff (not `git log --name-only`) also sees changes made in merge commits and both sides of renames.
upstream_is_data_only() {
	local base="$1" path
	while IFS= read -r path; do
		[ -z "$path" ] && continue
		case "$path" in
			data/state/* | data/public/*) ;;
			*) return 1 ;;
		esac
	done < <(local_git diff --no-renames --name-only "$base" FETCH_HEAD)
	return 0
}

for attempt in $(seq 1 "$ATTEMPTS"); do
	paths=()
	while IFS= read -r path; do paths+=("$path"); done < <(data_paths)
	if [ "${#paths[@]}" -gt 0 ]; then local_git add -A -- "${paths[@]}"; fi
	if [ "${#paths[@]}" -gt 0 ] && ! local_git diff --cached --quiet -- "${paths[@]}"; then
		local_git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit --quiet -m 'data: publish snapshot' -- "${paths[@]}"
		echo "attempt $attempt: committed data/state/ and data/public/"
	else
		echo "attempt $attempt: data/state/ and data/public/ unchanged, nothing to commit"
	fi
	if remote_git push "$REMOTE" "HEAD:refs/heads/$BRANCH"; then
		sha="$(local_git rev-parse HEAD)"
		echo "pushed $sha to $BRANCH"
		echo "sha=$sha" >> "${GITHUB_OUTPUT:-/dev/null}"
		exit 0
	fi
	if [ "$attempt" -eq "$ATTEMPTS" ]; then break; fi
	remote_git fetch --quiet "$REMOTE" "$BRANCH"
	base="$(local_git merge-base HEAD FETCH_HEAD || true)"
	if [ -n "$base" ] && upstream_is_data_only "$base"; then
		echo "attempt $attempt: push rejected; upstream changed only data/, rebasing onto $REMOTE/$BRANCH" >&2
		if local_git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" rebase --quiet --autostash FETCH_HEAD; then
			continue
		fi
		echo "attempt $attempt: rebase conflicted; aborting it" >&2
		local_git rebase --abort || true
	fi
	echo "attempt $attempt: resetting to $REMOTE/$BRANCH and publishing again" >&2
	local_git reset --quiet --hard FETCH_HEAD
	sh -c "$PUBLISH_CMD"
done

echo "push to $BRANCH rejected $ATTEMPTS times; giving up" >&2
exit 1
