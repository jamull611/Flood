// "photo-labels" Edge Function for the Adjuster Claim Tracker.
// Takes a batch of inspection photos (already shrunk by the app), asks Claude to label each one
// (report section, room, short title, caption), and returns the labels. Only signed-in users can call it.
//
// Setup (Supabase dashboard):
//   1. Edge Functions > Secrets: add ANTHROPIC_API_KEY (from console.anthropic.com).
//   2. Edge Functions > Deploy a new function > Via Editor, name "photo-labels", paste this file, Deploy.
//      Leave "Verify JWT" ON: the app sends the signed-in user's token.
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const MODEL = 'claude-opus-5-5';
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 1_500_000; // per photo, after the app shrinks it

// Report order. The app sorts photos by this list, then by room, then by when they were taken.
const SECTIONS = ['risk', 'address', 'exterior', 'water_line', 'interior', 'mechanical', 'contents', 'documents', 'other'] as const;

const SCHEMA = {
  type: 'object',
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'The photo number given before the image.' },
          section: {
            type: 'string',
            enum: [...SECTIONS],
            description:
              'risk: front of the building / overall view of the risk. address: house number, mailbox, street sign. ' +
              'exterior: other elevations, foundation, crawlspace, siding, exterior damage. water_line: exterior high-water marks. ' +
              'interior: inside rooms (overviews, damage, interior water lines). mechanical: HVAC, water heater, electrical panel, ' +
              'built-in appliances, ductwork. contents: personal property. documents: data plates, serial numbers, receipts, paperwork. ' +
              'other: anything else.',
          },
          level: { type: 'string', description: 'Level, as in Xactimate: "Exterior" for anything outside, otherwise "Main Level", "Basement", "Upper Level", "Crawlspace", "Garage" or "Attic". Use the same spelling every time.' },
          room: { type: 'string', description: 'Room or area name, e.g. "Kitchen", "Primary Bedroom", "Rear Elevation". Use the level name again when the whole level is one space, e.g. an unfinished "Basement". Empty string if none applies.' },
          overview: { type: 'boolean', description: 'True if this is a wide shot showing the whole room or elevation, rather than a detail.' },
          title: { type: 'string', description: 'Short title for a file name, 2 to 6 words, e.g. "Kitchen base cabinets".' },
          caption: { type: 'string', description: 'One-sentence photo report caption.' },
        },
        required: ['index', 'section', 'level', 'room', 'overview', 'title', 'caption'],
        additionalProperties: false,
      },
    },
  },
  required: ['photos'],
  additionalProperties: false,
};

const SYSTEM = `You label inspection photos for a flood insurance adjuster's photo report.

For each photo, give its report section, the level and room (as in Xactimate), a short title, and a one-sentence caption.

Captions:
- Say plainly what the photo shows, in an adjuster's words: "Indoor air handler. Model and S/N not present on the unit at the time of inspection." "Lower cabinets delaminated at toe kick." "Silt line on siding, rear elevation."
- Describe only what is visible. Use flood terms where they fit: water line, high-water mark, wicking, saturated drywall, delamination, silt/debris, standing water, mold growth.
- Give a measurement only if a tape measure or ruler in the photo shows it, and say so ("water line approx. 14 in. per tape measure").
- Never guess causes, values, ages or coverage.
- For contents and appliances, name the item and any visible brand or model.

Levels and rooms: reuse a level/room from the "Rooms so far" list when the photo shows the same room, spelled the same way, so every photo of a room groups together.

When the adjuster gives caption preferences, follow them over these defaults: match their wording, sentence pattern and level of detail.
When "Captions so far" lists a caption for a room, reuse that exact wording for general photos of the same room; write a new caption only for close-ups, equipment, contents or something different.

Return one entry for every photo, using the photo number as index.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const anthropic = new Anthropic(); // reads the ANTHROPIC_API_KEY secret
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

type PhotoIn = { index: number; data: string; name?: string; taken?: string };
type Body = { photos: PhotoIn[]; rooms?: string[]; examples?: string[]; style?: string; claim?: { address?: string; event?: string } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  // Signed-in users only.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: 'Sign in to cloud sync first.' }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length || photos.length > MAX_PHOTOS) return json({ error: `Send 1 to ${MAX_PHOTOS} photos at a time.` }, 400);
  for (const p of photos) {
    if (!Number.isInteger(p.index) || typeof p.data !== 'string' || p.data.length * 0.75 > MAX_PHOTO_BYTES) return json({ error: 'A photo was missing or too large.' }, 400);
  }

  const rooms = (body.rooms ?? []).filter((r) => typeof r === 'string' && r.trim()).slice(0, 60);
  const examples = (body.examples ?? []).filter((r) => typeof r === 'string' && r.trim()).slice(0, 40).map((r) => r.slice(0, 300));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const p of photos) {
    const when = p.taken ? `, taken ${p.taken}` : '';
    content.push({ type: 'text', text: `Photo ${p.index}${when}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.data } });
  }
  const notes = [
    body.claim?.event ? `Loss: ${body.claim.event} flood.` : '',
    body.claim?.address ? `Property: ${body.claim.address}.` : '',
    `Rooms so far: ${rooms.length ? rooms.join('; ') : '(none yet)'}`,
    examples.length ? `Captions so far:\n${examples.join('\n')}` : '',
    body.style?.trim() ? `The adjuster's caption preferences:\n${body.style.trim().slice(0, 2000)}` : '',
    `Label photos ${photos.map((p) => p.index).join(', ')}.`,
  ].filter(Boolean).join('\n');
  content.push({ type: 'text', text: notes });

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      // Labeling is straightforward: low effort keeps it quick and inexpensive.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      // If the model declines, Anthropic re-runs the request on its recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') return json({ error: 'Claude declined to label these photos. Label them by hand.' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'The answer was cut off. Try fewer photos at a time.' }, 502);
    const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).pop();
    if (!text) return json({ error: 'No answer from Claude.' }, 502);
    const out = JSON.parse(text) as { photos: unknown[] };
    return json({ photos: out.photos, model: response.model, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is missing or wrong (Supabase > Edge Functions > Secrets > ANTHROPIC_API_KEY).' }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Too many photos at once. Wait a minute and try again.', retry: true }, 429);
    if (e instanceof Anthropic.BadRequestError) return json({ error: 'Claude couldn\'t read these photos: ' + e.message }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude is unavailable right now (${e.status}). Try again.`, retry: true }, 502);
    if (e instanceof SyntaxError) return json({ error: 'Claude\'s answer couldn\'t be read. Try again.', retry: true }, 502);
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
