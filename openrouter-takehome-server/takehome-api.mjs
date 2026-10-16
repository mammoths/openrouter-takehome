/** Isolated OpenRouter take-home API. Requires server/schema.sql on env.DB. */
import { archiveVideo, serveArchivedVideo } from './video-storage.mjs';
const PREFIX = '/openrouter_takehome/api';
const OPENROUTER = 'https://openrouter.ai/api/v1';
const ASSETS = 'https://thedailymeili.com/openrouter_takehome/assets/references/';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);
const REMOTE_STATUSES = new Set(['pending', 'in_progress', ...TERMINAL]);
const encoder = new TextEncoder();
const MAX_BODY = 16 * 1024;
const POLL_MS = 10_000;
const MODEL_IDS = ['bytedance/seedance-2.0-mini', 'alibaba/wan-2.7', 'bytedance/seedance-2.0-fast'];
const REFERENCE_HOSTS = new Set(['www.nomohaus.com', 'nomohaus.com', 'www.pennyskateboards.com', 'pennyskateboards.com', 'cdn.shopify.com']);
const PRODUCT_HOSTS = new Set(['www.nomohaus.com', 'www.pennyskateboards.com']);
export const PRESETS = Object.freeze([
  { id: 'skateboard', name: 'Pennyboard', productImage: `${ASSETS}pennyboard.png`, meiliImage: `${ASSETS}meili-dress.jpg`, prompt: 'Create a four-second vertical video of Meili, the corgi in the dog reference, wearing the same pink dress and gently coasting on the pink pennyboard from the product reference. Preserve Meili’s face, coat markings, short legs, dress, and the board’s pink color and shape. Natural daylight, static low camera, one simple continuous shot. No text or logos added.' },
  { id: 'stairs', name: 'Pet Stairs', productImage: `${ASSETS}pet-stairs.png`, meiliImage: `${ASSETS}meili-sailor.jpg`, prompt: 'Create a four-second vertical video of Meili, the corgi in the dog reference, wearing the same sailor jacket and slowly climbing the cream pet stairs from the product reference toward a human bed. Preserve Meili’s face, coat markings, jacket, and the stairs’ design and proportions. Cozy bedroom, soft daylight, static low camera, one simple continuous shot. No text or logos added.' },
  { id: 'bed', name: 'NomoHaus Leo Bed', productImage: `${ASSETS}nomohaus-bed.png`, meiliImage: `${ASSETS}meili-sleeping.jpg`, prompt: 'Create a four-second vertical video of sleeping Meili, the corgi in the dog reference, wearing the same cream robe and resting on the colorful NomoHaus Leo Bed from the product reference. Meili breathes gently. Preserve her face, coat markings, robe, and the bed’s wooden frame, colors, and patterned cushion. Calm living room, natural daylight, static low camera, one simple continuous shot. No text or logos added.' },
]);

class ApiError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}

function stmt(env, sql, ...values) { return env.DB.prepare(sql).bind(...values); }
async function first(env, sql, ...values) { return stmt(env, sql, ...values).first(); }
async function rows(env, sql, ...values) { return (await stmt(env, sql, ...values).all()).results ?? []; }
const now = () => Date.now();
const upstreamFetch = (env, url, options = {}) => (env.__TAKEHOME_FETCH ?? fetch)(url, options);

function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (origin === 'https://thedailymeili.com') return origin;
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === 'localhost' && ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin) return origin;
  } catch { /* Rejected below. */ }
  throw new ApiError(403, 'Origin is not allowed.');
}

function cors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Demo-Passcode, Range, If-Range');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

function json(value, status = 200) { return Response.json(value, { status }); }

/** Enforce the byte limit during streaming, even without Content-Length. */
async function boundedJson(message, limit = MAX_BODY) {
  const claimed = Number(message.headers.get('Content-Length'));
  if (Number.isFinite(claimed) && claimed > limit) throw new ApiError(413, 'JSON body is too large.');
  if (!message.body) throw new ApiError(400, 'A JSON body is required.');
  const reader = message.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError(413, 'JSON body is too large.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { throw new ApiError(400, 'Invalid JSON.'); }
}

async function owner(request, env) {
  const expected = env.DEMO_PASSCODE;
  const supplied = request.headers.get('X-Demo-Passcode') ?? '';
  if (!expected || typeof expected !== 'string' || supplied.length > 512) return false;
  // WebCrypto HMAC verification performs the secret comparison without JS string equality.
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expected));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(supplied));
}

async function requireOwner(request, env) {
  if (!env.DEMO_PASSCODE) throw new ApiError(503, 'Live generation has not been unlocked by the owner.');
  if (!(await owner(request, env))) throw new ApiError(401, 'Enter the demo passcode to continue.');
}

function toB64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function fromB64(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
async function encryptionKey(env) {
  let raw;
  try { raw = fromB64(env.DEMO_ENCRYPTION_KEY ?? ''); } catch { /* Invalid secret. */ }
  if (!raw || raw.byteLength !== 32) throw new ApiError(503, 'Encrypted key storage is not configured.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encryptApiKey(value, env) {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('thedailymeili-openrouter-takehome-v1') }, key, encoder.encode(value));
  return `v1:${toB64(iv)}:${toB64(cipher)}`;
}
async function apiKey(env) {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  const settings = await first(env, 'SELECT encrypted_key FROM takehome_settings WHERE id = 1');
  if (!settings) return null;
  try {
    const [version, iv, value] = settings.encrypted_key.split(':');
    if (version !== 'v1') throw new Error('Unsupported encryption version');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: encoder.encode('thedailymeili-openrouter-takehome-v1') }, await encryptionKey(env), fromB64(value));
    return new TextDecoder().decode(plaintext);
  } catch { throw new ApiError(503, 'The saved API key cannot be decrypted. Ask the owner to check encrypted storage.'); }
}

