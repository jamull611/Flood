// "reminders" Edge Function for the Adjuster Claim Tracker.
//   GET  -> returns the public key phones need to sign up for notifications
//   POST -> sends every reminder that's due (called every minute by the cron job in 3-reminders.sql)
// Deploy with "Verify JWT" turned OFF: it takes no input and only sends reminders that are already due.
// Its notification keys are created on first use and kept in the push_config table, readable only here.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function keys(): Promise<{ public_key: string; private_key: string }> {
  const read = () => sb.from('push_config').select('public_key, private_key').eq('id', 1).maybeSingle();
  let { data } = await read();
  if (!data) {
    const k = webpush.generateVAPIDKeys();
    await sb.from('push_config').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
    ({ data } = await read());
  }
  if (!data) throw new Error('Could not create notification keys');
  return data;
}

async function sendDue() {
  const k = await keys();
  webpush.setVapidDetails('https://jamull611.github.io/Flood/', k.public_key, k.private_key);
  const { data: due, error } = await sb.from('reminders')
    .select('id, user_id, claim_id, title, body, url')
    .is('sent_at', null).eq('cancelled', false).lte('fire_at', new Date().toISOString())
    .order('fire_at').limit(100);
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const r of due ?? []) {
    // Mark it first so a slow run can't send it twice.
    const { data: claimed } = await sb.from('reminders').update({ sent_at: new Date().toISOString() }).eq('id', r.id).is('sent_at', null).select('id');
    if (!claimed?.length) continue;
    const { data: subs } = await sb.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', r.user_id);
    const payload = JSON.stringify({ title: r.title, body: r.body, url: r.url, tag: 'omw-' + r.claim_id });
    const errors: string[] = [];
    for (const s of subs ?? []) {
      try {
        // Build the encrypted message with web-push, then send it with fetch.
        const req = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 900, urgency: 'high' });
        const headers = { ...(req.headers as Record<string, string>) };
        delete headers['Content-Length'];   // fetch sets this itself
        const res = await fetch(req.endpoint, { method: req.method, headers, body: req.body });
        if (res.status === 404 || res.status === 410) await sb.from('push_subscriptions').delete().eq('user_id', r.user_id).eq('endpoint', s.endpoint);
        else if (!res.ok) errors.push(`${res.status} ${await res.text()}`.slice(0, 200));
        else sent++;
      } catch (e) { errors.push(String((e as Error).message || e).slice(0, 200)); }
    }
    if (!subs?.length) errors.push('No phone signed up for notifications');
    if (errors.length) { failed++; await sb.from('reminders').update({ error: errors.join(' | ') }).eq('id', r.id); }
  }
  // Tidy up: forget reminders older than a week.
  await sb.from('reminders').delete().lt('fire_at', new Date(Date.now() - 7 * 864e5).toISOString());
  return { due: due?.length ?? 0, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET') return json({ publicKey: (await keys()).public_key });
    return json(await sendDue());
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
