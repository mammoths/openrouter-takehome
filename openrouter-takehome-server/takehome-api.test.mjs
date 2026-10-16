import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { takehomeRoute, maintainTakehomeVideos, PRESETS, __testing } from './takehome-api.mjs';

const PASSCODE = 'private-interview-demo-passcode';
const API_KEY = 'sk-or-v1-private-test-key-never-print';
const ROOT = 'https://live.thedailymeili.com/openrouter_takehome/api';
const MODEL_CATALOG = [
  { id: 'bytedance/seedance-2.0-mini', name: 'Seedance Mini', description: 'Multimodal reference-to-video with images', pricing_skus: { video_tokens_without_audio: '0.0000035' } },
  { id: 'alibaba/wan-2.7', name: 'Wan 2.7', description: 'Supports reference-to-video with multiple reference images', pricing_skus: { duration_seconds: '0.1' } },
  { id: 'bytedance/seedance-2.0-fast', name: 'Seedance Fast', description: 'Multimodal reference-to-video', pricing_skus: { video_tokens_without_audio: '0.0000042' } },
].map((model) => ({ ...model, supported_durations: [4, 5], supported_resolutions: model.id.startsWith('bytedance/') ? ['480p', '720p'] : ['720p'], supported_aspect_ratios: ['9:16'] }));

/** Real SQLite exercises the SQL admission transaction; fetch is fully mocked. */
class D1Mock {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const sqlite = this.sqlite;
    const make = (args = []) => ({
      bind: (...values) => make(values),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args), success: true }),
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) }, success: true }),
      _execute: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) }, success: true }),
    });
    return make();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const result = statements.map((statement) => statement._execute()); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32000000086d6f6f760000000b6d646174010203', 'hex');
class ArchiveMock {
  objects = new Map();
  async head(key) { return this.objects.get(key)?.metadata ?? null; }
  async put(key, bytes) {
    if (this.objects.has(key)) return null;
    const metadata = { size: bytes.length, httpEtag: '"saved-video"', uploaded: new Date() };
    this.objects.set(key, { metadata, bytes: bytes.slice() });
    return metadata;
  }
  async get(key, options) {
    const value = this.objects.get(key); if (!value) return null;
    const range = options?.range;
    const bytes = range ? value.bytes.slice(range.offset, range.offset + range.length) : value.bytes;
    return { ...value.metadata, body: new Response(bytes).body };
  }
}

function fixture(options = {}) {
  const calls = [];
  const db = new D1Mock();
  let submits = 0;
  let polls = 0;
  const env = {
    DB: db, VIDEO_ARCHIVE: new ArchiveMock(), DEMO_PASSCODE: PASSCODE, OPENROUTER_API_KEY: API_KEY,
    DEMO_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    __TAKEHOME_FETCH: async (url, init = {}) => {
      url = String(url);
      calls.push({ url, init });
      if (url.endsWith('/videos/models')) return Response.json({ data: options.catalog ?? MODEL_CATALOG });
      if (url.endsWith('/key')) {
        if (options.invalidKey) return Response.json({ error: { message: API_KEY } }, { status: 401 });
        return Response.json({ data: options.keyData ?? { is_management_key: false, limit_remaining: options.unlimited ? null : 20 } });
      }
      if (url.endsWith('/credits')) return options.accountCredits
        ? Response.json({ data: options.accountCredits })
        : Response.json({ error: { message: 'Management key required' } }, { status: 403 });
      if (url.endsWith('/videos') && init.method === 'POST') {
        submits += 1;
        if (options.submit) return options.submit(submits, init);
        return Response.json({ id: `video-${submits}`, status: options.immediatelyComplete ? 'completed' : 'pending', ...(options.immediatelyComplete ? { usage: { cost: 0.4 } } : {}) }, { status: 202 });
      }
      if (/\/videos\/[^/]+\/content\?index=0$/.test(url)) return new Response(MP4, { headers: { 'Content-Type': 'video/mp4' } });
      if (/\/videos\/[^/]+$/.test(url)) {
        polls += 1;
        if (options.poll) return options.poll(polls, url);
        return Response.json({ id: url.split('/').at(-1), status: 'completed', usage: { cost: 0.333 } });
      }
      if (url.endsWith('.js')) return Response.json(options.product ?? { title: 'Leo Bed', images: ['https://www.nomohaus.com/cdn/shop/files/bed.jpg', 'https://evil.example/track.jpg'] });
      throw new Error(`Unexpected outbound URL: ${url}`);
    },
  };
  return { env, db, calls, get submits() { return submits; }, get polls() { return polls; } };
}

async function call(f, path, { method = 'GET', body, owner = true, origin = 'https://thedailymeili.com', headers = {} } = {}) {
  const request = new Request(`${ROOT}${path}`, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(owner ? { 'X-Demo-Passcode': PASSCODE } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return takehomeRoute(request, f.env);
}
const generate = (f, presetId = 'skateboard', requestId = 'request-test-1', extra = {}) => call(f, '/generate', { method: 'POST', body: { presetId, requestId, ...extra } });
const second = (f, id, requestId = 'request-second-model', extra = {}) => call(f, `/comparisons/${id}/second-model`, { method: 'POST', body: { requestId, confirmed: true, ...extra } });

test('route isolation, exact CORS allowlist, and preflight', async () => {
  const f = fixture();
  assert.equal(await takehomeRoute(new Request('https://live.thedailymeili.com/api/office'), f.env), null);
  assert.equal((await call(f, '/config', { origin: 'https://localhost.evil.example' })).status, 403);
  assert.equal((await call(f, '/config', { origin: 'https://www.thedailymeili.com' })).status, 403);
  const local = await call(f, '/config', { origin: 'http://localhost:4173' });
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4173');
  const preflight = await call(f, '/generate', { method: 'OPTIONS', owner: false });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /X-Demo-Passcode/);
});

test('public config has presets/estimates but hides financial data and key', async () => {
  const f = fixture();
  const response = await call(f, '/config', { owner: false });
  const data = await response.json();
  assert.equal(data.configured, true);
  assert.equal(data.needsUnlock, true);
  assert.equal(data.balance, null);
  assert.equal(data.demoBudget, undefined);
  assert.equal(data.models[0].estimatedCost, 0.3024);
  assert.equal(data.models[1].estimatedCost, 0.4);
  assert.equal(data.presets.length, 3);
  assert.ok(!JSON.stringify(data).includes(API_KEY));
  assert.equal(f.calls.some((entry) => entry.url.endsWith('/key')), false);
});

test('owner can unlock config before supplying key; unset passcode fails closed', async () => {
  const f = fixture();
  delete f.env.OPENROUTER_API_KEY;
  const data = await (await call(f, '/config')).json();
  assert.equal(data.unlocked, true);
  assert.equal(data.configured, false);
  assert.equal(data.generationEnabled, false);
  assert.equal(data.demoBudget.label, 'App spending cap');
  delete f.env.DEMO_PASSCODE;
  assert.equal((await generate(f)).status, 503);
  assert.equal(f.submits, 0);
});

test('paid/settings/select/reference routes reject unauthenticated callers', async () => {
  const f = fixture();
  for (const path of ['/generate', '/settings', '/references', '/comparisons/not-real/select']) {
    const response = await call(f, path, { method: 'POST', body: {}, owner: false });
    assert.equal(response.status, 401);
  }
  assert.equal((await call(f, '/balance', { owner: false })).status, 401);
  assert.equal(f.submits, 0);
});

test('settings verifies then AES-GCM encrypts key, never returns plaintext', async () => {
  const f = fixture();
  delete f.env.OPENROUTER_API_KEY;
  const response = await call(f, '/settings', { method: 'POST', body: { apiKey: API_KEY } });
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(API_KEY));
  const saved = f.db.sqlite.prepare('SELECT encrypted_key FROM takehome_settings').get().encrypted_key;
  assert.ok(saved.startsWith('v1:'));
  assert.ok(!saved.includes(API_KEY));
  assert.equal(await __testing.apiKey(f.env), API_KEY);
  f.env.DEMO_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
  await assert.rejects(__testing.apiKey(f.env), /cannot be decrypted/);
});

test('unverified keys are never saved and env key takes precedence', async () => {
  const f = fixture({ invalidKey: true });
  assert.equal((await call(f, '/settings', { method: 'POST', body: { apiKey: API_KEY } })).status, 409);
  delete f.env.OPENROUTER_API_KEY;
  assert.equal((await call(f, '/settings', { method: 'POST', body: { apiKey: API_KEY } })).status, 400);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_settings').get().count, 0);
});

