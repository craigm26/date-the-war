#!/usr/bin/env python3
"""Send confirmation mails to pending subscribers and the day's reel to
confirmed ones. Needs two env files under ~/.config/date-the-war/:

  subscribe.env   SUBSCRIBE_URL=https://dtw-subscribe.<sub>.workers.dev
                  ADMIN_TOKEN=...            (the Worker's secret)
  smtp.env        SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
                  SMTP_USER=...  SMTP_PASS=...  MAIL_FROM="Date the war <you@example.com>"

Without smtp.env nothing is sent and the script says so. No dependencies.
Usage: send_reels.py [YYYY-MM-DD]
"""
import json, os, sys, smtplib, ssl, urllib.request, html
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = Path.home() / '.config' / 'date-the-war'
SITE = 'https://craigmerry.com/date-the-war/'
today = sys.argv[1] if len(sys.argv) > 1 else __import__('datetime').date.today().isoformat()

def env(name):
    p = CFG / name
    if not p.exists():
        return None
    out = {}
    for line in p.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k.strip()] = v.strip().strip('"')
    return out

sub = env('subscribe.env'); smtp = env('smtp.env')
if not sub or '__URL__' in sub.get('SUBSCRIBE_URL', ''):
    print('no subscribe.env or URL not set; skipping mail'); sys.exit(0)
if not smtp:
    print('no smtp.env; subscribers are stored but no mail is sent'); sys.exit(0)

def api(path, method='GET', body=None):
    req = urllib.request.Request(sub['SUBSCRIBE_URL'].rstrip('/') + path, method=method,
                                 headers={'authorization': 'Bearer ' + sub['ADMIN_TOKEN'], 'content-type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def send(to, subject, text, html_body):
    m = EmailMessage()
    m['From'] = smtp.get('MAIL_FROM', smtp['SMTP_USER']); m['To'] = to; m['Subject'] = subject
    m['List-Unsubscribe'] = f"<{sub['SUBSCRIBE_URL'].rstrip('/')}/unsubscribe?t={to_token.get(to, '')}>"
    m.set_content(text); m.add_alternative(html_body, subtype='html')
    with smtplib.SMTP(smtp.get('SMTP_HOST', 'smtp.gmail.com'), int(smtp.get('SMTP_PORT', '587')), timeout=60) as s:
        s.starttls(context=ssl.create_default_context()); s.login(smtp['SMTP_USER'], smtp['SMTP_PASS']); s.send_message(m)

base = sub['SUBSCRIBE_URL'].rstrip('/')
to_token = {}

# 1. confirmations
pending = api('/list?state=pending')['items']
for rec in pending:
    to_token[rec['email']] = rec['token']
    link = f"{base}/confirm?t={rec['token']}"
    send(rec['email'], 'Confirm your Date the war reel',
         f"Confirm to get the daily reel:\n{link}\n\nIf you did not ask for this, ignore it.",
         f"<p>Confirm to get the daily reel from <a href='{SITE}'>Date the war</a>:</p><p><a href='{link}'>{link}</a></p><p style='color:#605d5d'>If you did not ask for this, ignore it.</p>")
    api('/mark', 'POST', {'email': rec['email'], 'field': 'confirmSentAt'})
print(f'confirmations sent: {len(pending)}')

# 2. the day's reel
events = json.loads((ROOT / 'data' / 'all-events.json').read_text())
day = sorted([e for e in events if e['date'] == today], key=lambda e: (-e['mag'], e['id']))
if not day:
    print('no events dated', today, '; no reel mail'); sys.exit(0)
confirmed = api('/list?state=confirmed')['items']
reel = f"{SITE}#day@{today}@reel"
fmt_date = __import__('datetime').date.fromisoformat(today).strftime('%-d %b %Y')
lines = [f"- {e['title']} ({e['place']}; {e['dir'].lower()}, impact {e['mag']}){' [auto]' if e.get('auto') else ''}\n  {e['source']['url']}" for e in day]
text = f"Date the war, {fmt_date}: {len(day)} sourced events.\n\nWatch the reel: {reel}\n\n" + "\n".join(lines) + "\n\nEntries marked auto were drafted by a daily job and have not been reviewed.\n"
items = "".join(f"<li style='margin:0 0 10px'><b>{html.escape(e['title'])}</b><br><span style='color:#605d5d;font-size:13px'>{html.escape(e['place'])} · {e['dir']} · impact {e['mag']} of 5{' · auto' if e.get('auto') else ''} · <a href='{html.escape(e['source']['url'])}'>{html.escape(e['source']['label'])}</a></span></li>" for e in day)
sent = 0
for rec in confirmed:
    to_token[rec['email']] = rec['token']
    unsub = f"{base}/unsubscribe?t={rec['token']}"
    body = (f"<div style='font:15px/1.5 Archivo,system-ui,sans-serif;color:#201e1d;max-width:560px'>"
            f"<p style='font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#ec3013;margin:0'>Date the war</p>"
            f"<h1 style='font-size:22px;margin:4px 0 12px'>{fmt_date}: {len(day)} sourced events</h1>"
            f"<p><a href='{reel}' style='display:inline-block;background:#ec3013;color:#f3f2f2;padding:10px 14px;text-decoration:none;font-weight:800'>Watch the reel</a></p>"
            f"<ul style='padding-left:18px'>{items}</ul>"
            f"<p style='color:#605d5d;font-size:12px'>Entries marked auto were drafted by a daily job from the linked source and have not been reviewed.</p>"
            f"<p style='color:#605d5d;font-size:12px'><a href='{unsub}'>Unsubscribe</a></p></div>")
    send(rec['email'], f"Date the war, {fmt_date}: {len(day)} sourced events", text + f"\nUnsubscribe: {unsub}\n", body)
    sent += 1
print(f'reel mails sent: {sent}')
