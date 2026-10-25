# Forged idea: Einbürgerungstest appointment search (Bavaria)

**Outcome:** HARDENED, 2026-10-25

## Locked
- **Search only.** No booking; every result links to the provider's own page.
- **v1 = distance search** over all Bavarian BAMF test centres (~116, ~101 VHS + ~15 others). Nothing outside Bavaria (tests need residence in Bavaria). Other states later, one at a time.
- **Shows per test date:** date/time, place, status (free / booked out / unknown), registration deadline, how to register (online / email / in person), link.
- **Coverage:** automatic readers for the two shared systems: KuferWeb "webbasys" (~30 sites) and the ITEM KG TYPO3 setup (`/p/...-NNN-CAT` URLs, ~25 sites incl. MVHS). Every other centre still appears as "not checked automatically, see website". A gap must never look like "nothing available".
- **Distance** = straight-line km, with a link out to map directions.
- **Freshness:** check each site 2–4×/day, identified bot, respect robots.txt, drop any centre on request. Show "last checked" per listing and per reader.
- **History from day one:** store first-seen time per test date, which gives a "new since yesterday" badge in v1 and makes v2 alerts cheap.
- **Free public side project**, near-zero running cost, no monetisation.
- **No personal data** scraped (skip instructor names); only date, time, place, status, link.

## v2
- Alerts: "new date or free seat within X km of me".

## Rejected
- Booking through the site: out of scope.
- Region-first 100% coverage (option B): partial coverage with visible gaps is more useful sooner.
- Showing "registration opens at": the Bavarian sample sites don't publish it; show the deadline instead.

## Open risks
- ~23 VHS sites of unknown or bot-blocking build, plus ~15 non-VHS providers: manual links only.
- Readers break silently when Kufer or ITEM KG change markup; "last checked" makes it visible but someone has to fix it.
- Vendor share (~70%) comes from a homepage fingerprint, not from checking each site's test page.
- "No competitor exists" rests on two searches.
- Some listings can't be booked remotely (e.g. Bad Kissingen: in person, cash).
