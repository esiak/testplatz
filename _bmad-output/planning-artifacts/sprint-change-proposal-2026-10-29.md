# Sprint Change Proposal — Collect once a day

- **Date:** 2026-10-29
- **Author:** Eleni (decision), drafted with the Developer agent
- **Trigger story:** 2.6 Scheduled collection run
- **Mode:** Batch
- **Scope:** Minor (direct adjustment, Developer agent)

## 1. Issue Summary

The operator decided on 2026-10-29 that the collection pipeline should run **once a day**, not 4 times a day. The decision came up when Story 2.6 (scheduled collection run) was about to be built.

The plan assumes 4 runs a day in many places, and the 12 h freshness rule depends on that:

- FR9 and NFR6 require covered data to be at most 12 h old.
- The Story 2.6 AC schedules runs at 05:17, 11:17, 17:17 and 23:17 UTC.
- The freshness line (FR13, UX-DR15, AD-11) switches to the exact-time form after 12 h.
- The Epic 3 stale-system check fires after 12 h.

With one run a day, data is up to about 24 h old just before the next run, and GitHub's cron can start late. Keeping 12 h would make every card look stale for half of each day and fire the stale-system alert every day.

**Decisions (operator, 2026-10-29):**

- Run once a day at **05:17 UTC** (07:17 Berlin in summer, 06:17 in winter).
- Replace the 12 h freshness threshold with **36 h**. That covers one daily run plus a late or delayed cron. A single missed run shows up as stale about 12 h after the next run was due.
- Leave the **24 h** thresholds alone: the "New" badge window and the rolling 24 h visit budget (at most 4 visits per site, manual reruns included). The budget still leaves room for 3 manual reruns a day.

## 2. Impact Analysis

### Epic impact

- **Epic 2 (in progress, 2.1–2.5 done):** Its goal text, Story 2.6, Story 2.7 (freshness line) and Story 2.8 (freshness ageing) change wording and thresholds. The epic can still be completed. No stories are added or removed, and the order stays the same.
- **Epic 3 (planned):** The stale-system check moves from 12 h to 36 h. Nothing else changes.
- **Epic 1 (done):** The About page copy "several times a day" becomes "once a day". It's a translation-file change (`web/src/i18n/{de,en}.json`) and is folded into Story 2.6.
- No epic becomes obsolete, and no new epic is needed.

### Story impact

| Story | Status | Change |
|---|---|---|
| 1.7 About the data page | done | Copy "several times a day" → "once a day" (planning text in epics.md, code change via 2.6) |
| 2.6 Scheduled collection run | backlog | User story wording, schedule AC, freshness AC |
| 2.7 Result cards with test dates | backlog | Freshness AC 12 h → 36 h |
| 2.8 No-dates and not-checked cards | backlog | Freshness ageing 12 h → 36 h |
| Epic 3 stale-system story | backlog | Stale check 12 h → 36 h |

### Artifact conflicts

- **PRD / requirements:** There is no separate PRD file. The requirement inventory in `epics.md` is the source of record, so FR9, FR13, NFR6 and UX-DR15 change there.
- **Architecture (`ARCHITECTURE-SPINE.md`):** AD-11 threshold text and AD-12 schedule diagram.
- **UX (`DESIGN.md`, `EXPERIENCE.md`):** Freshness-line threshold and the About "How it works" copy.
- **Epic 2 context cache (`epic-2-context.md`):** Rebuild after these edits. It is derived from planning docs, and the cache check will see it as out of date.

### Technical impact

- `.github/workflows/pipeline.yml` (new in 2.6) gets one cron entry: `17 5 * * *`.
- `shared/` gets a single `FRESHNESS_HOURS = 36` constant (AD-11). It doesn't exist in code yet, so nothing has to be migrated.
- `web/src/i18n/{de,en}.json` key `about.how.body` gets new wording.
- The politeness rules and the visit log (Story 2.2) stay as they are.

## 3. Recommended Approach

**Direct adjustment.** Edit the planning documents in place, then build Story 2.6 with the daily schedule.

- **Effort:** Low. The edits are text-only, and the code is a cron line, a constant and two strings.
- **Risk:** Low. The trade-off is that users see data up to about a day old, and the freshness line stays honest about it. New dates appear within 36 h instead of 12 h.
- **Timeline:** No change.
- **Rollback:** None needed. No completed code depends on the 12 h value.

## 4. Detailed Change Proposals

### 4.1 Requirements (`epics.md`, requirement inventory)

**FR9 (line 30)**

OLD: `FR9: Test dates are collected automatically from KuferWeb and ITEM KG centres 4 times a day; every covered centre's data is no older than 12 h, and a new published date appears within 12 h. (CAP-3)`

NEW: `FR9: Test dates are collected automatically from KuferWeb and ITEM KG centres once a day; every covered centre's data is no older than 36 h, and a new published date appears within 36 h. (CAP-3)`

**FR13 (line 34)**

OLD: `… relative ("Checked 2 h ago") under 12 h, exact time with ◷ …`

NEW: `… relative ("Checked 2 h ago") under 36 h, exact time with ◷ …`

**NFR6 (line 65)**

OLD: `NFR6: Freshness: covered centres' data ≤ 12 h old under normal operation.`

NEW: `NFR6: Freshness: covered centres' data ≤ 36 h old under normal operation (one run a day plus slack for a late or failed run).`