test('streaming JSON byte bound rejects chunked payloads and large POSTs', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10_000)); controller.enqueue(new Uint8Array(10_000)); controller.close(); } });
  await assert.rejects(__testing.boundedJson(new Response(stream)), (error) => error.status === 413);
  const f = fixture();
  const response = await generate(f, 'skateboard', 'request-too-big', { prompt: 'x'.repeat(17_000) });
  assert.equal(response.status, 413);
  assert.equal(f.submits, 0);
});

test('two real-shaped submits use exact references and durable request deduplication', async () => {
  const f = fixture();
  const [one, two] = await Promise.all([generate(f), generate(f)]);
  assert.ok([200, 202].includes(one.status));
  assert.ok([200, 202].includes(two.status));
  assert.equal(f.submits, 2);
  const a = (await one.json()).comparison;
  const b = (await two.json()).comparison;
  assert.equal(a.id, b.id);
  const submissions = f.calls.filter((entry) => entry.init.method === 'POST');
  const body = JSON.parse(submissions[0].init.body);
  assert.equal(body.duration, 4);
  assert.equal(body.generate_audio, false);
  assert.equal(body.input_references[0].image_url.url, PRESETS[0].productImage);
  assert.equal(body.input_references[1].image_url.url, PRESETS[0].meiliImage);
  assert.equal(body.frame_images, undefined);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_reservations').get().count, 1);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 702400);
  const blocked = await generate(f, 'skateboard', 'other-request-1');
  assert.equal(blocked.status, 409);
  assert.equal(f.submits, 2);
});

test('concurrent different requests for one preset charge only one comparison', async () => {
  const f = fixture();
  const results = await Promise.all([generate(f, 'stairs', 'competing-request-1'), generate(f, 'stairs', 'competing-request-2')]);
  assert.deepEqual(results.map((response) => response.status).sort(), [202, 409]);
  assert.equal(f.submits, 2);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_comparisons').get().count, 1);
});

test('polling stores actual cost, completed comparisons are public, selection persists', async () => {
  const f = fixture();
  const initial = (await (await generate(f)).json()).comparison;
  assert.equal((await call(f, `/comparisons/${initial.id}`, { owner: false })).status, 404);
  const completed = (await (await call(f, `/comparisons/${initial.id}`)).json()).comparison;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.actualCost, 0.666);
  assert.equal(completed.jobs[0].cost, 0.333);
  assert.equal(f.polls, 2);
  assert.equal((await call(f, `/comparisons/${initial.id}`, { owner: false })).status, 200);
  const selection = await call(f, `/comparisons/${initial.id}/select`, { method: 'POST', body: { jobId: 'video-2' } });
  assert.equal((await selection.json()).comparison.selectedJobId, 'video-2');
  assert.equal((await call(f, `/comparisons/${initial.id}/select`, { method: 'POST', body: { jobId: 'foreign-video' } })).status, 400);
  assert.equal((await generate(f, 'skateboard', 'new-request-id')).status, 409);
  assert.equal((await generate(f, 'skateboard', 'new-request-id', { regenerate: true })).status, 202);
});

test('poll throttling prevents repeated upstream calls', async () => {
  const f = fixture({ poll: () => Response.json({ status: 'in_progress' }) });
  const initial = (await (await generate(f)).json()).comparison;
  await call(f, `/comparisons/${initial.id}`);
  await call(f, `/comparisons/${initial.id}`);
  assert.equal(f.polls, 2);
});

test('partial failure retains usable output and video streams without owner header', async () => {
  const f = fixture({ poll: (count) => Response.json(count === 1 ? { status: 'completed', usage: { cost: 0.3 } } : { status: 'failed', error: { message: API_KEY } }) });
  const initial = (await (await generate(f)).json()).comparison;
  const result = (await (await call(f, `/comparisons/${initial.id}`)).json()).comparison;
  assert.equal(result.status, 'partial');
  assert.equal(result.jobs[0].status, 'completed');
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  const video = await call(f, '/videos/video-1/content', { owner: false });
  assert.equal(video.status, 200);
  assert.equal(video.headers.get('Content-Type'), 'video/mp4');
  assert.equal((await video.arrayBuffer()).byteLength, MP4.length);
  const fetched = f.calls.find((entry) => entry.url.endsWith('/content?index=0'));
  assert.equal(fetched.init.headers.get('Authorization'), `Bearer ${API_KEY}`);
});

test('a completed side plays while partner is pending', async () => {
  const f = fixture({ poll: (count) => Response.json({ status: count === 1 ? 'completed' : 'in_progress' }) });
  const initial = (await (await generate(f)).json()).comparison;
  await call(f, `/comparisons/${initial.id}`);
  assert.equal((await call(f, '/videos/video-1/content', { owner: false })).status, 200);
  assert.equal((await call(f, '/videos/video-2/content', { owner: false })).status, 404);
});

test('unknown submission outcomes hold the lock and cannot be retried or duplicated', async () => {
  const f = fixture({ submit: () => { throw new Error('Network disconnected after request'); } });
  const initial = (await (await generate(f)).json()).comparison;
  assert.equal(initial.status, 'unknown');
  assert.ok(initial.jobs.every((job) => job.status === 'unknown'));
  await generate(f);
  assert.equal((await generate(f, 'skateboard', 'unsafe-retry', { regenerate: true })).status, 409);
  assert.equal(f.submits, 2);
});

test('server rejection can end cleanly; HTTP 500 remains unknown', async () => {
  const f = fixture({ submit: (count) => Response.json({ error: API_KEY }, { status: count === 1 ? 400 : 500 }) });
  const initial = (await (await generate(f)).json()).comparison;
  assert.equal(initial.jobs[0].status, 'failed');
  assert.equal(initial.jobs[1].status, 'unknown');
  assert.equal(initial.active, true);
});

test('an oversized accepted response is unknown, never mistaken for a rejected charge', async () => {
  const f = fixture({ submit: () => Response.json({ id: 'possibly-charged-job', padding: 'x'.repeat(530_000) }, { status: 202 }) });
  const initial = (await (await generate(f)).json()).comparison;
  assert.equal(initial.status, 'unknown');
  assert.ok(initial.jobs.every((job) => job.status === 'unknown'));
  assert.equal((await generate(f, 'skateboard', 'no-unsafe-retry', { regenerate: true })).status, 409);
});

test('six-attempt preset limit remains while more than $6 of comparisons is allowed', async () => {
  const f = fixture({ immediatelyComplete: true });
  for (let index = 0; index < 6; index += 1) assert.equal((await generate(f, 'skateboard', `attempt-${index}`, { regenerate: index > 0 })).status, 202);
  assert.equal((await generate(f, 'skateboard', 'attempt-seven', { regenerate: true })).status, 409);
  assert.equal(f.submits, 12);
  assert.equal((await generate(f, 'stairs', 'stairs-first')).status, 202);
  assert.equal((await generate(f, 'bed', 'bed-first')).status, 202);
  assert.equal((await generate(f, 'bed', 'bed-next', { regenerate: true })).status, 202);
  assert.equal(f.submits, 18);
  const budget = f.db.sqlite.prepare('SELECT * FROM takehome_budget').get();
  assert.equal(budget.cap_microusd, 20_000_000);
  assert.equal(budget.reserved_microusd, 6_321_600);
});

test('atomic $20 cap admits only one competing pair when remaining budget fits one', async () => {
  const f = fixture({ immediatelyComplete: true });
  // Existing cumulative reservations leave $1: enough for one $0.7024 pair.
  f.db.sqlite.prepare('UPDATE takehome_budget SET reserved_microusd=? WHERE id=1').run(19_000_000);
  const results = await Promise.all([
    generate(f, 'stairs', 'near-cap-stairs'),
    generate(f, 'bed', 'near-cap-bed'),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [202, 409]);
  assert.equal(f.submits, 2);
  const rejected = results.find((response) => response.status === 409);
  assert.match((await rejected.json()).error, /\$20/);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 19_702_400);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_reservations').get().count, 1);
});

