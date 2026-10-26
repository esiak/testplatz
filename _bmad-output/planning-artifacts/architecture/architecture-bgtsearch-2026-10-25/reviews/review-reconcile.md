---
review: reconcile
target: ../ARCHITECTURE-SPINE.md
inputs:
  - ../../../../specs/spec-einbuergerungstest-search/SPEC.md
  - ../../../../specs/spec-einbuergerungstest-search/data-sources.md
  - ../../../ux-designs/ux-bgtsearch-2026-10-25/EXPERIENCE.md
date: 2026-10-26
verdict: revise-before-build
---

# Reconciliation review: spine vs SPEC, data-sources, EXPERIENCE

## Verdict

**Revise before build.** The paradigm and most ADs hold up. The spine covers the hard parts well: AD-4 zero-dates proof, AD-6 history, AD-8 one card per centre, and AD-2 location. The gaps are in the contracts. Neither the places table shape nor the snapshot's centre and system fields is specified. Several derived values (per-system status, link fallback, address fallback, deadline "Passed", the freshness source) have no stated owner, so the pipeline and web builders could each choose differently. There are also two privacy/politeness contradictions: `q` in the query string, and tools/ HTTP bypassing AD-5. Out-of-Bavaria detection can't be built from a Bavaria-only places table.

Severity counts: critical 0 · high 6 · medium 11 · low 6.

---

## High

### H1. Places table has no contract, yet it carries four UI features
**Inputs:** EXPERIENCE Place suggestions (umlaut/spelling folding, same-name towns show postcode **and district**, max 6), "Did you mean …?" (up to three), Enter without a pick (exact postcode), "use my location" → nearest town; data-sources User location.
**Spine:** AD-1/AD-2 name `places.json`. AD-9 defines only the snapshot schema. Deferred covers only the *source dataset*.
**Risk:** `tools/build-places` and `web/` will choose different field names. They will also differ on whether one row is a town (with many postcodes) or a postcode, whether district is present, and whether a normalised search key is precomputed or derived in the browser. "Did you mean" (fuzzy/edit distance) and folding ("Gunzburg"/"Guenzburg" → Günzburg) need agreed normalisation rules.
**Fix:** Add to AD-9: "`places.json` is the second public contract, defined as a zod schema in `shared/` and validated by `tools/build-places`." Fix the row shape: `{ name, postcodes[], district, lat, lon, key }`. `key` is produced by one `shared/normalise-place-name` function (lowercase; ä→a|ae, ö→o|oe, ü→u|ue, ß→ss). web and tools both use that function. State that "Did you mean" is computed in web over `key`, and that exact postcode match beats name match. Move the dataset choice to Deferred, not the shape.

### H2. Out-of-Bavaria detection has no data behind it
**Inputs:** EXPERIENCE "Place outside Bavaria": a typed place *and* a device location outside Bavaria both get the "Bavaria only" message. SPEC constraint "Bavaria only".
**Spine:** silent. With a Bavaria-only places table, typing "Ulm" (BW, next to Neu-Ulm) or "Mannheim" can only produce *place-not-found*. Geolocation from Ulm would silently snap to the nearest Bavarian town ("Near Neu-Ulm"), which is wrong in a way users can't see.
**Fix:** Add a rule (AD-2 or a new AD) that names the mechanism. (a) For typed input, add a small "non-Bavarian names/postcodes" lookup (all-Germany PLZ→state, or Gemeinde names with a `state` field). It is shipped in the same places file with `in_bavaria: false` rows, which are matchable but never searchable. (b) For geolocation, ship a simplified Bavaria boundary polygon, run point-in-polygon in the browser, and only then do the nearest-town lookup. Both stay same-origin and static, so AD-1 holds. If the team rejects this, the spine must say so explicitly and EXPERIENCE must drop the state.

### H3. `q` in the query string sends the user's place to the host, and possibly to third parties
**Inputs:** SPEC "The user's location never leaves the browser". EXPERIENCE URL `?q=Neu-Ulm&r=40…`. After geolocation, `q` = nearest town.
**Spine:** AD-2 bans coordinates in URLs but allows `q` in the URL. A query string goes out in the page request, so GitHub Pages receives and logs the typed town, or the town derived from geolocation, on every shared-link open and reload. Cross-origin taps (provider site, Google Maps) could leak it through `Referer` if the referrer policy is ever loosened.
**Fix:** In AD-2, either (a) carry search state in the fragment (`#q=Neu-Ulm&r=40&sort=soonest&lang=en`), which is never sent to any server, or (b) explicitly accept that the host sees `q` and record this for the privacy policy. Either way, pin `<meta name="referrer" content="no-referrer">` (or `strict-origin`) and `rel="noopener noreferrer"` on external links. Recommend (a); EXPERIENCE's `?` is only an example.

