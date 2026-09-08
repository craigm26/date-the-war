# Date the war

An experiment for craigmerry.com. One map, one marker, four time scales.

A world war can begin gradually and get its start date afterward. Nobody on 18 September 1931 knew they were in one; some historians now say they were. This page does not declare a third world war. It hands the visitor the marker. Drag it to the day you think this one began, and the map shows what that dating makes you include, and which of the academic mechanisms for war are visible from there.

Live at https://craigm26.github.io/date-the-war/ once Pages is enabled.

## What it does

- **Four eras.** This week (the live layer), since 2011 (the linkage layer), 1914, and 1939. The two historical eras are there as precedent: 1914 is a local war that went general in seven days, and 1939 is the war whose start date is still argued over (1931, 1937, 1939, 1941).
- **One rule, stated next to every verdict.** A window reads as a *general war* when at least two major powers are in direct combat with each other across two or more theaters, as *linked wars* when theaters feed each other without that, and as a *regional war* otherwise. The rule is in `src/timeline.js` and the reader is invited to reject it.
- **Every event carries its source.** Entries marked `checked` were opened and read on the date shown. Entries marked `unchecked` are well established but the link has not been re-opened for this page yet.
- **Mechanisms, not names.** The page prose names the mechanisms (security dilemma, commitment problem, alliance entanglement, power transition, steps to war, and so on) and files the papers under Sources. No individual is named in the body text.

## Layout

```
index.html          the page, all copy lives here
style.css
src/geo.js          equirectangular projection, shared by build, page and tests
src/timeline.js     pure dating logic: windowing, links, major-power pairs, the rule
src/app.js          rendering
data/events.json    the ledger: date, era, theater, combat pairs, links, mechanisms, source, checked
data/nodes.json     theaters and powers with coordinates; the major-power list; asOf date
data/mechanisms.json
data/eras.json
data/world-paths.json   prebuilt from world-atlas 110m, see scripts/build-map.mjs
test/               node --test
```

No build step and no dependencies. GitHub Pages serves the repo root.

## Working on it

```
npm test                      # data integrity, the dating rule, no em-dashes
node scripts/build-map.mjs    # only if the base map changes
python3 -m http.server 8000   # then open http://localhost:8000/
```

Adding an event: append to `data/events.json`. Required fields are `id`, `date`, `era`, `theater`, `kind`, `title`, `note`, `mechanisms`, `source`, `checked`. Add `combat` (two sides, each a list of power ids: `[["us"], ["iran"]]`) and `link` (a pair of node ids) when they apply. Set `checked` to the date you opened the source, or `null`.

House rules for copy: no em-dashes, no named individuals in prose, every factual claim linked.

## Sources

Base map: Natural Earth via [world-atlas](https://github.com/topojson/world-atlas), public domain.

Mechanism literature and the definitional sources are listed at the bottom of the page.

Built by Craig Merry, pairing with Claude Code.
