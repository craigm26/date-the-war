# Date the war

An experiment for craigmerry.com: a globe and a timeline of sourced events from 1900 to today.

A world war can begin gradually and get its start date afterward. Nobody on 18 September 1931 knew they were in one; some historians now say they were. This page does not declare a third world war. It puts every sourced event since 1900 on one globe, lets the visitor narrow the window to a day, a month, or a year, and play the record forward. Date it from wherever you like and see what that dating makes you include.

Live at https://craigmerry.com/date-the-war/. This repo is the source; the personalsite repo serves a copy of the runtime files (`index.html`, `style.css`, `src/`, `data/`) from `public/date-the-war/`, pulled in by its `scripts/sync-date-the-war.sh`. Push here, then run the sync there.

## What it does

- **One globe, 1900 to today.** A black-and-white orthographic globe with every sourced event as a marker: red disc for escalatory, ring for de-escalatory, half disc for mixed, square for contextual; size is impact 1 to 5; dashed red arcs are links between actors.
- **A windowed timeline.** Days, months, or years; play it forward; cumulative mode; era shortcuts for 1914, 1939, since 2011, and this week; a year strip and a day slider. The window is in the URL hash (`#month@1939-09-01`, add `@c` for cumulative).
- **Impact groups and indicators.** Seven groups (War / conflict, Economic, Political, Social, Environmental, Technology, Health) over eighteen indicator categories, all toggleable. Two of them, Mobilization and war economy and Civil preparedness and resilience, form the buildup layer the page's prose explains.
- **Every event carries its source.** Entries marked `checked` were opened and read on the date shown. Entries marked `unchecked` are well established but the link has not been re-opened for this page yet.
- **Mechanisms, not names.** The page prose names the mechanisms (security dilemma, commitment problem, alliance entanglement, power transition, steps to war, and so on) and files the papers under Sources. No individual is named in the body text.

## Data

Three ledgers merge into `data/all-events.json`, the one file the page reads. Regenerate with `npm run build:events`.

| Ledger | Shape | Rows |
| --- | --- | --- |
| `data/events.json` | repo schema: theater ids from `nodes.json`, `combat` as two sides, `link` pairs, mechanism ids | 1914, 1939, since 2011 |
| `data/history-1900-1945.json`, `data/history-1946-2010.json` | merged shape with mechanism ids; hand-curated, every URL returned 200 when written | the rest of the century |
| `data/history-mobilization.json` | same shape; the mobilization layer: conscription, industrial direction, rationing, war finance, call-ups, spending shares, civil preparedness (two extra indicator categories) | 1914 to 2025 |
| `data/indicators-2026.csv` | 2026 Global Conflict Indicators ledger, 67 sourced rows as of 2026-09-08 | this year |

Merge rules, stated so they can be argued with:

- Group comes from the indicator category (six war categories, five economic, two political, one each for social, environmental, technology); rows whose title mentions health, dialysis or malnutrition go to Health.
- Impact for a CSV row: Escalatory 3, Mixed 2, De-escalatory 2, Contextual 1; +1 for "Interstate combat and intervention"; +1 for a metric of 10k or more people, +2 for 1M or more; +1 for 50 percent or more; +1 for 10bn or more, +2 for 100bn or more; +1 for warheads, million barrels, or troops; clamped to 1 to 5.
- Impact for a repo row: war start scores 5 when major powers are on both sides, else 4; a link 3; a war end 3; a measurement 2; other events 3 with combat, else 2. Explicit `group`, `sub`, `dir`, `mag` on a row override the defaults.
- Place: the theater for repo rows; the first non-US country for CSV rows; "Multiple countries" rows sit at 0, 20 N and draw smaller.
- Arcs: repo rows use their `link` or the first power on each combat side; CSV rows with two or more named countries in War / conflict, Trade coercion and sanctions, or Diplomacy and crisis management get an arc between the first two.

`test/fixtures/indicators-2026-expected.json` pins the 67 CSV rows so a rule change is a visible diff.

## Layout

```
index.html          the page, all copy lives here
style.css           the modernist system: ground #f3f2f2, ink #201e1d, accent #ec3013, Archivo
src/globe.js        orthographic renderer: equirectangular texture + per-pixel inverse lookup, great-circle arcs
src/timeline.js     pure window logic: units, bounds, filters, jumps, year strip, related events, hash
src/app.js          rendering and interaction
scripts/build-events.mjs   the merge
data/                ledgers above, plus countries-110m.json (world-atlas, public domain), nodes.json, mechanisms.json
test/                node --test
```

No build step and no dependencies. Fonts load from Google Fonts. craigmerry.com serves a copy of `index.html`, `style.css`, `src/`, `data/` from `public/date-the-war/`.

## Working on it

```
npm test                      # data integrity, the merge fixture, window logic, no em-dashes
npm run build:events          # after editing any ledger
python3 -m http.server 8000   # then open http://localhost:8000/
```

Adding an event: append to the ledger that fits (`events.json` for the repo schema, a `history-*.json` for the merged shape), run the build, run the tests. Set `checked` to the date you opened the source, or `null`.

House rules for copy: no em-dashes, no named individuals in prose, every factual claim linked.

## Sources

Base map: Natural Earth via [world-atlas](https://github.com/topojson/world-atlas), public domain.

Mechanism literature and the definitional sources are listed at the bottom of the page.

Built by Craig Merry, pairing with Claude Code.