### H4. Freshness source: `last_checked_at` vs `last_success_at` is ambiguous, and a failing centre could look fresh
**Inputs:** SPEC CAP-5 "Each listing shows 'last checked'"; CAP-10 "its last-checked time". data-sources puts `last_checked_at` **per listing**, "per collection run". EXPERIENCE Freshness line = "last **successful** check of that centre's source".
**Spine:** AD-6 says `last_checked_at` is always set and `last_success_at` only on `ok`, both per centre. AD-11 says the switch to exact time is driven by `last_success_at`. Nothing says which field the *displayed* text uses. A builder following data-sources literally would show "Checked 1 h ago" on a centre whose reader has been failing for two days, which breaks "a gap must never read as nothing available / current".
**Fix:** Add to AD-11: "The freshness line displays `last_success_at` (per centre). `last_checked_at` is diagnostic only and not shown." State that the per-listing `last_checked_at` in data-sources is replaced by the centre-level fields, and note the deviation. Also define the never-succeeded case: covered, `last_success_at = null` → no-dates card with "Not checked yet" (new i18n key), never "No dates listed".

### H5. Snapshot centre and system fields are unspecified; per-system status has no derivation
**Inputs:** EXPERIENCE About "Booking systems" table: per system: centres covered, last successful run, "Working" / "Not updated since Tue 14:00". State "System failing". The destination line shows a domain. The uncovered list sits on About.
**Spine:** the ERD shows `SNAPSHOT ||--|{ READER_SYSTEM : "status per system"` and nothing more. There are no fields, and nothing defines when a system is "working". Is its last success the latest run where all, any, or ≥ X % of centres were `ok`? Is the threshold 12 h (UI) or 24 h (the issue alert)? Is it computed in publish or in the browser (AD-11 says thresholds are computed in the browser)?
**Fix:** Add to AD-9 the snapshot top-level shape: `{ schemaVersion, generated_at, systems[], centres[], listings[] }`. Use `centre = { id, name, address, lat, lon, website, test_page_url, reader, coverage, last_success_at|null, last_checked_at }` and `system = { reader, centres_covered, last_success_at }`, where `last_success_at` = the latest run in which ≥ 1 (or a stated %) of that system's centres returned `ok`. Add to AD-11: "Working" if `now − system.last_success_at ≤ 12 h`, else "Not updated since …", computed in the browser. Align the >24 h issue alert with the same definition.

### H6. tools/ makes outbound HTTP, which contradicts AD-5 and the import graph
**Inputs:** data-sources: Nominatim geocoding (≤ 1 req/s, attribution), monthly directory diff against rtpartner/BAMF.
**Spine:** AD-5 says "*All* outbound HTTP goes through `pipeline/fetch`". The import graph allows only `tools → shared`, so `tools/geocode` and `tools/directory-diff` can't use `pipeline/fetch`. They will write their own HTTP clients, with their own UA and rate limiting.
**Fix:** Either move polite-fetch to `shared/fetch` (or a `net/` layer importable by stages and tools), or narrow AD-5 to "all *pipeline* HTTP". In the second case, add a tools rule: identified UA, ≤ 1 req/s to Nominatim per its usage policy, results cached in the directory, no bulk re-geocoding. Prefer the first option: one HTTP path.

---

## Medium

### M1. link_ok: when it is checked, what it costs, and who resolves the fallback
**Inputs:** data-sources `link_ok`: if false, the UI links to `test_page_url`. CAP-2: "if the date's page was unreachable at the last check, the link opens the centre's test page". EXPERIENCE destination line "Opens the centre's test page".
**Spine:** AD-5 only says the link check uses the same path. It doesn't say whether every `source_url` is HEAD/GET-checked on every run, which multiplies requests per site against the "≤ 4 checks per site per day" constraint. It doesn't say whether a page the reader already fetched counts as proof. It doesn't say whether publish emits the resolved URL or the UI picks, or what happens to `link_ok` on a `failed` run (keep the previous value?).
**Fix:** Add a rule (AD-5/AD-6): "`link_ok` is true if the reader fetched `source_url` successfully this run. Otherwise one GET is made per listing per run, counted in the per-host budget. On a `failed` run, the previous `link_ok` is kept. The snapshot carries `source_url` and `link_ok`; the web resolves `link_ok ? source_url : centre.test_page_url` in one shared helper." Clarify that "check" in the politeness constraint means a run, not a request.