async function remoteJson(env, path, key, init = {}) {
  const headers = new Headers(init.headers);
  if (key) headers.set('Authorization', `Bearer ${key}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await upstreamFetch(env, `${OPENROUTER}${path}`, { ...init, headers, signal: AbortSignal.timeout(init.method === 'POST' ? 25_000 : 12_000) });
  if (!response.ok) {
    let payload;
    try { payload = await boundedJson(response, 32 * 1024); } catch {
      // Content-Length can reject before a reader is acquired. Release that body too.
      try { await response.body?.cancel(); } catch { /* It may already be consumed. */ }
    }
    const provider = typeof payload?.error === 'object' && payload.error ? payload.error : {};
    const message = safeProviderText(provider.message ?? (typeof payload?.error === 'string' ? payload.error : ''), env, key, 800);
    const error = new ApiError(response.status, message || `OpenRouter returned HTTP ${response.status}.`);
    error.upstreamStatus = response.status;
    error.providerDetails = {
      limitSource: safeProviderText(provider.metadata?.limit_source, env, key, 160) || null,
      remedyHint: safeProviderText(provider.metadata?.remedy_hint, env, key, 400) || null,
      retryAfter: safeProviderText(response.headers.get('Retry-After'), env, key, 120) || null,
    };
    throw error;
  }
  return boundedJson(response, 512 * 1024);
}

function safeProviderText(value, env, key, maxLength = 800) {
  if (typeof value !== 'string') return '';
  let safe = value;
  for (const secret of [key, env.OPENROUTER_API_KEY, env.DEMO_PASSCODE, env.DEMO_ENCRYPTION_KEY]) {
    if (typeof secret === 'string' && secret.length >= 4) safe = safe.replaceAll(secret, '[redacted]');
  }
  return safe.replace(/sk-or-[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [redacted]').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength).trim();
}

async function paymentBlock(env) {
  const saved = await first(env, "SELECT value FROM takehome_cache WHERE key='payment-block'");
  if (!saved) return null;
  try {
    const value = JSON.parse(saved.value);
    // Earlier app-only preflights inferred account eligibility from purchased totals.
    // Recheck current key limits instead; only an upstream 402 retains the retry gate.
    return value.preflight ? null : value;
  } catch { return { reason: 'payment', errorStatus: 402, message: 'Check OpenRouter funding and API key spending limits before submitting again.', requiresPaymentAcknowledgement: true }; }
}

async function releaseRejectedReservations(env) {
  const batchId = crypto.randomUUID();
  await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO takehome_reservation_releases(job_id,comparison_id,released_microusd,batch_id,created_at)
      SELECT j.id,j.comparison_id,j.estimated_microusd,?,? FROM takehome_jobs j
      JOIN takehome_reservations r ON r.comparison_id=j.comparison_id
      WHERE j.submission_status='rejected' AND j.upstream_job_id IS NULL AND j.actual_cost IS NULL`, batchId, now()),
    stmt(env, `UPDATE takehome_budget SET reserved_microusd=MAX(0,reserved_microusd-
      COALESCE((SELECT SUM(released_microusd) FROM takehome_reservation_releases WHERE batch_id=?),0)) WHERE id=1`, batchId),
  ]);
}

function estimate(model, resolution = '720p') {
  const skus = model.pricing_skus ?? {};
  const perSecond = Number(skus.duration_seconds);
  const perToken = Number(skus.video_tokens_without_audio ?? skus.video_tokens);
  const cost = Number.isFinite(perSecond) && perSecond > 0
    ? perSecond * 4
    : Number.isFinite(perToken) && perToken > 0
      ? (((resolution === '480p' ? 480 * 854 : 720 * 1280) * 4 * 24) / 1024) * perToken : NaN;
  return Number.isFinite(cost) && cost > 0 ? Math.ceil(cost * 1e6) : null;
}

function compatible(model, resolution = '720p') {
  return model && model.supported_durations?.includes(4)
    && model.supported_resolutions?.includes(resolution)
    && model.supported_aspect_ratios?.includes('9:16')
    && /reference-to-video|reference-guided|multimodal reference/i.test(model.description ?? '')
    && estimate(model, resolution) !== null;
}

async function modelCatalog(env) {
  let catalog;
  const cached = await first(env, "SELECT value, updated_at FROM takehome_cache WHERE key = 'models'");
  if (cached && now() - cached.updated_at < 3_600_000) {
    try { catalog = JSON.parse(cached.value); } catch { /* Refetch a corrupt cache. */ }
  }
  if (!catalog) {
    try {
      const result = await remoteJson(env, '/videos/models', null);
      if (!Array.isArray(result.data)) throw new Error('Invalid model catalog');
      catalog = result.data.filter((model) => MODEL_IDS.includes(model.id));
      await stmt(env, "INSERT INTO takehome_cache(key,value,updated_at) VALUES('models',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", JSON.stringify(catalog), now()).run();
    } catch { return []; }
  }
  return catalog;
}

function modelProfile(model, resolution = '720p') {
  if (!compatible(model, resolution)) return null;
  return {
    id: model.id, name: model.name ?? model.id,
    duration: 4, resolution, aspectRatio: '9:16', audio: false,
    estimatedCost: estimate(model, resolution) / 1e6, estimated: true,
    pricingLabel: 'Base estimate for a 4-second clip; inputs and provider rounding may increase actual cost.',
  };
}

async function modelPlans(env) {
  const catalog = await modelCatalog(env);
  const get = (id) => catalog.find((item) => item.id === id);
  const draft = MODEL_IDS.map((id) => modelProfile(get(id), '480p')).filter(Boolean);
  const compare = MODEL_IDS.map((id) => modelProfile(get(id))).filter(Boolean);
  const second = [MODEL_IDS[1], MODEL_IDS[2], MODEL_IDS[0]].map((id) => modelProfile(get(id))).filter(Boolean);
  return {
    compare: compare.slice(0, 2),
    draft: draft[0] ?? null,
    second: second[0] ?? null,
    options: { draft, compare, second },
  };
}
async function models(env) { return (await modelPlans(env)).compare; }

function requestedModels(value, count) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length !== count || value.some((id) => typeof id !== 'string' || !id || id.length > 200) || new Set(value).size !== count) {
    throw new ApiError(400, `Choose ${count === 1 ? 'one model' : 'two different models'} for this generation.`);
  }
  return value;
}

function validateCostCap(value) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new ApiError(400, 'maxEstimatedCost must be a non-negative number.');
  }
}

function confirmQuote(maxEstimatedCost, estimatedMicrousd, profiles) {
  if (maxEstimatedCost !== undefined && estimatedMicrousd > Math.floor(maxEstimatedCost * 1e6 + 1e-7)) {
    throw new ApiError(409, 'The current estimate exceeds the confirmed amount. Review the updated quote before generating.', {
      quoteChanged: true, estimatedCost: estimatedMicrousd / 1e6, modelIds: profiles.map((profile) => profile.id),
    });
  }
}

async function generationDuplicate(env, entry, presetId, mode, requestId, modelIds, prompt, referenceUrls) {
  if (entry.request_id !== requestId || entry.preset_id !== presetId || entry.mode !== mode) {
    throw new ApiError(409, 'requestId already belongs to another brief, generation mode, or second-model request.', { comparisonId: entry.id });
  }
  if (entry.prompt !== prompt || entry.references_json !== JSON.stringify(referenceUrls)) {
    throw new ApiError(409, 'requestId already belongs to a different prompt or reference selection.', { comparisonId: entry.id });
  }
  if (modelIds) {
    const saved = await rows(env, 'SELECT model FROM takehome_jobs WHERE comparison_id=? AND slot<? ORDER BY slot', entry.id, mode === 'draft' ? 1 : 2);
    if (saved.length !== modelIds.length || saved.some((job, index) => job.model !== modelIds[index])) {
      throw new ApiError(409, 'requestId already belongs to a different model selection.', { comparisonId: entry.id });
    }
  }
  return json({ comparison: await comparison(env, entry.id), deduplicated: true });
}

