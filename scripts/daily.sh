#!/usr/bin/env bash
# The daily job: fetch candidates, draft entries, rebuild, test, push, and
# publish through the personalsite copy. Runs from the systemd user timer
# date-the-war-daily.timer on the Pi. Log: ~/date-the-war-daily.log
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$HOME/projects/craigm26/date-the-war"
SITE="$HOME/projects/craigm26/personalsite"
TODAY="$(date -u +%F)"
cd "$REPO" || exit 1
echo "== $(date -Is) daily start ($TODAY)"
git pull -q --ff-only origin main || echo "pull failed, continuing on local state"
node scripts/fetch-candidates.mjs "$TODAY" || { echo "fetch failed"; exit 0; }
node scripts/draft-daily.mjs "$TODAY" || echo "draft step returned $?"
node scripts/build-events.mjs || { echo "build failed"; exit 1; }
npm test >/tmp/dtw-test.log 2>&1 || { echo "tests failed"; tail -30 /tmp/dtw-test.log; exit 1; }
if git status --porcelain | grep -qE 'data/(daily|inbox|all-events)'; then
  N=$(node -e "const f='data/daily/$TODAY.json';try{console.log(require('fs').existsSync(f)?JSON.parse(require('fs').readFileSync(f,'utf8')).length:0)}catch{console.log(0)}")
  git add data/daily data/inbox data/all-events.json data/meta.json data/reels.json reels.xml
  git -c user.name="Craig Merry" -c user.email="craigm26@gmail.com" commit -q -m "Daily: $N auto-drafted events for $TODAY

Fetched from the day's feeds and drafted by the daily job; every entry is
marked auto and unreviewed. Reel: https://craigmerry.com/date-the-war/#day@$TODAY@reel" && git push -q origin main && echo "pushed date-the-war ($N events)"
  cd "$SITE" || exit 1
  git pull -q --rebase origin master || echo "site pull failed, continuing"
  ./scripts/sync-date-the-war.sh && npm run build >/tmp/dtw-site-build.log 2>&1 || { echo "site build failed"; tail -20 /tmp/dtw-site-build.log; exit 1; }
  git add -A public/date-the-war dist
  git -c user.name="Craig Merry" -c user.email="craigm26@gmail.com" commit -q -m "Date the war: daily events for $TODAY" && git push -q origin master && echo "pushed personalsite"
  cd "$REPO" && python3 scripts/send_reels.py "$TODAY" || echo "send step returned $?"
else
  echo "no changes"
fi
echo "== $(date -Is) daily done"