### M2. Listing address fallback and distance basis
**Inputs:** data-sources `address`: "full street address of the test location; falls back to the centre address". CAP-1: each result shows km and a Maps link to its address.
**Spine:** silent. The test location may differ from the centre address (an Außenstelle). Only directory addresses are geocoded, so km is from centre coordinates while the Maps link points at the listing address. Two builders could also put the fallback in normalise or in the UI.
**Fix:** In AD-9: "normalise fills `listing.address` from `centre.address` when the reader gives none, so the snapshot address is always present. Distance is always from centre coordinates. The Maps link uses `listing.address`." Optionally add `address_is_fallback`. Accept the km mismatch for Außenstellen in v1 and say so.

### M3. Deadline representation and "Passed"
**Inputs:** data-sources deadline optional, "`unknown` if not published". EXPERIENCE "11 Nov" / "Passed" / "unknown", and the card stays.
**Spine:** AD-11 requires `deadline` as ISO 8601 with an offset, but providers publish date-only deadlines. It doesn't say what time the deadline falls at (the "Passed" boundary on the deadline day), whether absence is `null` or the string `unknown`, or that "Passed" is computed in the browser (it could otherwise get frozen at publish, like the thresholds AD-11 already guards against).
**Fix:** In AD-11: "`deadline` is a date `YYYY-MM-DD` (Europe/Berlin) or `null`. It is 'Passed' when today in Europe/Berlin is after the deadline date, computed in the browser. Publish never drops a listing for a passed deadline." In AD-9/AD-10: unknown optional fields are `null`, never a string code. `registration_method: null` renders "see website", `deadline: null` renders "unknown".

### M4. Where status mapping and waitlist detection happen
**Inputs:** data-sources status mapping: "Any system: Warteliste → `waitlist`", per-system rules for KuferWeb and ITEM KG (in-person only → `unknown`).
**Spine:** AD-10 lists `status` as a code but doesn't enumerate the codes. AD-3 returns `RawListing` without saying whether status is raw or already coded, so the cross-system waitlist rule could be implemented twice or not at all.
**Fix:** In AD-10, list the codes: `status ∈ {free, booked_out, waitlist, unknown}`, `registration_method ∈ {online, email, post, in_person}`, `coverage`, `reader ∈ {kuferweb, itemkg, none}`. In AD-3, either the reader emits the final `status` code using its system rules plus a shared `detectWaitlist(text)` from `shared/`, or the reader emits raw signals and normalise maps them. Pick one; the first is recommended, and each reader's fixtures should include a waitlist case.

### M5. Opted-out centres with leftover listings, and opt-out scope
**Inputs:** CAP-8: no further requests, and the centre shows as "not checked automatically".
**Spine:** AD-8 derives cards from coverage and listings, but the order checked is "dated listings → result cards" first. A centre that opts out after having listings would keep its stale history in state and could still render result cards. Opt-out is also per centre, while fetch and robots are per host. Two centres sharing a host (Außenstellen, a shared ITEM KG host) would leave the site still being requested.
**Fix:** In AD-8: "`not_checked` centres publish zero listings, whatever is in state." In AD-5: fetch also skips any host where any centre on it has `opted_out` (or opt-out is recorded per host). Also say whether the uncovered card's `test_page_url` link is ever link-checked for opted-out centres (it must not be).

### M6. robots.txt disallow should mean not_checked, not stale forever
**Inputs:** data-sources reader `none` includes "blocked automated fetch". The politeness constraint says robots is respected.
**Spine:** AD-5 checks robots, but a disallowed covered centre would surface as a reader `failed`. Its listings would be stale forever and it would count toward the system as "failing".
**Fix:** In AD-5/AD-8: a robots disallow (or a persistent 403 to the bot) gives a distinct result `blocked`. Publish maps it to `coverage: not_checked`, and it is excluded from system health. The operator is notified so the directory reader can be changed to `none`.

### M7. Politeness budget versus dev runs, reruns and fallback runners
**Inputs:** SPEC ≤ 4 checks per site per day.
**Spine:** the 4 cron runs use the whole budget. `npm run pipeline` locally, `workflow_dispatch` reruns, and the self-hosted fallback runner can each exceed it.
**Fix:** In AD-5/config: local runs default to fixtures or a cached fetch (`--live` opt-in). The fetch layer records the last fetch time per host in `data/state/` and refuses a host fetched less than 5 h ago, whoever runs the job.