async function secondDuplicate(env, id, modelId) {
  if (modelId !== undefined) {
    const saved = await first(env, 'SELECT model FROM takehome_jobs WHERE comparison_id=? AND slot=1', id);
    if (saved?.model !== modelId) throw new ApiError(409, 'requestId already belongs to a different second model.', { comparisonId: id });
  }
  return json({ comparison: await comparison(env, id), deduplicated: true });
}

async function balance(env, key) {
  if (!key) return null;
  const [keyResult, creditsResult] = await Promise.allSettled([
    remoteJson(env, '/key', key), remoteJson(env, '/credits', key),
  ]);
  const keyData = keyResult.status === 'fulfilled' ? keyResult.value.data : null;
  const keyLimits = [keyData?.effective_budget?.remaining_usd, keyData?.limit_remaining].filter((value) => typeof value === 'number' && Number.isFinite(value));
  const keyBudget = {
    kind: 'key_budget', label: 'API key budget remaining',
    remaining: keyLimits.length ? Math.max(0, Math.min(...keyLimits)) : null,
    available: keyLimits.length > 0,
    note: keyLimits.length ? 'Scoped API key budget; this is not the account balance.' : 'Balance unavailable with this key.',
  };
  const credits = creditsResult.status === 'fulfilled' ? creditsResult.value.data : null;
  if (typeof credits?.total_credits === 'number' && Number.isFinite(credits.total_credits)
    && typeof credits?.total_usage === 'number' && Number.isFinite(credits.total_usage)) {
    return { kind: 'purchased_credits', label: 'Reported purchased credits', available: true,
      remaining: Math.max(0, credits.total_credits - credits.total_usage), keyBudget,
      totalCredits: credits.total_credits, totalUsage: credits.total_usage,
      usage: typeof keyData?.usage === 'number' && Number.isFinite(keyData.usage) ? keyData.usage : null,
      note: 'Reported purchased-credit totals. Promotional-credit coverage is unverified; these totals do not determine generation eligibility. Key and app limits are separate.' };
  }
  return keyBudget;
}

async function comparison(env, id) {
  const entry = await first(env, 'SELECT * FROM takehome_comparisons WHERE id = ?', id);
  if (!entry) return null;
  const jobs = await rows(env, 'SELECT * FROM takehome_jobs WHERE comparison_id = ? ORDER BY slot', id);
  const releases = await rows(env, 'SELECT job_id,released_microusd FROM takehome_reservation_releases WHERE comparison_id=?', id);
  const releasedById = new Map(releases.map((release) => [release.job_id, release.released_microusd]));
  const chosen = jobs.find((job) => job.id === entry.selected_job_id);
  const eligibleDraft = entry.mode === 'draft' && !entry.second_request_id && !entry.active && jobs.length === 1
    ? await first(env, `SELECT c.id FROM takehome_comparisons c WHERE c.id=?
      AND NOT EXISTS(SELECT 1 FROM takehome_comparisons WHERE preset_id=c.preset_id AND active=1)
      AND (SELECT id FROM takehome_comparisons WHERE preset_id=c.preset_id AND mode='draft' ORDER BY created_at DESC,rowid DESC LIMIT 1)=c.id`, id)
    : null;
  return {
    id: entry.id, presetId: entry.preset_id, prompt: entry.prompt, status: entry.status,
    mode: entry.mode ?? 'compare',
    secondModelRequested: !!entry.second_request_id,
    canRequestSecondModel: !!eligibleDraft && jobs.every((job) => TERMINAL.has(job.status) && job.submission_status !== 'unknown'),
    referenceUrls: JSON.parse(entry.references_json ?? '[]'),
    active: !!entry.active, createdAt: entry.created_at, updatedAt: entry.updated_at,
    estimatedCost: entry.estimated_microusd / 1e6,
    releasedEstimate: releases.reduce((sum, release) => sum + release.released_microusd, 0) / 1e6,
    reservedEstimate: (entry.estimated_microusd - releases.reduce((sum, release) => sum + release.released_microusd, 0)) / 1e6,
    actualCost: jobs.every((job) => typeof job.actual_cost === 'number') ? jobs.reduce((sum, job) => sum + job.actual_cost, 0) : null,
    selectedJobId: chosen?.upstream_job_id ?? null,
    jobs: jobs.map((job) => ({
      id: job.upstream_job_id ?? job.id, jobId: job.upstream_job_id, model: job.model, status: job.status,
      resolution: job.resolution ?? '720p', duration: job.duration ?? 4, aspectRatio: job.aspect_ratio ?? '9:16',
      estimatedCost: job.estimated_microusd / 1e6,
      cost: job.actual_cost, actualCost: job.actual_cost, error: job.error,
      submissionStatus: job.submission_status,
      rejected: job.submission_status === 'rejected',
      errorStatus: job.error_status,
      errorMessage: job.error,
      providerError: JSON.parse(job.error_details_json ?? '{}'),
      billingStatus: job.submission_status === 'rejected' ? 'not_submitted' : job.submission_status === 'unknown' ? 'unknown' : typeof job.actual_cost === 'number' ? 'reported' : 'unconfirmed',
      releasedEstimate: (releasedById.get(job.id) ?? 0) / 1e6,
      reservedEstimate: (job.estimated_microusd - (releasedById.get(job.id) ?? 0)) / 1e6,
      videoUrl: job.status === 'completed' && job.upstream_job_id ? `${PREFIX}/videos/${encodeURIComponent(job.upstream_job_id)}/content` : null,
    })),
  };
}

async function finishComparison(env, id) {
  // Aggregate in the UPDATE itself: a stale one-job snapshot must never unlock a
  // comparison after an explicit second job was admitted by another request.
  await stmt(env, `UPDATE takehome_comparisons SET status=CASE
      WHEN NOT EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id) THEN 'active'
      WHEN EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id AND (j.status NOT IN ('completed','failed','cancelled','expired') OR j.submission_status='unknown')) THEN
        CASE WHEN EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id AND (j.status IN ('unknown','submitting','planned') OR j.submission_status='unknown')) THEN 'unknown' ELSE 'active' END
      WHEN NOT EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id AND j.submission_status!='rejected') THEN 'rejected'
      WHEN NOT EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id AND j.status!='completed') THEN 'completed'
      WHEN EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id AND j.status='completed') THEN 'partial'
      ELSE 'failed' END,
      active=CASE WHEN NOT EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id)
        OR EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id AND (j.status NOT IN ('completed','failed','cancelled','expired') OR j.submission_status='unknown')) THEN 1 ELSE 0 END,
      updated_at=? WHERE id=?`, now(), id).run();
}