**AD-11 summary (line 91)**

OLD: `12 h / 24 h thresholds as shared constants`

NEW: `36 h freshness / 24 h "New" thresholds as shared constants`

**AD-12 summary (line 92)**

OLD: `pipeline.yml on schedule (05:17, 11:17, 17:17, 23:17 UTC)`

NEW: `pipeline.yml on schedule (daily 05:17 UTC)`

**UX-DR15 (line 116)**

OLD: `relative under 12 h, "◷ Checked Tue 14:00" when older`

NEW: `relative under 36 h, "◷ Checked Tue 14:00" when older`

**FR coverage map (line 142)**

OLD: `FR9: Epic 2 - Automatic collection 4×/day (KuferWeb and ITEM KG)`

NEW: `FR9: Epic 2 - Automatic collection once a day (KuferWeb and ITEM KG)`

Rationale: operator decision. 36 h covers one daily run plus a late or delayed cron.

### 4.2 Epics and stories (`epics.md`)

**Epic 2 goal (lines 178 and 567)**

OLD: `… refreshed 4 times a day and honest about freshness and failures.`

NEW: `… refreshed once a day and honest about freshness and failures.`

**Story 1.7, About copy (line 353)**

OLD: `how it works ("we read the centres' websites several times a day; always check …")`

NEW: `how it works ("we read the centres' websites once a day; always check …")`

**Story 2.6, user story (lines 716–717)**

OLD:
```
I want dates refreshed several times a day without anyone pressing a button,
So that what I see is never more than half a day old.
```
NEW:
```
I want dates refreshed every day without anyone pressing a button,
So that what I see is never more than about a day old.
```

**Story 2.6, schedule AC (lines 730–732)**

OLD:
```
**When** the schedule fires at 05:17, 11:17, 17:17 and 23:17 UTC
…
**And** under normal operation every covered centre's `last_success_at` is less than 12 h old (NFR6)
```
NEW:
```
**When** the daily schedule fires at 05:17 UTC
…
**And** under normal operation every covered centre's `last_success_at` is less than 36 h old (NFR6)
```

**Story 2.6, new AC (added after the schedule AC)**

```
**Given** the About page "How it works" text
**When** it renders in either language
**Then** it says the centres' websites are read once a day (FR33)
```

**Story 2.7, freshness AC (line 769)**

OLD: `**When** the centre's `last_success_at` is under 12 h old`

NEW: `**When** the centre's `last_success_at` is under 36 h old`

**Story 2.8, freshness ageing (line 798)**

OLD: `… their freshness line ages to the exact-time form after 12 h (FR14)`

NEW: `… their freshness line ages to the exact-time form after 36 h (FR14)`

**Epic 3 stale-system check (line 886)**

OLD: `**Given** a system whose `last_success_at` is more than 12 h before now`

NEW: `**Given** a system whose `last_success_at` is more than 36 h before now`

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`)

**AD-11 rule (line 176)**

OLD: `It switches to the exact time when `now − last_success_at > 12 h`, and a system reads "Not updated since …" under the same 12 h test.`

NEW: `It switches to the exact time when `now − last_success_at > 36 h`, and a system reads "Not updated since …" under the same 36 h test.`

**AD-11 rule (line 178)**

OLD: `The 12 h and 24 h thresholds are constants in `shared/`.`

NEW: `The 36 h freshness and 24 h "New" thresholds are constants in `shared/`. (Amended 2026-10-29: once-a-day collection.)`

**AD-12 diagram (line 229)**

OLD: `CRON["schedule 4×/day<br/>05:17 11:17 17:17 23:17 UTC"] --> RUN[pipeline.yml]`

NEW: `CRON["schedule daily<br/>05:17 UTC"] --> RUN[pipeline.yml]`

### 4.4 UX (`DESIGN.md`, `EXPERIENCE.md`)

**EXPERIENCE.md line 38**

OLD: `we read the centres' websites several times a day; …`

NEW: `we read the centres' websites once a day; …`

**EXPERIENCE.md line 78**

OLD: `Relative under 12 h; exact time with ◷ when older.`

NEW: `Relative under 36 h; exact time with ◷ when older.`

**EXPERIENCE.md line 103**

OLD: `| Card older than 12 h | …`

NEW: `| Card older than 36 h | …`

**DESIGN.md line 227**

OLD: `Older than 12 h: "◷ Checked Tue 14:00", same colour.`

NEW: `Older than 36 h: "◷ Checked Tue 14:00", same colour.`

## 5. Implementation Handoff

- **Scope:** Minor. The Developer agent can do it directly.
- **Steps:**
  1. Apply the edits in section 4 to `epics.md`, `ARCHITECTURE-SPINE.md`, `EXPERIENCE.md` and `DESIGN.md`.
  2. Rebuild `epic-2-context.md` (the cache is invalid once the planning docs are newer).
  3. Build Story 2.6 with `bmad-build-auto`. It includes the daily cron (`17 5 * * *`), the `FRESHNESS_HOURS = 36` constant in `shared/`, and the About copy in `web/src/i18n/{de,en}.json`.
- **Success criteria:**
  - No planning doc mentions 4 runs a day, 05:17/11:17/17:17/23:17, or the 12 h freshness threshold.
  - `pipeline.yml` has exactly one schedule entry, at 05:17 UTC.
  - The About page says "once a day" / "einmal am Tag" in both languages.
