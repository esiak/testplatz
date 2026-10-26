---
id: SPEC-einbuergerungstest-search
companions:
  - data-sources.md
  - ../../planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/EXPERIENCE.md
  - ../../planning-artifacts/architecture/architecture-bgtsearch-2026-10-25/ARCHITECTURE-SPINE.md
sources:
  - ../../forge/einbuergerungstest-search/forged-idea.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Einbürgerungstest Appointment Search (Bavaria)

## Why

Pain to solve. People in Bavaria applying for citizenship must pass the Einbürgerungstest at a BAMF-approved test centre (~116 in Bavaria, ~101 VHS, ~15 others). Each centre publishes dates on its own website, dates fill fast, and applicants check 5–10 sites by hand, repeatedly. There is no known aggregated search. This is a free public tool: one page shows every test date near a location.

## Capabilities

- **CAP-1**
  - **intent:** A user enters a location and radius and sees upcoming test dates from all Bavarian test centres within it, sorted soonest first (default) or nearest first by straight-line distance.
  - **success:** For a Bavarian town and radius, results include every centre in the directory within that radius; Soonest orders dated results by date then distance, Nearest by distance then date; each result shows its km value and a Google Maps link to its address; past test dates are not listed.
- **CAP-2**
  - **intent:** Each test date shows date/time, centre, full address, status (free / booked out / booked out with waitlist / unknown), registration deadline, registration method (online / email / post / in person), and a link to the provider's page for that date.
  - **success:** For a sample of covered dates, every field matches the provider page at the last check; missing source fields show as "unknown", never guessed; a passed deadline shows as "Passed"; if the date's page was unreachable at the last check, the link opens the centre's test page instead.
- **CAP-3**
  - **intent:** The system collects test dates automatically from centres on the two shared systems (KuferWeb, ITEM KG) several times a day.
  - **success:** Every centre on a supported system has dates no older than 12 hours; a new date published on a covered site appears within 12 hours.
- **CAP-4**
  - **intent:** Centres without an automatic reader still appear in results, marked "not checked automatically, see website", with a link. A covered centre whose last check failed (or never ran) and has no dates left appears the same way, marked "not checked right now".
  - **success:** A search covering an uncovered centre lists it with that marker; no directory centre within the radius is ever absent.
- **CAP-5**
  - **intent:** Users see how fresh each listing is, and a failing reader is shown as failing.
  - **success:** Each listing shows when its centre was last checked successfully (freshness is per centre, not per date); when a site's collection fails or returns nothing unexpectedly, its listings are flagged stale rather than shown as current or empty, and a failing centre with no dates left shows as "not checked right now", never as "No dates listed".
- **CAP-6**
  - **intent:** Test dates that appeared recently are marked "new".
  - **success:** A date first seen within the last 24 hours shows a "new" badge; the first-seen time is stored per date and survives later checks.
- **CAP-7**
  - **intent:** The centre directory contains every BAMF-listed Bavarian test centre with name, address, coordinates, website, and reader type.
  - **success:** Directory count matches the BAMF Bavaria list; every entry has coordinates and a reader type (KuferWeb, ITEM KG, or none).
- **CAP-8**
  - **intent:** A provider can be removed from automatic collection on request.
  - **success:** After an operator marks a centre opted out, no further requests go to its site and it shows as "not checked automatically".
- **CAP-9**
  - **intent:** A user can switch the interface between German and English.
  - **success:** Every UI string, status, and registration method appears in the selected language; no UI text is hard-coded, so adding a language means adding a translation file. Provider free text (place names, rooms) is shown as published.

- **CAP-10**
  - **intent:** A covered centre within the radius whose last check succeeded but found no test dates still appears in results, marked "No dates listed".
  - **success:** A search covering such a centre lists it with that marker, its last successful check time, and a link to its test page; it is never omitted. A centre whose last check failed or never ran is not shown with this marker (see CAP-4).

## Constraints

- Bavaria only: residence in Bavaria is required to test there; no centres outside the state.
- Search only: no booking, no user accounts at providers, no submitting forms on their sites.
- Near-zero running cost, no monetisation: rules out paid APIs and always-on heavy infrastructure.
- Polite collection: identified bot user agent, robots.txt respected, at most 4 checks per site per day.
- Store only date, time, place, status, deadline, registration method, and link; no personal data from provider pages (e.g. instructor names).
- A gap in data must never read as "nothing available".
- The user's location never leaves the browser: search matches against a built-in postcode/town table and distance is computed client-side (see `data-sources.md`). Shareable search state lives in the URL fragment (`#q=…`), never the query string, so the place never reaches the server.
- Public launch requires an Impressum (named operator, deliverable postal address) and a privacy policy; a private beta may run without. Operator choice is deferred.
- OpenStreetMap-derived data requires visible ODbL attribution.

## Non-goals

- Booking or registering on the user's behalf.
- Alerts or notifications (v2; CAP-6 history is their foundation).
- States other than Bavaria.
- Travel-time or public-transport routing.
- Street-level address search (v2; needs a runtime geocoder, weigh cost and privacy then).
- Ads, paid tiers, or any monetisation.
- A "registration opens at" field: Bavarian sites do not publish it.
- 100% automatic coverage in v1.

## Success signal

- A Bavarian resident enters their town, sees on one page every test centre within their radius, gets current dates with status for the covered ones and a direct link for the rest, and no longer needs to open each provider site to know where a date exists.

## Assumptions

- About 30 of 78 Bavarian VHS run KuferWeb and about 25 run ITEM KG, based on homepage fingerprints only; per-site test pages not yet verified.
- The rtpartner.de republication of BAMF data is complete and accurate enough to seed the v1 directory once each entry is checked against the centre's own site.

## Open Questions

- Who is the named Impressum operator? Must be decided before public launch.