async function submitJob(env, key, job, referenceUrls, prompt) {
  // The transition is durable BEFORE the chargeable POST. Unknown outcomes are never retried.
  const claimed = await stmt(env, "UPDATE takehome_jobs SET status='submitting',submission_status='unknown',updated_at=? WHERE id=? AND status='planned'", now(), job.id).run();
  if (!claimed.meta?.changes) return;
  try {
    const remote = await remoteJson(env, '/videos', key, {
      method: 'POST',
      body: JSON.stringify({ model: job.model, prompt, duration: job.duration ?? 4, resolution: job.resolution ?? '720p', aspect_ratio: job.aspectRatio ?? '9:16', generate_audio: false,
        input_references: referenceUrls.map((url) => ({ type: 'image_url', image_url: { url } })) }),
    });
    if (!remote.id || typeof remote.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(remote.id)) throw new Error('Missing job ID');
    const status = REMOTE_STATUSES.has(remote.status) ? remote.status : 'pending';
    const cost = typeof remote.usage?.cost === 'number' && Number.isFinite(remote.usage.cost) && remote.usage.cost >= 0 ? remote.usage.cost : null;
    await stmt(env, "UPDATE takehome_jobs SET upstream_job_id=?,status=?,submission_status='accepted',actual_cost=?,updated_at=?,error=NULL,error_status=NULL,error_details_json='{}' WHERE id=?", remote.id, status, cost, now(), job.id).run();
  } catch (error) {
    // A definite client rejection did not create a job; server/network errors may have.
    const rejected = error instanceof ApiError && error.upstreamStatus >= 400 && error.upstreamStatus < 500 && ![408, 499].includes(error.upstreamStatus);
    const status = error.upstreamStatus ?? null;
    const message = rejected
      ? `Submission rejected (HTTP ${status}). ${error.message} No video job was accepted. Check OpenRouter activity to verify billing.`
      : `Submission outcome is unknown${status ? ` (HTTP ${status})` : ''}. It may have been charged; automatic retry is disabled.`;
    await stmt(env, 'UPDATE takehome_jobs SET status=?,submission_status=?,error=?,error_status=?,error_details_json=?,updated_at=? WHERE id=?', rejected ? 'failed' : 'unknown', rejected ? 'rejected' : 'unknown', message, status, JSON.stringify(error.providerDetails ?? {}), now(), job.id).run();
    if (rejected && status === 402) {
      const block = { reason: 'payment', errorStatus: 402, message, providerError: error.providerDetails ?? {}, requiresPaymentAcknowledgement: true };
      await stmt(env, "INSERT INTO takehome_cache(key,value,updated_at) VALUES('payment-block',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", JSON.stringify(block), now()).run();
    }
  }
}

async function generate(request, env) {
  await requireOwner(request, env);
  const body = await boundedJson(request);
  const mode = body.mode ?? 'compare';
  if (!['compare', 'draft'].includes(mode)) throw new ApiError(400, 'Choose draft or compare mode.');
  const modelIds = requestedModels(body.modelIds, mode === 'draft' ? 1 : 2);
  validateCostCap(body.maxEstimatedCost);
  const preset = PRESETS.find((item) => item.id === body?.presetId);
  if (!preset) throw new ApiError(400, 'Choose a valid example brief.');
  const extraReferences = body.referenceUrls ?? [];
  if (!Array.isArray(extraReferences) || extraReferences.length > 2) throw new ApiError(400, 'Choose at most two extra product references.');
  const referenceUrls = [preset.productImage, preset.meiliImage, ...extraReferences.map(referenceUrl)];
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : preset.prompt;
  if (!prompt || prompt.length > 4000) throw new ApiError(400, 'Prompt must contain 1–4000 characters.');
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)) throw new ApiError(400, 'A unique requestId is required.');
  const duplicate = await first(env, 'SELECT id,preset_id,mode,request_id,prompt,references_json FROM takehome_comparisons WHERE request_id=? OR second_request_id=?', body.requestId, body.requestId);
  if (duplicate) return generationDuplicate(env, duplicate, preset.id, mode, body.requestId, modelIds, prompt, referenceUrls);
  const blocked = await paymentBlock(env);
  if (blocked && body.paymentAcknowledged !== true) throw new ApiError(402, 'The previous request was rejected for funding or key limits. Check them before explicitly confirming a new paid submission.', { generationBlocked: blocked });
  const activeRun = await first(env, 'SELECT id FROM takehome_comparisons WHERE preset_id=? AND active=1', preset.id);
  if (activeRun) throw new ApiError(409, 'This brief already has a generation in progress.', { comparisonId: activeRun.id });
  const previous = await first(env, 'SELECT id FROM takehome_comparisons WHERE preset_id=? AND mode=? ORDER BY created_at DESC,rowid DESC LIMIT 1', preset.id, mode);
  if (previous && body.regenerate !== true) throw new ApiError(409, 'Confirm regenerate:true to start another paid comparison.', { comparisonId: previous.id });
  const key = await apiKey(env);
  if (!key) throw new ApiError(503, 'The owner needs to configure OpenRouter first.');
  const plans = await modelPlans(env);
  const chosen = modelIds ? modelIds.map((id) => plans.options[mode].find((profile) => profile.id === id)) : mode === 'draft' ? plans.draft ? [plans.draft] : [] : plans.compare;
  if (chosen.some((profile) => !profile)) throw new ApiError(400, 'A selected model is not compatible or currently available for this generation mode.');
  if (chosen.length !== (mode === 'draft' ? 1 : 2)) throw new ApiError(503, mode === 'draft' ? 'A compatible, priced four-second 480p draft model is not currently available.' : 'Two compatible, priced video models are not currently available.');
  const id = crypto.randomUUID();
  const time = now();
  const jobs = chosen.map((model, slot) => ({ id: crypto.randomUUID(), slot, model: model.id, resolution: model.resolution, duration: model.duration, aspectRatio: model.aspectRatio, estimated: Math.round(model.estimatedCost * 1e6) }));
  const estimateTotal = jobs.reduce((sum, job) => sum + job.estimated, 0);
  confirmQuote(body.maxEstimatedCost, estimateTotal, chosen);
  await fundingPreflight(env, key, estimateTotal);
  // D1 batch is a transaction. Admission, preset lock, jobs and budget reservation commit together.
  await env.DB.batch([
    stmt(env, `INSERT INTO takehome_comparisons(id,request_id,preset_id,prompt,references_json,status,active,estimated_microusd,created_at,updated_at,mode)
      SELECT ?,?,?,?,?,'active',1,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM takehome_comparisons WHERE request_id=? OR second_request_id=?)
      AND NOT EXISTS(SELECT 1 FROM takehome_comparisons WHERE preset_id=? AND active=1)
      AND (SELECT COUNT(*) FROM takehome_comparisons c WHERE preset_id=? AND NOT (c.active=0 AND c.status='rejected')) < 6
      AND (? = 1 OR NOT EXISTS(SELECT 1 FROM takehome_comparisons WHERE preset_id=? AND mode=?))
      AND EXISTS(SELECT 1 FROM takehome_budget WHERE id=1 AND reserved_microusd+? <= cap_microusd)`, id, body.requestId, preset.id, prompt, JSON.stringify(referenceUrls), estimateTotal, time, time, mode, body.requestId, body.requestId, preset.id, preset.id, body.regenerate === true ? 1 : 0, preset.id, mode, estimateTotal),
    stmt(env, 'INSERT INTO takehome_reservations(comparison_id,estimated_microusd,created_at) SELECT id,estimated_microusd,created_at FROM takehome_comparisons WHERE id=?', id),
    stmt(env, 'UPDATE takehome_budget SET reserved_microusd=reserved_microusd+? WHERE id=1 AND EXISTS(SELECT 1 FROM takehome_reservations WHERE comparison_id=?)', estimateTotal, id),
    ...jobs.map((job) => stmt(env, "INSERT INTO takehome_jobs(id,comparison_id,slot,model,status,estimated_microusd,created_at,updated_at,resolution,duration,aspect_ratio) SELECT ?,id,?,?,'planned',?,?,?,?,?,? FROM takehome_comparisons WHERE id=?", job.id, job.slot, job.model, job.estimated, time, time, job.resolution, job.duration, job.aspectRatio, id)),
  ]);
  const accepted = await first(env, 'SELECT id FROM takehome_comparisons WHERE id=?', id);
  if (!accepted) {
    const raced = await first(env, 'SELECT id,preset_id,mode,request_id,prompt,references_json FROM takehome_comparisons WHERE request_id=? OR second_request_id=?', body.requestId, body.requestId);
    if (raced) return generationDuplicate(env, raced, preset.id, mode, body.requestId, modelIds, prompt, referenceUrls);
    const active = await first(env, 'SELECT id FROM takehome_comparisons WHERE preset_id=? AND active=1', preset.id);
    if (active) throw new ApiError(409, 'This brief already has a generation in progress.', { comparisonId: active.id });
    throw new ApiError(409, 'The six-attempt limit or $20 estimated demo budget has been reached.');
  }
  if (body.paymentAcknowledged === true) await stmt(env, "DELETE FROM takehome_cache WHERE key='payment-block'").run();
  await Promise.all(jobs.map((job) => submitJob(env, key, job, referenceUrls, prompt)));
  await finishComparison(env, id);
  await releaseRejectedReservations(env);
  return json({ comparison: await comparison(env, id), deduplicated: false }, 202);
}

