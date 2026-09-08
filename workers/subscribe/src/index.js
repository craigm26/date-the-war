// Subscription store for the Date the war daily reel. Double opt-in.
// The Worker only stores addresses and tokens; mail is sent by the Pi's
// daily job, which reads the pending and confirmed lists with ADMIN_TOKEN.
//
//   POST /subscribe        { email, website }   website is a honeypot, must be empty
//   GET  /confirm?t=TOKEN  marks confirmed, shows a plain page
//   GET  /unsubscribe?t=   deletes, shows a plain page
//   GET  /list?state=pending|confirmed   bearer ADMIN_TOKEN
//   POST /mark             { email, field }     bearer ADMIN_TOKEN, sets field to now
//   GET  /health
const ORIGINS = new Set(['https://craigmerry.com', 'http://localhost:8123', 'http://localhost:8000']);
const SITE = 'https://craigmerry.com/date-the-war/';

const page = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 Archivo,system-ui,sans-serif;background:#f3f2f2;color:#201e1d;margin:0;padding:48px 20px;max-width:560px}h1{font-size:22px;font-weight:800}a{color:#ae1800}</style>
<h1>${title}</h1><p>${body}</p><p><a href="${SITE}">Back to Date the war</a></p>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

const json = (obj, status = 200, origin = '') => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', ...cors(origin) },
});
const cors = (origin) => (ORIGINS.has(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' } : {});
const token = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

    if (url.pathname === '/health') return json({ ok: true });

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, 400, origin); }
      if (body.website) return json({ message: 'Check your inbox for a confirmation link.' }, 200, origin); // honeypot: pretend
      const email = String(body.email || '').trim().toLowerCase();
      if (!validEmail(email)) return json({ error: 'That does not look like an email address.' }, 400, origin);
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const rlKey = `rl:${ip}:${new Date().toISOString().slice(0, 13)}`;
      const hits = Number((await env.SUBS.get(rlKey)) || 0) + 1;
      await env.SUBS.put(rlKey, String(hits), { expirationTtl: 3600 });
      if (hits > 8) return json({ error: 'Too many attempts from this address. Try again in an hour.' }, 429, origin);
      const key = `sub:${email}`;
      const existing = await env.SUBS.get(key, 'json');
      if (existing?.confirmed) return json({ message: 'You are already subscribed.' }, 200, origin);
      const rec = existing || { email, token: token(), confirmed: false, createdAt: new Date().toISOString() };
      rec.confirmSentAt = existing?.confirmSentAt ?? null; // the sender fills this in
      await env.SUBS.put(key, JSON.stringify(rec));
      await env.SUBS.put(`tok:${rec.token}`, email);
      return json({ message: 'Check your inbox for a confirmation link. It can take until the next morning\'s run.' }, 200, origin);
    }

    if (url.pathname === '/confirm' || url.pathname === '/unsubscribe') {
      const t = url.searchParams.get('t') || '';
      const email = /^[0-9a-f]{48}$/.test(t) ? await env.SUBS.get(`tok:${t}`) : null;
      if (!email) return page('That link has expired', 'Subscribe again from the page and a fresh link will follow.');
      const key = `sub:${email}`;
      if (url.pathname === '/unsubscribe') {
        await env.SUBS.delete(key);
        await env.SUBS.delete(`tok:${t}`);
        return page('Unsubscribed', `${email} will get no more reels.`);
      }
      const rec = (await env.SUBS.get(key, 'json')) || { email, token: t, createdAt: new Date().toISOString() };
      rec.confirmed = true;
      rec.confirmedAt = rec.confirmedAt || new Date().toISOString();
      await env.SUBS.put(key, JSON.stringify(rec));
      return page('Confirmed', `${email} will get the daily reel. Each mail carries a one-click unsubscribe link.`);
    }

    // admin
    const auth = request.headers.get('authorization') || '';
    if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'not found' }, 404);
    if (url.pathname === '/list') {
      const state = url.searchParams.get('state') || 'confirmed';
      const out = [];
      let cursor;
      do {
        const l = await env.SUBS.list({ prefix: 'sub:', cursor });
        for (const k of l.keys) {
          const rec = await env.SUBS.get(k.name, 'json');
          if (!rec) continue;
          if (state === 'confirmed' ? rec.confirmed : (!rec.confirmed && !rec.confirmSentAt)) out.push(rec);
        }
        cursor = l.list_complete ? undefined : l.cursor;
      } while (cursor);
      return json({ state, count: out.length, items: out });
    }
    if (url.pathname === '/mark' && request.method === 'POST') {
      const { email, field } = await request.json();
      if (!validEmail(email || '') || !/^[a-zA-Z]+$/.test(field || '')) return json({ error: 'bad request' }, 400);
      const key = `sub:${email.toLowerCase()}`;
      const rec = await env.SUBS.get(key, 'json');
      if (!rec) return json({ error: 'no such subscriber' }, 404);
      rec[field] = new Date().toISOString();
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  },
};