test('$20 migration preserves the old reserved amount, encrypted settings, jobs and reservations', () => {
  const sqlite = new DatabaseSync(':memory:');
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  sqlite.exec(schema.replaceAll('20000000', '6000000'));
  sqlite.prepare('UPDATE takehome_budget SET reserved_microusd=? WHERE id=1').run(1_404_800);
  sqlite.prepare('INSERT INTO takehome_settings(id,encrypted_key,updated_at) VALUES(1,?,?)').run('v1:existing-iv:existing-encrypted-key', 123);
  sqlite.prepare("INSERT INTO takehome_comparisons(id,request_id,preset_id,prompt,active,status,estimated_microusd,created_at,updated_at) VALUES('old-comparison','old-request','bed','Existing brief',0,'completed',702400,123,124)").run();
  sqlite.prepare("INSERT INTO takehome_jobs(id,comparison_id,slot,model,status,upstream_job_id,estimated_microusd,actual_cost,created_at,updated_at) VALUES('old-job','old-comparison',0,'alibaba/wan-2.7','completed','existing-upstream-job',400000,0.4,123,124)").run();
  sqlite.prepare("INSERT INTO takehome_reservations(comparison_id,estimated_microusd,created_at) VALUES('old-comparison',702400,123)").run();
  const tables = ['takehome_settings', 'takehome_comparisons', 'takehome_jobs', 'takehome_reservations'];
  const before = Object.fromEntries(tables.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table}`).all()]));
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(readFileSync(new URL('./budget-20-migration.sql', import.meta.url), 'utf8'));
    sqlite.exec('COMMIT');
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  const budget = sqlite.prepare('SELECT * FROM takehome_budget').get();
  assert.equal(budget.cap_microusd, 20_000_000);
  assert.equal(budget.reserved_microusd, 1_404_800);
  assert.equal(budget.id, 1);
  for (const table of tables) assert.deepEqual(sqlite.prepare(`SELECT * FROM ${table}`).all(), before[table]);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='takehome_budget_before_20'").get(), undefined);
  assert.throws(() => sqlite.prepare('UPDATE takehome_budget SET cap_microusd=6000000 WHERE id=1').run(), /CHECK constraint failed/);
});

test('missing Wan falls back to Fast and incompatible models disable admission', async () => {
  const f = fixture({ catalog: MODEL_CATALOG.filter((model) => model.id !== 'alibaba/wan-2.7') });
  const data = await (await call(f, '/config')).json();
  assert.equal(data.models[1].id, 'bytedance/seedance-2.0-fast');
  assert.equal(data.models[1].estimatedCost, 0.36288);
  const unavailable = fixture({ catalog: MODEL_CATALOG.map((model) => ({ ...model, supported_durations: [8] })) });
  assert.equal((await generate(unavailable)).status, 503);
  assert.equal(unavailable.submits, 0);
});

test('unlimited API key balance remains null and app cap is separately labeled', async () => {
  const f = fixture({ unlimited: true });
  const data = await (await call(f, '/config')).json();
  assert.equal(data.balance.remaining, null);
  assert.equal(data.balance.note, 'Balance unavailable with this key.');
  assert.equal(data.demoBudget.remaining, 20);
  assert.equal(data.demoBudget.label, 'App spending cap');
});

test('official product extractor strips tracking, rejects redirects and nonofficial hosts', async () => {
  const f = fixture();
  const response = await call(f, '/references', { method: 'POST', body: { url: 'https://www.nomohaus.com/products/leo-bed?utm_source=test#gallery' } });
  assert.deepEqual(await response.json(), { title: 'Leo Bed', images: ['https://www.nomohaus.com/cdn/shop/files/bed.jpg'] });
  const fetched = f.calls.find((entry) => entry.url.endsWith('.js'));
  assert.equal(fetched.url, 'https://www.nomohaus.com/products/leo-bed.js');
  assert.equal(fetched.init.redirect, 'error');
  for (const url of ['https://127.0.0.1/products/a', 'https://www.nomohaus.com.evil.example/products/a', 'https://www.nomohaus.com@127.0.0.1/products/a', 'https://www.nomohaus.com:444/products/a', 'https://www.nomohaus.com/pages/landing']) {
    assert.equal((await call(f, '/references', { method: 'POST', body: { url } })).status, 400);
  }
});

test('extra refs validate, persist and append to default product and dog references', async () => {
  const f = fixture();
  assert.equal((await generate(f, 'bed', 'invalid-reference', { referenceUrls: ['https://localhost/internal'] })).status, 400);
  assert.equal(f.submits, 0);
  const image = 'https://cdn.shopify.com/s/files/1/0000/files/leo-bed.jpg';
  const result = (await (await generate(f, 'bed', 'valid-reference', { referenceUrls: [image] })).json()).comparison;
  assert.equal(result.referenceUrls.length, 3);
  assert.equal(result.referenceUrls[2], image);
  const submitted = JSON.parse(f.calls.find((entry) => entry.init.method === 'POST').init.body);
  assert.equal(submitted.input_references[2].image_url.url, image);
});

test('definite 402 rejection preserves actionable reason, releases local estimates, and gates retries', async () => {
  const f = fixture({ submit: () => Response.json({ error: { message: `Insufficient credits for ${API_KEY}; passcode ${PASSCODE}`, metadata: { limit_source: 'api_key', remedy_hint: 'Increase the key limit' } } }, { status: 402, headers: { 'Retry-After': '30' } }) });
  const initial = (await (await generate(f)).json()).comparison;
  assert.equal(initial.status, 'rejected');
  assert.equal(initial.active, false);
  assert.equal(initial.actualCost, null);
  assert.equal(initial.releasedEstimate, 0.7024);
  assert.equal(initial.reservedEstimate, 0);
  for (const job of initial.jobs) {
    assert.equal(job.submissionStatus, 'rejected');
    assert.equal(job.errorStatus, 402);
    assert.equal(job.billingStatus, 'not_submitted');
    assert.equal(job.cost, null);
    assert.match(job.errorMessage, /Insufficient credits/);
    assert.equal(job.providerError.limitSource, 'api_key');
    assert.equal(job.providerError.remedyHint, 'Increase the key limit');
    assert.equal(job.providerError.retryAfter, '30');
  }
  assert.ok(!JSON.stringify(initial).includes(API_KEY));
  assert.ok(!JSON.stringify(initial).includes(PASSCODE));
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 0);
  await __testing.releaseRejectedReservations(f.env);
  await __testing.releaseRejectedReservations(f.env);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 0);
  const blocked = await generate(f, 'stairs', 'payment-blind-retry');
  assert.equal(blocked.status, 402);
  assert.equal(f.submits, 2);
  assert.equal((await blocked.json()).generationBlocked.requiresPaymentAcknowledgement, true);
  const config = await (await call(f, '/config')).json();
  assert.equal(config.generationEnabled, true);
  assert.equal(config.generationBlocked.errorStatus, 402);
  assert.equal(config.demoBudget.remaining, 20);
  assert.equal((await generate(f, 'stairs', 'payment-checked-retry', { paymentAcknowledged: true })).status, 202);
  assert.equal(f.submits, 4);
});

test('accepted generation failures and unknown submissions retain reserved estimates', async () => {
  const accepted = fixture({ poll: () => Response.json({ status: 'failed', error: `Provider render failure ${API_KEY}` }) });
  const first = (await (await generate(accepted)).json()).comparison;
  const failed = (await (await call(accepted, `/comparisons/${first.id}`)).json()).comparison;
  assert.equal(failed.status, 'failed');
  assert.ok(failed.jobs.every((job) => job.submissionStatus === 'accepted' && !job.rejected && job.billingStatus === 'unconfirmed'));
  assert.equal(failed.releasedEstimate, 0);
  assert.equal(failed.actualCost, null);
  assert.equal(accepted.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 702400);
  assert.ok(!JSON.stringify(failed).includes(API_KEY));
  const unknown = fixture({ submit: () => { throw new Error('Response lost'); } });
  const uncertain = (await (await generate(unknown)).json()).comparison;
  assert.ok(uncertain.jobs.every((job) => job.billingStatus === 'unknown'));
  assert.equal(uncertain.releasedEstimate, 0);
  assert.equal(unknown.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 702400);
});

test('rejected pre-job comparisons do not consume the six accepted-attempt allowance', async () => {
  const f = fixture({ submit: () => Response.json({ error: { message: 'Invalid model parameters' } }, { status: 400 }) });
  for (let index = 0; index < 8; index += 1) {
    const result = await generate(f, 'skateboard', `rejected-attempt-${index}`, { regenerate: index > 0 });
    assert.equal(result.status, 202);
    assert.equal((await result.json()).comparison.status, 'rejected');
  }
  assert.equal(f.submits, 16);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 0);
});

test('owner diagnostics whitelist key usage and truthfully report unavailable account balance', async () => {
  const f = fixture({ keyData: { label: API_KEY, creator_user_id: 'private-id', is_management_key: false, is_free_tier: false, usage: 0, usage_daily: 0, usage_weekly: 0, usage_monthly: 0, limit: 20, limit_remaining: 20, effective_budget: { limit_usd: 10, remaining_usd: 10, spend_usd: 0, guardrail_id: 'private-budget-id' } } });
  assert.equal((await call(f, '/diagnostics', { owner: false })).status, 401);
  const response = await call(f, '/diagnostics');
  const result = await response.json();
  assert.equal(result.key.usage, 0);
  assert.equal(result.key.limitRemaining, 20);
  assert.equal(result.key.isFreeTier, false);
  assert.deepEqual(result.key.effectiveBudget, { limit: 10, remaining: 10, spent: 0 });
  assert.equal(result.accountCredits.available, false);
  assert.equal(result.accountCredits.errorStatus, 403);
  assert.equal(result.accountCredits.remaining, null);
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  assert.ok(!JSON.stringify(result).includes('private-id'));
  assert.ok(!JSON.stringify(result).includes('private-budget-id'));
  assert.equal(f.submits, 0);
});

test('migration releases historical rejected requests and preserves accepted/unknown reservations', async () => {
  const f = fixture();
  const oldSchema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
    .replace(/  submission_status TEXT NOT NULL DEFAULT 'planned',\n  error_status INTEGER,\n  error_details_json TEXT NOT NULL DEFAULT '\{\}',\n/, '')
    .replace(/\n-- This releases local estimates only,[\s\S]*$/, '');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(oldSchema);
  sqlite.prepare('INSERT INTO takehome_settings(id,encrypted_key,updated_at) VALUES(1,?,1)').run('encrypted-existing-secret');
  const insertComparison = sqlite.prepare("INSERT INTO takehome_comparisons(id,request_id,preset_id,prompt,status,active,estimated_microusd,created_at,updated_at) VALUES(?,?,?,'Example',?,0,702400,1,1)");
  const insertJob = sqlite.prepare('INSERT INTO takehome_jobs(id,comparison_id,slot,model,status,upstream_job_id,estimated_microusd,actual_cost,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,1)');
  for (const [id, preset, kind] of [['rejected-one','skateboard','failed'], ['accepted-one','stairs','failed'], ['unknown-one','bed','unknown']]) {
    insertComparison.run(id, `${id}-request`, preset, kind);
    sqlite.prepare('INSERT INTO takehome_reservations VALUES(?,702400,1)').run(id);
    insertJob.run(`${id}-a`, id, 0, 'mini', kind, id === 'accepted-one' ? 'upstream-a' : null, 302400, null, id === 'rejected-one' ? 'Submission rejected (HTTP 402). No automatic retry.' : 'Failure');
    insertJob.run(`${id}-b`, id, 1, 'wan', kind, id === 'accepted-one' ? 'upstream-b' : null, 400000, null, id === 'rejected-one' ? 'Submission rejected (HTTP 402). No automatic retry.' : 'Failure');
  }
  sqlite.prepare('UPDATE takehome_budget SET reserved_microusd=2107200 WHERE id=1').run();
  sqlite.exec('BEGIN');
  try { sqlite.exec(readFileSync(new URL('./rejected-reservations-migration.sql', import.meta.url), 'utf8')); sqlite.exec('COMMIT'); }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  assert.equal(sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 1_404_800);
  assert.equal(sqlite.prepare('SELECT cap_microusd FROM takehome_budget').get().cap_microusd, 20_000_000);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_reservation_releases').get().count, 2);
  assert.equal(sqlite.prepare("SELECT submission_status FROM takehome_jobs WHERE id='rejected-one-a'").get().submission_status, 'rejected');
  assert.equal(sqlite.prepare("SELECT status FROM takehome_comparisons WHERE id='rejected-one'").get().status, 'rejected');
  assert.equal(sqlite.prepare("SELECT submission_status FROM takehome_jobs WHERE id='accepted-one-a'").get().submission_status, 'accepted');
  assert.equal(sqlite.prepare('SELECT encrypted_key FROM takehome_settings').get().encrypted_key, 'encrypted-existing-secret');
  f.db.sqlite = sqlite;
  return __testing.releaseRejectedReservations(f.env).then(() => {
    assert.equal(sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 1_404_800);
  });
});

test('zero purchased-credit totals do not block a usable key or infer promotional eligibility', async () => {
  const f = fixture({ accountCredits: { total_credits: 0, total_usage: 0 }, keyData: { limit: 100, limit_remaining: 100, usage: 0 } });
  const config = await (await call(f, '/config')).json();
  assert.equal(config.balance.kind, 'purchased_credits');
  assert.equal(config.balance.label, 'Reported purchased credits');
  assert.equal(config.balance.remaining, 0);
  assert.equal(config.balance.keyBudget.remaining, 100);
  const response = await generate(f);
  assert.equal(response.status, 202);
  assert.match(config.balance.note, /Promotional-credit coverage is unverified/);
  assert.equal(f.submits, 2);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_comparisons').get().count, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_reservations').get().count, 1);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 702400);
});

test('unknown account balance remains explicitly key budget and does not invent a funding block', async () => {
  const f = fixture();
  const config = await (await call(f, '/config')).json();
  assert.equal(config.balance.kind, 'key_budget');
  assert.equal(config.balance.label, 'API key budget remaining');
  assert.equal((await generate(f)).status, 202);
  assert.equal(f.submits, 2);
});

test('an exhausted key budget prevents paid POSTs even when the account is funded', async () => {
  const f = fixture({ accountCredits: { total_credits: 20, total_usage: 0 }, keyData: { limit_remaining: 0, usage: 0 } });
  const response = await generate(f);
  assert.equal(response.status, 402);
  assert.match((await response.json()).error, /API key has \$0\.00/);
  assert.equal(f.submits, 0);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM takehome_cache WHERE key='payment-block'").get().count, 0);
});

test('old account preflight gates are ignored and cleared after a fresh key check', async () => {
  const f = fixture({ accountCredits: { total_credits: 0, total_usage: 0 } });
  f.db.sqlite.prepare("INSERT INTO takehome_cache(key,value,updated_at) VALUES('payment-block',?,1)").run(JSON.stringify({ preflight: true, reason: 'payment', errorStatus: 402, message: 'Old inferred zero account balance', requiresPaymentAcknowledgement: true }));
  assert.equal((await (await call(f, '/config')).json()).generationBlocked, null);
  assert.equal((await generate(f)).status, 202);
  assert.equal(f.submits, 2);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM takehome_cache WHERE key='payment-block'").get().count, 0);
});

test('credit diagnostics expose bounded numeric totals without claiming promo coverage', async () => {
  const f = fixture({ accountCredits: { total_credits: 0, total_usage: 0, promo_credits: 20, coupon_usage: 0, credit_account_id: 123, secret: 'do-not-expose' } });
  const data = await (await call(f, '/diagnostics')).json();
  assert.equal(data.accountCredits.kind, 'purchased_credits');
  assert.equal(data.accountCredits.totalCredits, 0);
  assert.equal(data.accountCredits.totalUsage, 0);
  assert.deepEqual(data.accountCredits.reportedNumericTotals, { total_credits: 0, total_usage: 0, promo_credits: 20, coupon_usage: 0 });
  assert.match(data.accountCredits.note, /promotional-credit coverage is unverified/);
  assert.ok(!JSON.stringify(data).includes('do-not-expose'));
});

test('cheap draft submits one Mini 480p job and terminates without automatic second generation', async () => {
  const f = fixture();
  const config = await (await call(f, '/config')).json();
  assert.equal(config.draftEnabled, true);
  assert.equal(config.draftModel.id, 'bytedance/seedance-2.0-mini');
  assert.equal(config.draftModel.resolution, '480p');
  assert.equal(config.draftModel.estimatedCost, 0.134505);
  assert.equal(config.secondModel.id, 'alibaba/wan-2.7');
  const initial = (await (await generate(f, 'bed', 'draft-stage-one', { mode: 'draft' })).json()).comparison;
  assert.equal(initial.mode, 'draft');
  assert.equal(initial.jobs.length, 1);
  assert.equal(initial.jobs[0].resolution, '480p');
  assert.equal(initial.jobs[0].duration, 4);
  assert.equal(initial.jobs[0].aspectRatio, '9:16');
  assert.equal(initial.estimatedCost, 0.134505);
  assert.equal(initial.canRequestSecondModel, false);
  assert.equal(f.submits, 1);
  const body = JSON.parse(f.calls.find((entry) => entry.init.method === 'POST').init.body);
  assert.equal(body.resolution, '480p');
  assert.equal(body.generate_audio, false);
  assert.equal(body.input_references.length, 2);
  const done = (await (await call(f, `/comparisons/${initial.id}`)).json()).comparison;
  assert.equal(done.status, 'completed');
  assert.equal(done.active, false);
  assert.equal(done.actualCost, 0.333);
  assert.equal(done.canRequestSecondModel, true);
  assert.equal(f.submits, 1);
});

test('second model requires a terminal first draft and explicit paid confirmation', async () => {
  const f = fixture();
  const initial = (await (await generate(f, 'stairs', 'draft-wait-confirm', { mode: 'draft' })).json()).comparison;
  assert.equal((await second(f, initial.id, 'second-before-ready')).status, 409);
  await call(f, `/comparisons/${initial.id}`);
  assert.equal((await second(f, initial.id, 'second-no-confirm', { confirmed: false })).status, 400);
  assert.equal(f.submits, 1);
  const response = await second(f, initial.id);
  assert.equal(response.status, 202);
  const result = (await response.json()).comparison;
  assert.equal(result.jobs.length, 2);
  assert.equal(result.mode, 'draft');
  assert.equal(result.secondModelRequested, true);
  assert.equal(result.canRequestSecondModel, false);
  assert.equal(result.jobs[1].model, 'alibaba/wan-2.7');
  assert.equal(result.jobs[1].resolution, '720p');
  assert.equal(result.jobs[0].resolution, '480p');
  assert.equal(result.estimatedCost, 0.534505);
  assert.equal(f.submits, 2);
  const requests = f.calls.filter((entry) => entry.init.method === 'POST').map((entry) => JSON.parse(entry.init.body));
  assert.deepEqual(requests[1].input_references, requests[0].input_references);
  assert.equal(requests[1].prompt, requests[0].prompt);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 534505);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_comparisons').get().count, 1);
  assert.equal((await second(f, initial.id)).status, 200);
  assert.equal((await second(f, initial.id, 'third-is-forbidden')).status, 409);
  assert.equal(f.submits, 2);
});

test('concurrent second-stage duplicate or competing requests submit only one extra job', async () => {
  for (const sameId of [true, false]) {
    const f = fixture({ immediatelyComplete: true });
    const initial = (await (await generate(f, 'bed', 'draft-concurrent', { mode: 'draft' })).json()).comparison;
    const results = await Promise.all([second(f, initial.id, 'second-concurrent-one'), second(f, initial.id, sameId ? 'second-concurrent-one' : 'second-concurrent-two')]);
    assert.deepEqual(results.map((entry) => entry.status).sort(), sameId ? [200, 202] : [202, 409]);
    assert.equal(f.submits, 2);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_jobs').get().count, 2);
    assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 534505);
  }
});

test('unknown first or second-stage submission never triggers an automatic retry', async () => {
  const unknownFirst = fixture({ submit: () => { throw new Error('Lost first response'); } });
  const first = (await (await generate(unknownFirst, 'bed', 'draft-unknown-one', { mode: 'draft' })).json()).comparison;
  assert.equal(first.status, 'unknown');
  assert.equal((await second(unknownFirst, first.id)).status, 409);
  assert.equal(unknownFirst.submits, 1);
  const unknownSecond = fixture({ submit: (count) => {
    if (count === 1) return Response.json({ id: 'known-first-job', status: 'completed', usage: { cost: 0.14 } });
    throw new Error('Lost second response');
  } });
  const done = (await (await generate(unknownSecond, 'bed', 'draft-unknown-two', { mode: 'draft' })).json()).comparison;
  const uncertain = (await (await second(unknownSecond, done.id)).json()).comparison;
  assert.equal(uncertain.status, 'unknown');
  assert.equal(uncertain.active, true);
  assert.equal(uncertain.reservedEstimate, 0.534505);
  await second(unknownSecond, done.id);
  assert.equal((await second(unknownSecond, done.id, 'another-second-id')).status, 409);
  assert.equal(unknownSecond.submits, 2);
});

test('rejected second releases only its estimate; a rejected first can explicitly expand', async () => {
  for (const rejectFirst of [false, true]) {
    const f = fixture({ submit: (count) => count === (rejectFirst ? 1 : 2)
      ? Response.json({ error: { message: 'Input rejected' } }, { status: 400 })
      : Response.json({ id: `stage-job-${count}`, status: 'completed', usage: { cost: 0.14 } }) });
    const initial = (await (await generate(f, 'stairs', 'draft-release-case', { mode: 'draft' })).json()).comparison;
    assert.equal(initial.canRequestSecondModel, true);
    const result = (await (await second(f, initial.id)).json()).comparison;
    assert.equal(result.status, 'partial');
    assert.equal(result.releasedEstimate, rejectFirst ? 0.134505 : 0.4);
    assert.equal(result.reservedEstimate, rejectFirst ? 0.4 : 0.134505);
    await __testing.releaseRejectedReservations(f.env);
    assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, rejectFirst ? 400000 : 134505);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_reservation_releases').get().count, 1);
  }
});

test('stale draft cannot expand after a newer attempt or steal an active preset lock', async () => {
  const f = fixture({ immediatelyComplete: true });
  const old = (await (await generate(f, 'bed', 'old-draft-to-expand', { mode: 'draft' })).json()).comparison;
  const latest = (await (await generate(f, 'bed', 'new-draft-attempt', { mode: 'draft', regenerate: true })).json()).comparison;
  const rejected = await second(f, old.id);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).latestComparisonId, latest.id);
  assert.equal(f.submits, 2);
});

test('second-stage budget reservations compete atomically and respect key limits', async () => {
  const f = fixture({ immediatelyComplete: true });
  const one = (await (await generate(f, 'bed', 'budget-draft-one', { mode: 'draft' })).json()).comparison;
  const two = (await (await generate(f, 'stairs', 'budget-draft-two', { mode: 'draft' })).json()).comparison;
  f.db.sqlite.prepare('UPDATE takehome_budget SET reserved_microusd=19500000 WHERE id=1').run();
  const competing = await Promise.all([second(f, one.id, 'budget-second-one'), second(f, two.id, 'budget-second-two')]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [202, 409]);
  assert.equal(f.submits, 3);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 19900000);
  const keyData = { limit_remaining: 20 };
  const limited = fixture({ immediatelyComplete: true, keyData });
  const draft = (await (await generate(limited, 'bed', 'key-limit-draft', { mode: 'draft' })).json()).comparison;
  keyData.limit_remaining = 0.1;
  assert.equal((await second(limited, draft.id)).status, 402);
  assert.equal(limited.submits, 1);
  assert.equal(limited.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 134505);
});

test('second-stage model falls back to distinct Fast 720p without silent paid fallback', async () => {
  const f = fixture({ immediatelyComplete: true, catalog: MODEL_CATALOG.filter((model) => model.id !== 'alibaba/wan-2.7') });
  const draft = (await (await generate(f, 'bed', 'fallback-draft-test', { mode: 'draft' })).json()).comparison;
  const expanded = (await (await second(f, draft.id)).json()).comparison;
  assert.equal(expanded.jobs[1].model, 'bytedance/seedance-2.0-fast');
  assert.equal(expanded.jobs[1].resolution, '720p');
  assert.equal(f.submits, 2);
  const missingMini = fixture({ catalog: MODEL_CATALOG.filter((model) => model.id !== 'bytedance/seedance-2.0-mini') });
  const fallback = await generate(missingMini, 'bed', 'no-mini-draft-test', { mode: 'draft' });
  assert.equal(fallback.status, 202);
  assert.equal((await fallback.json()).comparison.jobs[0].model, 'bytedance/seedance-2.0-fast');
  assert.equal(missingMini.submits, 1);
});

test('finalization cannot unlock a newly admitted second job and submission claim is single-use', async () => {
  let releaseSecond;
  let signalSecond;
  const secondStarted = new Promise((resolve) => { signalSecond = resolve; });
  const f = fixture({ submit: (count) => {
    if (count === 1) return Response.json({ id: 'safe-first-job', status: 'completed' });
    signalSecond();
    return new Promise((resolve) => { releaseSecond = () => resolve(Response.json({ id: 'safe-second-job', status: 'pending' })); });
  } });
  const draft = (await (await generate(f, 'bed', 'race-finalize-draft', { mode: 'draft' })).json()).comparison;
  const expandedPromise = second(f, draft.id);
  await secondStarted;
  await __testing.finishComparison(f.env, draft.id);
  assert.equal(f.db.sqlite.prepare('SELECT active FROM takehome_comparisons WHERE id=?').get(draft.id).active, 1);
  releaseSecond();
  assert.equal((await expandedPromise).status, 202);
  const localJob = f.db.sqlite.prepare('SELECT * FROM takehome_jobs WHERE comparison_id=? AND slot=1').get(draft.id);
  await __testing.submitJob(f.env, API_KEY, { id: localJob.id, model: localJob.model }, [], 'Never resubmit');
  assert.equal(f.submits, 2);
});

test('cheap-draft migration preserves historic compare videos, selection, key and budget', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const oldSchema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
    .replace("  last_poll_at INTEGER NOT NULL DEFAULT 0,\n  mode TEXT NOT NULL DEFAULT 'compare' CHECK (mode IN ('compare','draft')),\n  second_request_id TEXT", '  last_poll_at INTEGER NOT NULL DEFAULT 0')
    .replace(/CREATE UNIQUE INDEX IF NOT EXISTS takehome_second_request_unique\n  ON takehome_comparisons\(second_request_id\) WHERE second_request_id IS NOT NULL;\n/, '')
    .replace("  resolution TEXT NOT NULL DEFAULT '720p',\n  duration INTEGER NOT NULL DEFAULT 4,\n  aspect_ratio TEXT NOT NULL DEFAULT '9:16',\n", '');
  sqlite.exec(oldSchema);
  sqlite.prepare("INSERT INTO takehome_settings VALUES(1,'existing-encrypted-key',1)").run();
  sqlite.prepare("INSERT INTO takehome_comparisons(id,request_id,preset_id,prompt,status,active,estimated_microusd,selected_job_id,created_at,updated_at) VALUES('legacy-compare','legacy-request','bed','Existing prompt','completed',0,702400,'legacy-job-a',1,1)").run();
  for (const [id, slot] of [['legacy-job-a', 0], ['legacy-job-b', 1]]) sqlite.prepare("INSERT INTO takehome_jobs(id,comparison_id,slot,model,status,submission_status,upstream_job_id,estimated_microusd,actual_cost,created_at,updated_at) VALUES(?,'legacy-compare',?,'existing-model','completed','accepted',?,351200,0.4,1,1)").run(id, slot, `upstream-${id}`);
  sqlite.prepare("INSERT INTO takehome_reservations VALUES('legacy-compare',702400,1)").run();
  sqlite.prepare('UPDATE takehome_budget SET reserved_microusd=702400 WHERE id=1').run();
  sqlite.exec('BEGIN');
  try { sqlite.exec(readFileSync(new URL('./cheap-draft-migration.sql', import.meta.url), 'utf8')); sqlite.exec('COMMIT'); }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  const entry = sqlite.prepare('SELECT * FROM takehome_comparisons').get();
  assert.equal(entry.mode, 'compare');
  assert.equal(entry.second_request_id, null);
  assert.equal(entry.selected_job_id, 'legacy-job-a');
  assert.equal(entry.prompt, 'Existing prompt');
  assert.equal(sqlite.prepare('SELECT encrypted_key FROM takehome_settings').get().encrypted_key, 'existing-encrypted-key');
  assert.equal(sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 702400);
  for (const job of sqlite.prepare('SELECT * FROM takehome_jobs').all()) {
    assert.equal(job.resolution, '720p');
    assert.equal(job.duration, 4);
    assert.equal(job.aspect_ratio, '9:16');
    assert.ok(job.upstream_job_id.startsWith('upstream-legacy-job-'));
    assert.equal(job.actual_cost, 0.4);
  }
});

test('fresh modes do not require regeneration and completed compare does not supersede latest draft', async () => {
  const f = fixture({ immediatelyComplete: true });
  const compare = (await (await generate(f, 'bed', 'mode-first-compare')).json()).comparison;
  const draftResponse = await generate(f, 'bed', 'mode-first-draft', { mode: 'draft' });
  assert.equal(draftResponse.status, 202);
  const draft = (await draftResponse.json()).comparison;
  assert.equal((await generate(f, 'bed', 'mode-first-compare', { mode: 'draft' })).status, 409);
  assert.equal((await generate(f, 'bed', 'mode-new-compare', { mode: 'compare', regenerate: true })).status, 202);
  const snapshot = (await (await call(f, `/comparisons/${draft.id}`)).json()).comparison;
  assert.equal(snapshot.canRequestSecondModel, true);
  assert.equal((await second(f, draft.id)).status, 202);
  assert.equal(f.submits, 6);
  assert.equal(compare.mode, 'compare');
});

test('global active preset lock spans modes and disables alternate-model eligibility', async () => {
  const f = fixture();
  const draft = (await (await generate(f, 'stairs', 'active-mode-draft', { mode: 'draft' })).json()).comparison;
  assert.equal((await generate(f, 'stairs', 'active-mode-compare')).status, 409);
  await call(f, `/comparisons/${draft.id}`);
  assert.equal((await generate(f, 'stairs', 'active-mode-compare')).status, 202);
  assert.equal((await (await call(f, `/comparisons/${draft.id}`)).json()).comparison.canRequestSecondModel, false);
  assert.equal((await second(f, draft.id)).status, 409);
  assert.equal(f.submits, 3);
});

test('second stages preserve one comparison attempt and genuine 402 requires explicit acknowledgment', async () => {
  const f = fixture({ immediatelyComplete: true });
  for (let index = 0; index < 6; index += 1) {
    const draft = (await (await generate(f, 'bed', `attempt-draft-${index}`, { mode: 'draft', regenerate: index > 0 })).json()).comparison;
    assert.equal((await second(f, draft.id, `attempt-second-${index}`)).status, 202);
  }
  assert.equal(f.submits, 12);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM takehome_comparisons').get().count, 6);
  assert.equal((await generate(f, 'bed', 'attempt-draft-seventh', { mode: 'draft', regenerate: true })).status, 409);
  const payment = fixture({ submit: (count) => count === 1 ? Response.json({ error: { message: 'Check payment' } }, { status: 402 }) : Response.json({ id: 'paid-after-ack', status: 'completed' }) });
  const rejected = (await (await generate(payment, 'bed', 'payment-first-draft', { mode: 'draft' })).json()).comparison;
  assert.equal((await second(payment, rejected.id)).status, 402);
  assert.equal(payment.submits, 1);
  const accepted = await second(payment, rejected.id, 'payment-second-ack', { paymentAcknowledged: true });
  assert.equal(accepted.status, 202);
  assert.equal(payment.submits, 2);
  assert.equal(payment.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 400000);
});


test('Safari byte ranges and HEAD replay saved video without credentials or upstream', async () => {
  const f = fixture({ immediatelyComplete: true });
  await generate(f);
  const video = await call(f, '/videos/video-1/content', { owner: false, headers: { Range: 'bytes=0-1' } });
  assert.equal(video.status, 206);
  assert.equal(video.headers.get('Content-Range'), `bytes 0-1/${MP4.length}`);
  assert.equal(video.headers.get('Content-Length'), '2');
  assert.equal((await video.arrayBuffer()).byteLength, 2);
  assert.equal(f.env.VIDEO_ARCHIVE.objects.size, 1);
  delete f.env.OPENROUTER_API_KEY;
  f.env.__TAKEHOME_FETCH = () => { throw new Error('Must use archived bytes'); };
  const head = await call(f, '/videos/video-1/content', { method: 'HEAD', owner: false });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), String(MP4.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const replay = await call(f, '/videos/video-1/content', { owner: false });
  assert.deepEqual(Buffer.from(await replay.arrayBuffer()), MP4);
  const invalid = await call(f, '/videos/video-1/content', { owner: false, headers: { Range: 'bytes=99999-' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('Content-Range'), `bytes */${MP4.length}`);
  assert.equal(f.submits, 2);
});

test('background maintenance finishes and saves accepted jobs after browser closes, without new submissions', async () => {
  const f = fixture();
  const initial = (await (await generate(f)).json()).comparison;
  await maintainTakehomeVideos(f.env);
  const publicView = (await (await call(f, '/config', { owner: false })).json()).comparisons;
  assert.equal(publicView.find(c => c.id === initial.id)?.status, 'completed');
  assert.equal(f.env.VIDEO_ARCHIVE.objects.size, 2);
  assert.equal(f.submits, 2);
  const fetchCount = f.calls.filter(c => c.url.includes('/content?')).length;
  await maintainTakehomeVideos(f.env);
  assert.equal(f.calls.filter(c => c.url.includes('/content?')).length, fetchCount);
  assert.equal(f.submits, 2);
});

test('model options expose only compatible curated profiles and preserve recommended defaults', async () => {
  const f = fixture({ catalog: [...MODEL_CATALOG, { ...MODEL_CATALOG[0], id: 'unapproved/free-model' }] });
  const data = await (await call(f, '/config', { owner: false })).json();
  assert.deepEqual(data.modelOptions.draft.map(m => m.id), ['bytedance/seedance-2.0-mini', 'bytedance/seedance-2.0-fast']);
  assert.deepEqual(data.modelOptions.compare.map(m => m.id), MODEL_CATALOG.map(m => m.id));
  assert.deepEqual(new Set(data.modelOptions.second.map(m => m.id)), new Set(MODEL_CATALOG.map(m => m.id)));
  for (const [mode, profiles] of Object.entries(data.modelOptions)) for (const profile of profiles) {
    assert.equal(profile.resolution, mode === 'draft' ? '480p' : '720p');
    assert.equal(profile.duration, 4);
    assert.equal(profile.aspectRatio, '9:16');
    assert.equal(profile.audio, false);
    assert.ok(profile.estimatedCost > 0);
  }
  assert.equal(data.draftModel.id, MODEL_CATALOG[0].id);
  assert.equal(data.secondModel.id, MODEL_CATALOG[1].id);
  assert.deepEqual(data.models.map(m => m.id), MODEL_CATALOG.slice(0, 2).map(m => m.id));
  const unusable = fixture({ catalog: MODEL_CATALOG.map(m => ({ ...m, supported_resolutions: ['1080p'] })) });
  const unavailable = await (await call(unusable, '/config')).json();
  assert.deepEqual(unavailable.modelOptions, { draft: [], compare: [], second: [] });
  assert.equal(unavailable.draftEnabled, false);
  assert.equal(unavailable.generationEnabled, false);
});

test('selected draft and compare models use server profiles and exact server-priced reservations', async () => {
  const fast = 'bytedance/seedance-2.0-fast', wan = 'alibaba/wan-2.7';
  const f = fixture({ immediatelyComplete: true });
  const options = (await (await call(f, '/config')).json()).modelOptions;
  const draftPrice = options.draft.find(m => m.id === fast).estimatedCost;
  const draft = await generate(f, 'bed', 'selected-fast-draft', { mode: 'draft', modelIds: [fast], maxEstimatedCost: draftPrice, estimatedCost: 0, resolution: '1080p' });
  assert.equal(draft.status, 202);
  const saved = (await draft.json()).comparison;
  assert.equal(saved.jobs[0].model, fast);
  assert.equal(saved.jobs[0].resolution, '480p');
  assert.equal(saved.jobs[0].estimatedCost, draftPrice);
  const pairPrice = options.compare.filter(m => [fast, wan].includes(m.id)).reduce((sum, m) => sum + m.estimatedCost, 0);
  const pair = await generate(f, 'stairs', 'selected-fast-wan-pair', { modelIds: [fast, wan], maxEstimatedCost: pairPrice });
  assert.equal(pair.status, 202);
  assert.deepEqual((await pair.json()).comparison.jobs.map(j => j.model), [fast, wan]);
  const posted = f.calls.filter(c => c.init.method === 'POST').map(c => JSON.parse(c.init.body));
  assert.deepEqual(posted.map(p => [p.model, p.resolution]), [[fast, '480p'], [fast, '720p'], [wan, '720p']]);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, Math.round((draftPrice + pairPrice) * 1e6));
  assert.equal(f.submits, 3);
});

test('invalid model selections and prices cannot reach paid submission', async () => {
  const mini = MODEL_CATALOG[0].id, fast = MODEL_CATALOG[2].id;
  const cases = [
    { modelIds: [mini] }, { modelIds: [mini, mini] }, { modelIds: [mini, fast, MODEL_CATALOG[1].id] },
    { modelIds: [mini, 'unknown/model'] }, { modelIds: 'not-an-array' }, { modelIds: [mini, 7] },
    { mode: 'draft', modelIds: [] }, { mode: 'draft', modelIds: [MODEL_CATALOG[1].id] },
    { maxEstimatedCost: null }, { maxEstimatedCost: '0.70' }, { maxEstimatedCost: -1 },
  ];
  for (const extra of cases) {
    const f = fixture();
    assert.equal((await generate(f, 'bed', 'invalid-model-request', extra)).status, 400, JSON.stringify(extra));
    assert.equal(f.submits, 0);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM takehome_comparisons').get().n, 0);
    assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 0);
  }
  const noPrice = fixture({ catalog: MODEL_CATALOG.map(m => m.id === fast ? { ...m, pricing_skus: {} } : m) });
  assert.equal((await generate(noPrice, 'bed', 'unpriced-model-request', { mode: 'draft', modelIds: [fast] })).status, 400);
  assert.equal(noPrice.submits, 0);
});

test('stale client quote returns an updated cap before reservations or paid calls', async () => {
  const fast = MODEL_CATALOG[2].id, f = fixture();
  const profile = (await (await call(f, '/config')).json()).modelOptions.draft.find(m => m.id === fast);
  const response = await generate(f, 'bed', 'quote-confirm-request', { mode: 'draft', modelIds: [fast], maxEstimatedCost: profile.estimatedCost - 0.000001 });
  assert.equal(response.status, 409);
  const stale = await response.json();
  assert.equal(stale.quoteChanged, true);
  assert.equal(stale.estimatedCost, profile.estimatedCost);
  assert.deepEqual(stale.modelIds, [fast]);
  assert.equal(f.submits, 0);
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, 0);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM takehome_comparisons').get().n, 0);
  assert.equal((await generate(f, 'bed', 'quote-confirm-request', { mode: 'draft', modelIds: [fast], maxEstimatedCost: profile.estimatedCost })).status, 202);
  assert.equal(f.submits, 1);
  const limited = fixture({ keyData: { limit_remaining: 0.15 } });
  assert.equal((await generate(limited, 'bed', 'selected-key-budget', { mode: 'draft', modelIds: [fast], maxEstimatedCost: 1 })).status, 402);
  assert.equal(limited.submits, 0);
});

test('matching selections deduplicate across catalog changes and mismatched retries return 409', async () => {
  const mini = MODEL_CATALOG[0].id, fast = MODEL_CATALOG[2].id, f = fixture();
  const body = { mode: 'draft', modelIds: [fast] };
  const original = (await (await generate(f, 'bed', 'selection-idempotency', body)).json()).comparison;
  f.db.sqlite.prepare("UPDATE takehome_cache SET value='[]',updated_at=? WHERE key='models'").run(Date.now());
  const repeat = await generate(f, 'bed', 'selection-idempotency', { ...body, maxEstimatedCost: 0 });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).comparison.id, original.id);
  assert.equal((await generate(f, 'bed', 'selection-idempotency', { mode: 'draft', modelIds: [mini] })).status, 409);
  assert.equal((await generate(f, 'bed', 'selection-idempotency', { mode: 'draft' })).status, 200);
  assert.equal(f.submits, 1);
});

test('competing model choices using the same request ID admit only one paid draft', async () => {
  const f = fixture({ immediatelyComplete: true });
  const responses = await Promise.all([MODEL_CATALOG[0].id, MODEL_CATALOG[2].id].map(id => generate(f, 'bed', 'raced-model-selection', { mode: 'draft', modelIds: [id] })));
  assert.deepEqual(responses.map(r => r.status).sort(), [202, 409]);
  assert.equal(f.submits, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM takehome_jobs').get().n, 1);
  const job = f.db.sqlite.prepare('SELECT estimated_microusd FROM takehome_jobs').get();
  assert.equal(f.db.sqlite.prepare('SELECT reserved_microusd FROM takehome_budget').get().reserved_microusd, job.estimated_microusd);
});

test('changed prompt or references cannot masquerade as a successful idempotent replay', async () => {
  const f = fixture({ immediatelyComplete: true });
  const base = { mode: 'draft', modelIds: [MODEL_CATALOG[0].id], prompt: '  A carefully framed shot.  ' };
  assert.equal((await generate(f, 'bed', 'payload-idempotency', base)).status, 202);
  assert.equal((await generate(f, 'bed', 'payload-idempotency', { ...base, prompt: base.prompt.trim() })).status, 200);
  assert.equal((await generate(f, 'bed', 'payload-idempotency', { ...base, prompt: 'A changed shot.' })).status, 409);
  assert.equal((await generate(f, 'bed', 'payload-idempotency', { ...base, referenceUrls: ['https://www.nomohaus.com/cdn/shop/files/another-bed.jpg'] })).status, 409);
  assert.equal(f.submits, 1);
  const raced = fixture({ immediatelyComplete: true });
  const results = await Promise.all(['First shot.', 'Second shot.'].map(prompt => generate(raced, 'bed', 'raced-prompt-request', { mode: 'draft', prompt })));
  assert.deepEqual(results.map(r => r.status).sort(), [202, 409]);
  assert.equal(raced.submits, 1);
});

test('second model choices are distinct, priced, cap-checked and idempotent', async () => {
  const mini = MODEL_CATALOG[0].id, fast = MODEL_CATALOG[2].id, wan = MODEL_CATALOG[1].id;
  const f = fixture({ immediatelyComplete: true });
  const initial = (await (await generate(f, 'bed', 'custom-first-model', { mode: 'draft', modelIds: [fast] })).json()).comparison;
  for (const modelId of [fast, 'unknown/model', 123]) assert.equal((await second(f, initial.id, 'invalid-second-choice', { modelId })).status, 400);
  const quoted = await second(f, initial.id, 'selected-second-model', { modelId: mini, maxEstimatedCost: 0 });
  assert.equal(quoted.status, 409);
  const quote = await quoted.json();
  assert.equal(quote.quoteChanged, true);
  assert.equal(quote.estimatedCost, 0.3024);
  assert.deepEqual(quote.modelIds, [mini]);
  assert.equal(f.submits, 1);
  const response = await second(f, initial.id, 'selected-second-model', { modelId: mini, maxEstimatedCost: quote.estimatedCost });
  assert.equal(response.status, 202);
  assert.deepEqual((await response.json()).comparison.jobs.map(j => [j.model, j.resolution]), [[fast, '480p'], [mini, '720p']]);
  assert.equal((await second(f, initial.id, 'selected-second-model', { modelId: mini })).status, 200);
  assert.equal((await second(f, initial.id, 'selected-second-model', { modelId: wan })).status, 409);
  assert.equal((await generate(f, 'bed', 'selected-second-model', { mode: 'draft', modelIds: [fast] })).status, 409);
  assert.equal(f.submits, 2);
});

test('notes require authentication and a completed video without exposing private text publicly', async () => {
  const f = fixture({ immediatelyComplete: true });
  const comparison = (await (await generate(f)).json()).comparison;
  for (const method of ['GET', 'POST']) {
    assert.equal((await call(f, '/videos/video-1/notes', { method, owner: false, ...(method === 'POST' ? { body: { note: 'private', revision: 0 } } : {}) })).status, 401);
  }
  assert.equal((await call(f, '/videos/nonexistent/notes')).status, 404);
  assert.deepEqual(await (await call(f, '/videos/video-1/notes')).json(), { note: '', revision: 0, updatedAt: null });
  const saved = await call(f, '/videos/video-1/notes', { method: 'POST', body: { note: 'Private review: keep the paws visible.', revision: 0 } });
  assert.equal(saved.status, 200);
  const note = await saved.json();
  assert.equal(note.note, 'Private review: keep the paws visible.');
  assert.equal(note.revision, 1);
  assert.ok(note.updatedAt > 0);
  const publicConfig = await (await call(f, '/config', { owner: false })).json();
  const publicComparison = await (await call(f, `/comparisons/${comparison.id}`, { owner: false })).json();
  assert.ok(!JSON.stringify(publicConfig).includes('Private review'));
  assert.ok(!JSON.stringify(publicComparison).includes('Private review'));
  assert.ok(publicComparison.comparison.jobs.every(job => !Object.hasOwn(job, 'note')));
  const pending = fixture(); await generate(pending);
  assert.equal((await call(pending, '/videos/video-1/notes')).status, 404);
  assert.equal(f.submits, 2);
});

test('notes persist across new browser requests and optimistic conflicts preserve the saved revision', async () => {
  const f = fixture({ immediatelyComplete: true }); await generate(f);
  const path = '/videos/video-1/notes';
  const browserOne = await (await call(f, path)).json();
  const browserTwo = await (await call(f, path)).json();
  const saved = await (await call(f, path, { method: 'POST', body: { note: 'First browser text', revision: browserOne.revision } })).json();
  const conflict = await call(f, path, { method: 'POST', body: { note: 'Stale second browser', revision: browserTwo.revision } });
  assert.equal(conflict.status, 409);
  assert.deepEqual((await conflict.json()).current, saved);
  assert.deepEqual(await (await call(f, path)).json(), saved);
  const resolved = await (await call(f, path, { method: 'POST', body: { note: 'Explicitly resolved text', revision: saved.revision } })).json();
  assert.equal(resolved.revision, 2);
  assert.equal(resolved.note, 'Explicitly resolved text');
  assert.deepEqual(await (await call(f, path)).json(), resolved);
  const cleared = await (await call(f, path, { method: 'POST', body: { note: '', revision: 2 } })).json();
  assert.equal(cleared.revision, 3);
  assert.equal(cleared.note, '');
  assert.equal(f.submits, 2);
});

test('simultaneous first-note creation or edits cannot overwrite another browser', async () => {
  const f = fixture({ immediatelyComplete: true }); await generate(f);
  const path = '/videos/video-1/notes';
  for (const revision of [0, 1]) {
    const responses = await Promise.all(['A', 'B'].map(note => call(f, path, { method: 'POST', body: { note: `revision ${revision} ${note}`, revision } })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const saved = await (await call(f, path)).json();
    assert.equal(saved.revision, revision + 1);
    assert.ok([`revision ${revision} A`, `revision ${revision} B`].includes(saved.note));
    const conflict = await responses.find(r => r.status === 409).json();
    assert.deepEqual(conflict.current, saved);
  }
});

test('notes validate text and revisions, allow exactly 2000 characters, and remain scoped to one video', async () => {
  const f = fixture({ immediatelyComplete: true }); await generate(f);
  for (const body of [{ note: 'x'.repeat(2001), revision: 0 }, { note: null, revision: 0 }, { note: 'x' }, { note: 'x', revision: -1 }, { note: 'x', revision: 0.5 }, { note: 'x', revision: '0' }]) {
    assert.equal((await call(f, '/videos/video-1/notes', { method: 'POST', body })).status, 400);
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM takehome_video_notes').get().n, 0);
  assert.equal((await call(f, '/videos/video-1/notes', { method: 'POST', body: { note: 'x'.repeat(2000), revision: 0 } })).status, 200);
  assert.deepEqual(await (await call(f, '/videos/video-2/notes')).json(), { note: '', revision: 0, updatedAt: null });
  const internal = f.db.sqlite.prepare("SELECT id FROM takehome_jobs WHERE upstream_job_id='video-1'").get().id;
  assert.equal(f.db.sqlite.prepare('SELECT job_id FROM takehome_video_notes').get().job_id, internal);
  assert.equal((await call(f, '/videos/video-2/notes', { method: 'POST', body: { note: 'invented revision', revision: 9 } })).status, 409);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM takehome_video_notes').get().n, 1);
});

test('notes migration is repeatable and preserves saved generations, selections and budgets', async () => {
  const f = fixture({ immediatelyComplete: true });
  const comparison = (await (await generate(f)).json()).comparison;
  await call(f, `/comparisons/${comparison.id}/select`, { method: 'POST', body: { jobId: 'video-1' } });
  f.db.sqlite.exec('DROP TABLE takehome_video_notes');
  const before = JSON.stringify({ jobs: f.db.sqlite.prepare('SELECT * FROM takehome_jobs ORDER BY slot').all(), budget: f.db.sqlite.prepare('SELECT * FROM takehome_budget').get(), comparison: f.db.sqlite.prepare('SELECT * FROM takehome_comparisons').get() });
  const sql = readFileSync(new URL('./notes-migration.sql', import.meta.url), 'utf8');
  f.db.sqlite.exec(sql); f.db.sqlite.exec(sql);
  assert.equal(JSON.stringify({ jobs: f.db.sqlite.prepare('SELECT * FROM takehome_jobs ORDER BY slot').all(), budget: f.db.sqlite.prepare('SELECT * FROM takehome_budget').get(), comparison: f.db.sqlite.prepare('SELECT * FROM takehome_comparisons').get() }), before);
  assert.equal((await call(f, '/videos/video-1/notes', { method: 'POST', body: { note: 'After migration', revision: 0 } })).status, 200);
});