async function fundingPreflight(env, key, estimateTotal) {
  const funding = await balance(env, key);
  const keyBudget = funding?.kind === 'purchased_credits' ? funding.keyBudget : funding;
  const keyInsufficient = keyBudget?.available && Math.floor(keyBudget.remaining * 1e6) < estimateTotal;
  if (keyInsufficient) {
    const message = `The API key has $${keyBudget.remaining.toFixed(2)} of spending capacity remaining; this generation is estimated at $${(estimateTotal / 1e6).toFixed(2)}. Check the key limit before trying again.`;
    const block = { reason: 'payment', source: 'key_budget', errorStatus: 402, message, requiresPaymentAcknowledgement: false, preflight: true };
    throw new ApiError(402, message, { generationBlocked: block, balance: funding, preflight: true });
  }
  await stmt(env, "DELETE FROM takehome_cache WHERE key='payment-block' AND json_extract(value,'$.preflight')=1").run();
}

async function secondModel(request, env, id) {
  await requireOwner(request, env);
  const body = await boundedJson(request);
  if (body.modelId !== undefined && (typeof body.modelId !== 'string' || !body.modelId || body.modelId.length > 200)) throw new ApiError(400, 'Choose a valid second model.');
  validateCostCap(body.maxEstimatedCost);
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)) throw new ApiError(400, 'A unique requestId is required.');
  const entry = await first(env, 'SELECT * FROM takehome_comparisons WHERE id=?', id);
  if (!entry) throw new ApiError(404, 'Draft not found.');
  if (entry.second_request_id === body.requestId) return secondDuplicate(env, id, body.modelId);
  if (body.confirmed !== true) throw new ApiError(400, 'Confirm the additional paid generation with confirmed:true.');
  if (entry.mode !== 'draft' || entry.second_request_id) throw new ApiError(409, 'This draft already has a second model or was created in compare mode.');
  const latest = await first(env, "SELECT id FROM takehome_comparisons WHERE preset_id=? AND mode='draft' ORDER BY created_at DESC,rowid DESC LIMIT 1", entry.preset_id);
  if (latest?.id !== id) throw new ApiError(409, 'A newer attempt exists for this brief. Open that attempt instead.', { latestComparisonId: latest?.id });
  const originalJobs = await rows(env, 'SELECT * FROM takehome_jobs WHERE comparison_id=?', id);
  if (entry.active || originalJobs.length !== 1 || !TERMINAL.has(originalJobs[0].status) || originalJobs[0].submission_status === 'unknown') throw new ApiError(409, 'Wait for a definite first-draft result before requesting another model.');
  const blocked = await paymentBlock(env);
  if (blocked && body.paymentAcknowledged !== true) throw new ApiError(402, 'Check funding or key limits before explicitly confirming another paid submission.', { generationBlocked: blocked });
  const key = await apiKey(env);
  if (!key) throw new ApiError(503, 'OpenRouter is not configured.');
  const options = (await modelPlans(env)).options.second;
  const profile = body.modelId === undefined ? options.find((item) => item.id !== originalJobs[0].model) : options.find((item) => item.id === body.modelId);
  if (body.modelId !== undefined && (!profile || profile.id === originalJobs[0].model)) throw new ApiError(400, 'Choose an available second model different from the first model.');
  if (!profile) throw new ApiError(503, 'A compatible different second model is not currently available.');
  const job = { id: crypto.randomUUID(), model: profile.id, resolution: profile.resolution, duration: profile.duration, aspectRatio: profile.aspectRatio, estimated: Math.round(profile.estimatedCost * 1e6) };
  confirmQuote(body.maxEstimatedCost, job.estimated, [profile]);
  await fundingPreflight(env, key, job.estimated);
  const time = now();
  // The single new job is the admission token. All subsequent writes require its ID.
  // A concurrent retry sees slot 1 already occupied and cannot reserve or submit again.
  await env.DB.batch([
    stmt(env, `INSERT INTO takehome_jobs(id,comparison_id,slot,model,status,estimated_microusd,created_at,updated_at,resolution,duration,aspect_ratio)
      SELECT ?,c.id,1,?,'planned',?,?,?,?,?,? FROM takehome_comparisons c
      WHERE c.id=? AND c.mode='draft' AND c.active=0 AND c.second_request_id IS NULL
      AND (SELECT COUNT(*) FROM takehome_jobs WHERE comparison_id=c.id)=1
      AND NOT EXISTS(SELECT 1 FROM takehome_jobs WHERE comparison_id=c.id AND (status NOT IN ('completed','failed','cancelled','expired') OR submission_status='unknown'))
      AND NOT EXISTS(SELECT 1 FROM takehome_comparisons WHERE preset_id=c.preset_id AND active=1)
      AND (SELECT id FROM takehome_comparisons WHERE preset_id=c.preset_id AND mode='draft' ORDER BY created_at DESC,rowid DESC LIMIT 1)=c.id
      AND NOT EXISTS(SELECT 1 FROM takehome_comparisons WHERE request_id=? OR second_request_id=?)
      AND (c.status!='rejected' OR (SELECT COUNT(*) FROM takehome_comparisons p WHERE p.preset_id=c.preset_id AND NOT(p.active=0 AND p.status='rejected'))<6)
      AND EXISTS(SELECT 1 FROM takehome_budget WHERE id=1 AND reserved_microusd+?<=cap_microusd)`, job.id, job.model, job.estimated, time, time, job.resolution, job.duration, job.aspectRatio, id, body.requestId, body.requestId, job.estimated),
    stmt(env, "UPDATE takehome_comparisons SET second_request_id=?,active=1,status='active',estimated_microusd=estimated_microusd+?,last_poll_at=0,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM takehome_jobs WHERE id=?)", body.requestId, job.estimated, time, id, job.id),
    stmt(env, 'UPDATE takehome_reservations SET estimated_microusd=estimated_microusd+? WHERE comparison_id=? AND EXISTS(SELECT 1 FROM takehome_jobs WHERE id=?)', job.estimated, id, job.id),
    stmt(env, 'UPDATE takehome_budget SET reserved_microusd=reserved_microusd+? WHERE id=1 AND EXISTS(SELECT 1 FROM takehome_jobs WHERE id=?)', job.estimated, job.id),
  ]);
  const accepted = await first(env, 'SELECT id FROM takehome_jobs WHERE id=?', job.id);
  if (!accepted) {
    const raced = await first(env, 'SELECT second_request_id FROM takehome_comparisons WHERE id=?', id);
    if (raced?.second_request_id === body.requestId) return secondDuplicate(env, id, body.modelId);
    throw new ApiError(409, 'A second model was already requested, another run is active, or the demo limit has been reached.');
  }
  if (body.paymentAcknowledged === true) await stmt(env, "DELETE FROM takehome_cache WHERE key='payment-block'").run();
  await submitJob(env, key, job, JSON.parse(entry.references_json), entry.prompt);
  await finishComparison(env, id);
  await releaseRejectedReservations(env);
  return json({ comparison: await comparison(env, id), deduplicated: false }, 202);
}

