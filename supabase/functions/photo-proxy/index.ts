// "photo-proxy" Edge Function for the Adjuster Claim Tracker. ONLY NEEDED IF the tracker says Google blocked
// downloading photos straight into the browser. It downloads one photo the user picked in Google Photos and
// passes it back to the tracker. It only fetches Google Photos addresses, only for signed-in users, and
// stores nothing.
//
// Setup: Supabase > Edge Functions > Deploy a new function > Via Editor, name "photo-proxy", paste this file,
// Deploy. Leave "Verify JWT" ON.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const fail = (msg: string, status: number) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Use POST', 405);
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return fail('Sign in to cloud sync first.', 401);

  let body: { url?: string; googleToken?: string };
  try { body = await req.json(); } catch { return fail('Bad request', 400); }
  let url: URL;
  try { url = new URL(String(body.url)); } catch { return fail('Bad photo address', 400); }
  // Google Photos media only: never fetch anything else.
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com')) return fail('Not a Google Photos address', 400);
  if (!body.googleToken) return fail('Missing Google sign-in', 400);

  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + body.googleToken } });
  if (!r.ok || !r.body) return fail(`Google Photos answered ${r.status}`, r.status === 401 || r.status === 403 ? 401 : 502);
  return new Response(r.body, { headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'image/jpeg' } });
});