### M8. "New" badge flood on first run or when a reader is added
**Inputs:** CAP-6: first seen within 24 h → "new".
**Spine:** AD-6 sets `first_seen_at` on insert. On the first ever run, or the first run after a centre gains a reader, every existing date would be "new", which is misleading.
**Fix:** In AD-6: listings inserted on a centre's first successful run get `first_seen_at` set but are marked `seeded: true` (or the centre stores `covered_since`). The UI shows "new" only if `first_seen_at − covered_since > 0`.

### M9. Listing id collisions and time changes
**Spine:** AD-6 id = `centre_id@starts_at minute`. Two sessions at the same centre and minute (different rooms or sites) would collide. A provider shifting a time by 30 min would read as delete plus "new".
**Fix:** State the tie-breaker (append a `-<n>` suffix by a provider sort key, or include a normalised place) and accept that a time change re-badges as new. Document both in AD-6.

### M10. Directory verification gate versus "every centre published"
**Inputs:** data-sources: each rtpartner seed entry is "verified against the centre's own website before going live". CAP-7: count matches BAMF.
**Spine:** AD-8 publishes *every* directory centre, and there is no field for unverified entries.
**Fix:** Add `verified_at` (and `source: rtpartner|bamf`) to the directory schema. Either publish only verified entries, which needs an AD-8 exception, or allow none to be unverified in the directory (a CI check). The `source` field also prepares the BAMF/IFG switch (L2).

### M11. Monthly directory refresh has no trigger or owner
**Inputs:** data-sources "Refresh: monthly diff for added or removed centres."
**Spine:** `tools/directory-diff` exists, but nothing triggers it.
**Fix:** Add a monthly scheduled workflow that runs directory-diff in report-only mode. It opens a GitHub issue with the added and removed entries and never edits `centres.json` (this respects AD-7). Its HTTP follows H6.

---

## Low

### L1. ODbL scope also covers the published snapshot coordinates
Centre coordinates come from Nominatim (OSM, ODbL) and are republished in `snapshot.json`, not only in `places.json`. **Fix:** in Deferred/AD-9, add a data licence note (an ODbL notice in `data/public/` and the About page). Treat i18n keys for "© OpenStreetMap contributors (ODbL)" and the Nominatim credit as required, so CI fails without them.

### L2. BAMF/IFG source switch
data-sources: request the list from BAMF, then by IFG via FragDenStaat, and switch when it arrives. **Fix:** with `source` per entry (M10), the switch is a data change plus a diff tool run. Note in Deferred that no architecture change is needed and that About "Sources" reads from the directory's source values. The rtpartner reuse licence is unclear, and a public repo republishes it. Flag this for the legal/Impressum decision.

### L3. The bot UA points at an About URL that will change
AD-5's UA includes `<About page URL>`. Before the custom domain this is the github.io URL, and it changes at launch. **Fix:** keep the URL in `pipeline/config.ts`. The About page must exist before the first live run and must carry the bot description and opt-out contact (EXPERIENCE About §6), with the contact address as config.

### L4. Private beta on a public URL
The spine says "Private beta = production with Impressum/Privacy hidden". A public repo plus GitHub Pages is publicly reachable and indexable. **Fix:** set a build flag `PUBLIC_LAUNCH=false` that hides the legal links *and* emits `noindex` plus a disallowing `robots.txt`. State that the beta is unlisted, not private.

### L5. Personal data in provider free text
AD-9 blocks personal data by type. But `place` and `room` free text can contain names ("Raum 2 – Frau X"). **Fix:** normalise strips or truncates known patterns (Herr/Frau + name), and reader fixtures include such a case.

### L6. Uncovered centre without a test page
`test_page_url` may be unknown for a `none` centre. **Fix:** directory schema: `test_page_url` required for covered centres and optional otherwise, with the UI falling back to `website`. Or make it required everywhere and enforce that in CI.

---

## Checked and covered (no finding)

- Static, no backend, no third-party request at load; Google Maps only on tap (AD-1, deployment diagram).
- Coordinates never in URL or storage (AD-2), with the caveat in H3.
- A gap is never read as "nothing": AD-4 and AD-8, with the caveat in H4.
- Past dates are dropped at publish and hidden in the browser (AD-11).
- The "new" 24 h and freshness 12 h thresholds are computed in the browser (AD-11).
- DE/EN keys, codes in data, CI fails on missing keys, `lang="de"` for provider text (AD-10).
- Cost €0, schedule ≤ 4 per day, ≤ 12 h freshness, operator alert.
- Personal-data exclusion by type (AD-9), with the caveat in L5.
- Results don't refresh while open: a static snapshot with a single fetch matches this.