async function poll(env, id) {
  const claim = await stmt(env, 'UPDATE takehome_comparisons SET last_poll_at=? WHERE id=? AND active=1 AND last_poll_at <= ?', now(), id, now() - POLL_MS).run();
  if (!claim.meta?.changes) return;
  const key = await apiKey(env);
  if (!key) return;
  const jobs = await rows(env, 'SELECT * FROM takehome_jobs WHERE comparison_id=?', id);
  await Promise.all(jobs.map(async (job) => {
    if (['planned', 'submitting'].includes(job.status) && !job.upstream_job_id && now() - job.updated_at > 60_000) {
      await stmt(env, "UPDATE takehome_jobs SET status='unknown',submission_status='unknown',error=?,updated_at=? WHERE id=? AND status IN ('planned','submitting')", 'Submission was interrupted. It may have been charged; automatic retry is disabled.', now(), job.id).run();
      return;
    }
    if (!job.upstream_job_id || TERMINAL.has(job.status)) return;
    try {
      const remote = await remoteJson(env, `/videos/${encodeURIComponent(job.upstream_job_id)}`, key);
      if (!REMOTE_STATUSES.has(remote.status)) return;
      const cost = typeof remote.usage?.cost === 'number' && Number.isFinite(remote.usage.cost) && remote.usage.cost >= 0 ? remote.usage.cost : null;
      const detail = safeProviderText(typeof remote.error === 'string' ? remote.error : remote.error?.message, env, key, 800);
      const error = ['failed', 'cancelled', 'expired'].includes(remote.status) ? `Accepted video job ${remote.status}.${detail ? ` ${detail}` : ''} No automatic paid retry.` : null;
      await stmt(env, "UPDATE takehome_jobs SET status=?,submission_status='accepted',actual_cost=COALESCE(?,actual_cost),error=?,updated_at=? WHERE id=?", remote.status, cost, error, now(), job.id).run();
    } catch { /* Keep the saved upstream ID and status; the next GET may poll again. */ }
  }));
  await finishComparison(env, id);
}

async function config(request, env) {
  const isOwner = await owner(request, env);
  if (isOwner) await releaseRejectedReservations(env);
  const key = await apiKey(env);
  const [plans, entries] = await Promise.all([
    modelPlans(env),
    rows(env, `SELECT id FROM takehome_comparisons ${isOwner ? '' : 'WHERE active=0'} ORDER BY created_at DESC LIMIT 24`),
  ]);
  return json({
    configured: !!key,
    generationEnabled: !!key && !!env.DEMO_PASSCODE && plans.compare.length === 2,
    draftEnabled: !!key && !!env.DEMO_PASSCODE && !!plans.draft,
    draftModel: plans.draft,
    secondModel: plans.second,
    modelOptions: plans.options,
    needsUnlock: !isOwner,
    unlocked: isOwner,
    generationBlocked: isOwner ? await paymentBlock(env) : null,
    models: plans.compare,
    presets: PRESETS,
    balance: isOwner ? await balance(env, key) : null,
    comparisons: await Promise.all(entries.map((entry) => comparison(env, entry.id))),
    ...(isOwner ? { demoBudget: { label: 'App spending cap', ...await first(env, 'SELECT cap_microusd/1000000.0 AS cap, reserved_microusd/1000000.0 AS reserved, (cap_microusd-reserved_microusd)/1000000.0 AS remaining FROM takehome_budget WHERE id=1') } } : {}),
  });
}

