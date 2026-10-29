# Operations

## Scheduled collection run

`.github/workflows/pipeline.yml` runs once a day at 05:17 UTC (`17 5 * * *`), on every push to
`main` and on manual dispatch, in one concurrency group that never cancels a run in progress.

The `publish` job:

1. type-checks and tests the checked-out commit;
2. runs `npm run pipeline -- --save-collect "$RUNNER_TEMP/collect.json"`: fetch → parse →
   normalise → merge → publish, saving this run's reader results (outcomes, visits, page
   summaries; no page bodies) for a retry;
3. runs `.github/scripts/commit-public.sh`, which commits `data/state/` and `data/public/` in one
   bot commit and pushes it. On a rejected push it rebases when the new upstream commits touch
   only `data/state/` or `data/public/`; otherwise (or when that rebase conflicts) it resets to the
   upstream and runs `PUBLISH_CMD` = type-check + test + `npm run pipeline -- --from-collect
   "$RUNNER_TEMP/collect.json"`, which replays merge and publish without fetching again. 3 push
   attempts in all.

`build` and `deploy` then deploy exactly the pushed SHA. No push, no deploy.

The run log has one line per centre: `<centre_id> <reader> <outcome> <listing count> <duration>`,
where the outcome is `ok`, `failed:<reason>` or `skipped:<reason>`, then a summary line.

## Home-machine fallback

When GitHub's scheduler is down or keeps starting runs late, run the publish job's steps from a
clone of the repository on a home machine (cron or by hand), with Node from `.nvmrc`: test, run
the pipeline saving its reader results to a fresh temp file, then commit and push with the same
replay retry as CI. Every step is chained with `&&`, so a failed test or pipeline run never
reaches the commit script, and the temp file is removed afterwards:

```sh
collect="$(mktemp)" &&
git switch main && git pull --ff-only &&
npm ci &&
npm run typecheck && npm test &&
npm run pipeline -- --save-collect "$collect" &&
GIT_AUTH_HEADER="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')" \
PUBLISH_CMD="npm run typecheck && npm test && npm run pipeline -- --from-collect '$collect'" \
.github/scripts/commit-public.sh
status=$?; rm -f "$collect"; exit $status
```

Run it as a script (for example `bash fallback.sh` from the clone's root), not pasted into an
interactive shell, because of the final `exit`.

- `TOKEN` is a **fine-grained personal access token** limited to this repository with
  **Contents: read and write** and nothing else. Keep it out of shell history and files in the
  clone (for example, read it from the system keychain into the variable).
- The script passes the header only to `git fetch` / `git push` for `https://github.com/`, so the
  clone's `origin` must be the HTTPS URL.
- The push is made with a personal token, so GitHub's push-triggered `pipeline.yml` run starts
  and deploys the new data. That run fetches again; the per-site budget (at most 4 visits per
  rolling 24 h, the visit log in `data/state/visits.json`) keeps both runs together within limits.
- The visit log counts every run, manual and local ones included. A fallback run on a day the
  scheduled run already ran uses one more of each site's 4 daily visits.