async function settings(request, env) {
  await requireOwner(request, env);
  const body = await boundedJson(request);
  if (env.OPENROUTER_API_KEY) throw new ApiError(409, 'OpenRouter is already configured in the server environment.');
  if (typeof body?.apiKey !== 'string' || body.apiKey.length < 20 || body.apiKey.length > 512 || /\s/.test(body.apiKey)) throw new ApiError(400, 'Enter a valid OpenRouter API key.');
  await encryptionKey(env);
  try {
    const verified = await remoteJson(env, '/key', body.apiKey);
    if (!verified.data || verified.data.is_management_key) throw new Error('Use a generation key');
  } catch { throw new ApiError(400, 'The key could not be verified. Use a normal OpenRouter generation key.'); }
  const encrypted = await encryptApiKey(body.apiKey, env);
  await stmt(env, 'INSERT INTO takehome_settings(id,encrypted_key,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at', encrypted, now()).run();
  await stmt(env, "DELETE FROM takehome_cache WHERE key='payment-block'").run();
  return json({ configured: true, message: 'OpenRouter key verified and stored encrypted.' });
}

async function diagnostics(request, env) {
  await requireOwner(request, env);
  const key = await apiKey(env);
  if (!key) return json({ configured: false, key: null, accountCredits: { available: false, remaining: null, note: 'OpenRouter is not configured.' } });
  const safeNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  let keyInfo;
  try {
    const { data } = await remoteJson(env, '/key', key);
    keyInfo = {
      available: true, limit: safeNumber(data?.limit), limitRemaining: safeNumber(data?.limit_remaining),
      usage: safeNumber(data?.usage), usageDaily: safeNumber(data?.usage_daily), usageWeekly: safeNumber(data?.usage_weekly), usageMonthly: safeNumber(data?.usage_monthly),
      isFreeTier: typeof data?.is_free_tier === 'boolean' ? data.is_free_tier : null,
      isManagementKey: typeof data?.is_management_key === 'boolean' ? data.is_management_key : null,
      effectiveBudget: data?.effective_budget ? { limit: safeNumber(data.effective_budget.limit_usd), remaining: safeNumber(data.effective_budget.remaining_usd), spent: safeNumber(data.effective_budget.spend_usd) } : null,
    };
  } catch (error) { keyInfo = { available: false, errorStatus: error.upstreamStatus ?? null, message: error instanceof ApiError ? error.message : 'API key diagnostics unavailable.' }; }
  let accountCredits;
  try {
    const { data } = await remoteJson(env, '/credits', key);
    const credits = safeNumber(data?.total_credits);
    const used = safeNumber(data?.total_usage);
    const reportedNumericTotals = Object.fromEntries(Object.entries(data ?? {}).filter(([name, value]) => /credit|usage|balance|grant|promo|coupon|bonus/i.test(name) && !/id|token|secret|key/i.test(name) && typeof value === 'number' && Number.isFinite(value)).slice(0, 24));
    accountCredits = { kind: 'purchased_credits', available: credits !== null && used !== null, remaining: credits !== null && used !== null ? credits - used : null,
      totalCredits: credits, totalUsage: used, reportedNumericTotals,
      note: 'Reported purchased-credit totals; promotional-credit coverage is unverified. OpenRouter determines generation eligibility.' };
  } catch (error) { accountCredits = { available: false, remaining: null, errorStatus: error.upstreamStatus ?? null, note: 'Account balance is unavailable with this generation key. No additional key is needed to generate videos.' }; }
  return json({ configured: true, key: keyInfo, accountCredits, generationBlocked: await paymentBlock(env), demoBudget: { label: 'App spending cap', ...await first(env, 'SELECT cap_microusd/1000000.0 AS cap,reserved_microusd/1000000.0 AS reserved,(cap_microusd-reserved_microusd)/1000000.0 AS remaining FROM takehome_budget WHERE id=1') } });
}

function referenceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ApiError(400, 'Invalid reference image URL.'); }
  if (url.protocol !== 'https:' || !REFERENCE_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')
    || !(url.hostname === 'cdn.shopify.com' ? url.pathname.startsWith('/s/files/') : url.pathname.startsWith('/cdn/shop/'))) {
    throw new ApiError(400, 'Extra references must be images from the official product image hosts.');
  }
  url.hash = '';
  return url.href;
}

async function references(request, env) {
  await requireOwner(request, env);
  const body = await boundedJson(request);
  let url;
  try { url = new URL(body?.url); } catch { throw new ApiError(400, 'Enter an official product URL.'); }
  if (url.protocol !== 'https:' || !PRODUCT_HOSTS.has(url.hostname) || url.username || url.password || url.port
    || !/^\/products\/[a-zA-Z0-9][a-zA-Z0-9-]*(?:\.js)?\/?$/.test(url.pathname)) {
    throw new ApiError(400, 'Use a www.nomohaus.com/products/ or www.pennyskateboards.com/products/ URL.');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '').replace(/\.js$/, '')}.js`;
  url.search = '';
  url.hash = '';
  let data;
  try {
    const response = await upstreamFetch(env, url.href, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Product unavailable'); }
    data = await boundedJson(response, 512 * 1024);
  } catch { throw new ApiError(502, 'Could not read this official product page. You can use the preloaded references.'); }
  const images = [];
  for (const item of (Array.isArray(data.images) ? data.images : []).slice(0, 24)) {
    const value = typeof item === 'string' ? item : item?.src;
    if (!value) continue;
    try {
      const image = referenceUrl(new URL(value, url.origin).href);
      if (!images.includes(image)) images.push(image);
    } catch { /* Exclude images outside the official CDN allowlist. */ }
    if (images.length === 8) break;
  }
  return json({ title: String(data.title ?? 'Product references').slice(0, 200), images });
}

// Only retrieves already accepted jobs; never creates or retries a paid generation.
async function fetchVideoContent(env, jobId) {
  const key = await apiKey(env);
  if (!key) throw new ApiError(503, 'Video retrieval is temporarily unavailable.');
  return upstreamFetch(env, `${OPENROUTER}/videos/${encodeURIComponent(jobId)}/content?index=0`, {
    headers: new Headers({ Authorization: `Bearer ${key}` }), signal: AbortSignal.timeout(30_000),
  });
}

async function archiveCompletedVideos(env, comparisonId = null) {
  if (!env.VIDEO_ARCHIVE) return;
  const jobs = await rows(env, "SELECT upstream_job_id FROM takehome_jobs WHERE status='completed' AND upstream_job_id IS NOT NULL" + (comparisonId ? ' AND comparison_id=?' : ''), ...(comparisonId ? [comparisonId] : []));
  // Bound memory: archive one short video at a time.
  for (const job of jobs) {
    try { await archiveVideo(env, job.upstream_job_id, { fetchContent: () => fetchVideoContent(env, job.upstream_job_id) }); }
    catch { console.warn('Video archive deferred; next maintenance run will retry.', { jobId: job.upstream_job_id }); }
  }
}

export async function maintainTakehomeVideos(env) {
  if (!env.DB || !env.VIDEO_ARCHIVE) return;
  const active = await rows(env, 'SELECT id FROM takehome_comparisons WHERE active=1');
  for (const entry of active) await poll(env, entry.id);
  await archiveCompletedVideos(env);
}

async function video(request, env, jobId) {
  const job = await first(env, "SELECT id FROM takehome_jobs WHERE upstream_job_id=? AND status='completed'", jobId);
  if (!job) throw new ApiError(404, 'Completed video not found.');
  if (!env.VIDEO_ARCHIVE) throw new ApiError(503, 'Video storage is temporarily unavailable.');
  // Public demo artifacts play from durable storage, independent of browser login or API key.
  const response = await serveArchivedVideo(request, env, jobId, { fetchContent: () => fetchVideoContent(env, jobId) });
  if (!response) throw new ApiError(410, 'This video is no longer available from the provider and has not been saved.');
  return response;
}

async function videoNotes(request, env, upstreamJobId) {
  await requireOwner(request, env);
  const job = await first(env, "SELECT id FROM takehome_jobs WHERE upstream_job_id=? AND status='completed'", upstreamJobId);
  if (!job) throw new ApiError(404, 'Completed video not found.');
  const read = async () => {
    const saved = await first(env, 'SELECT note,revision,updated_at FROM takehome_video_notes WHERE job_id=?', job.id);
    return saved ? { note: saved.note, revision: saved.revision, updatedAt: saved.updated_at } : { note: '', revision: 0, updatedAt: null };
  };
  if (request.method === 'GET') return json(await read());
  const body = await boundedJson(request);
  if (typeof body?.note !== 'string' || body.note.length > 2000) throw new ApiError(400, 'Video notes must contain at most 2000 characters.');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER) throw new ApiError(400, 'A non-negative note revision is required.');
  const updatedAt = now();
  // Each mutation is one compare-and-set statement. A stale browser cannot
  // overwrite a newer note, including when two browsers create the first note.
  const result = body.revision === 0
    ? await stmt(env, 'INSERT OR IGNORE INTO takehome_video_notes(job_id,note,revision,updated_at) VALUES(?,?,1,?)', job.id, body.note, updatedAt).run()
    : await stmt(env, 'UPDATE takehome_video_notes SET note=?,revision=revision+1,updated_at=? WHERE job_id=? AND revision=?', body.note, updatedAt, job.id, body.revision).run();
  if (!result.meta?.changes) throw new ApiError(409, 'This note changed in another browser. Review the saved version before saving again.', { current: await read() });
  return json({ note: body.note, revision: body.revision + 1, updatedAt });
}

/** Call this before the parent Worker's normal routing. null means another route. */
export async function takehomeRoute(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(`${PREFIX}/`)) return null;
  let origin = null;
  try {
    origin = allowedOrigin(request);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    if (!env.DB) throw new ApiError(503, 'Take-home database is not configured.');
    const route = path.slice(PREFIX.length);
    let result;
    if (route === '/config' && request.method === 'GET') result = await config(request, env);
    else if (route === '/settings' && request.method === 'POST') result = await settings(request, env);
    else if (route === '/generate' && request.method === 'POST') result = await generate(request, env);
    else if (route === '/references' && request.method === 'POST') result = await references(request, env);
    else if (route === '/diagnostics' && request.method === 'GET') result = await diagnostics(request, env);
    else if (route === '/balance' && request.method === 'GET') {
      await requireOwner(request, env);
      result = json({ balance: await balance(env, await apiKey(env)) });
    } else {
      const selection = /^\/comparisons\/([A-Za-z0-9_-]{1,200})\/select$/.exec(route);
      const expand = /^\/comparisons\/([A-Za-z0-9_-]{1,200})\/second-model$/.exec(route);
      const read = /^\/comparisons\/([A-Za-z0-9_-]{1,200})$/.exec(route);
      const content = /^\/videos\/([A-Za-z0-9_-]{1,200})\/content$/.exec(route);
      const notes = /^\/videos\/([A-Za-z0-9_-]{1,200})\/notes$/.exec(route);
      if (expand && request.method === 'POST') result = await secondModel(request, env, expand[1]);
      else if (notes && ['GET', 'POST'].includes(request.method)) result = await videoNotes(request, env, notes[1]);
      else if (selection && request.method === 'POST') {
        await requireOwner(request, env);
        const body = await boundedJson(request);
        const chosen = await first(env, "SELECT id FROM takehome_jobs WHERE comparison_id=? AND upstream_job_id=? AND status='completed'", selection[1], body?.jobId ?? '');
        if (!chosen) throw new ApiError(400, 'Choose a completed video from this comparison.');
        await stmt(env, 'UPDATE takehome_comparisons SET selected_job_id=?,updated_at=? WHERE id=?', chosen.id, now(), selection[1]).run();
        result = json({ comparison: await comparison(env, selection[1]) });
      } else if (read && request.method === 'GET') {
        const entry = await first(env, 'SELECT active FROM takehome_comparisons WHERE id=?', read[1]);
        const isOwner = await owner(request, env);
        if (!entry || (entry.active && !isOwner)) throw new ApiError(404, 'Completed comparison not found.');
        if (isOwner && entry.active) await poll(env, read[1]);
        if (ctx && env.VIDEO_ARCHIVE) ctx.waitUntil(archiveCompletedVideos(env, read[1]));
        result = json({ comparison: await comparison(env, read[1]) });
      } else if (content && ['GET', 'HEAD'].includes(request.method)) result = await video(request, env, content[1]);
      else throw new ApiError(404, 'Take-home API route not found.');
    }
    return cors(result, origin);
  } catch (error) {
    const safe = error instanceof ApiError;
    return cors(json({ error: safe ? error.message : 'Take-home service is temporarily unavailable.', ...(safe ? error.details : {}) }, safe ? error.status : 503), origin);
  }
}

export const __testing = { boundedJson, estimate, compatible, owner, encryptApiKey, apiKey, models, referenceUrl, safeProviderText, releaseRejectedReservations, finishComparison, submitJob };
