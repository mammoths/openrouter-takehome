import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveVideo, serveArchivedVideo, MAX_VIDEO_BYTES } from './video-storage.mjs';

const JOB = 'video-completed-1';
const KEY = `videos/${JOB}.mp4`;
const UPLOADED = new Date('2026-10-16T12:00:00.123Z');

function mp4(payloadSize = 64) {
  const result = new Uint8Array(40 + payloadSize);
  const view = new DataView(result.buffer);
  const text = (at, value) => result.set(new TextEncoder().encode(value), at);
  view.setUint32(0, 24); text(4, 'ftyp'); text(8, 'isom'); text(16, 'isomiso2');
  view.setUint32(24, 8); text(28, 'moov');
  view.setUint32(32, 8 + payloadSize); text(36, 'mdat');
  for (let i = 40; i < result.length; i++) result[i] = i % 251;
  return result;
}

class R2Mock {
  records = new Map();
  heads = [];
  gets = [];
  puts = [];
  failPuts = 0;
  seed(bytes, key = KEY) {
    const metadata = { key, size: bytes.length, etag: 'stored-etag', httpEtag: '"stored-etag"', uploaded: UPLOADED, httpMetadata: { contentType: 'video/mp4' } };
    this.records.set(key, { bytes: bytes.slice(), metadata });
    return metadata;
  }
  async head(key) { this.heads.push(key); return this.records.get(key)?.metadata ?? null; }
  async put(key, bytes, options) {
    this.puts.push({ key, size: bytes.byteLength, options });
    if (this.failPuts > 0) { this.failPuts--; throw new Error('Temporary R2 failure'); }
    if (options?.onlyIf?.get('If-None-Match') === '*' && this.records.has(key)) return null;
    return this.seed(new Uint8Array(bytes), key);
  }
  async get(key, options) {
    this.gets.push({ key, options });
    const record = this.records.get(key);
    if (!record) return null;
    const range = options?.range;
    const body = range ? record.bytes.slice(range.offset, range.offset + range.length) : record.bytes;
    return { ...record.metadata, body: new Blob([body]).stream() };
  }
}

function request(range, { method = 'GET', ifRange } = {}) {
  return new Request(`https://studio.example/videos/${JOB}/content`, {
    method,
    headers: { ...(range === undefined ? {} : { Range: range }), ...(ifRange ? { 'If-Range': ifRange } : {}) },
  });
}

function content(bytes = mp4(), headers = {}) {
  return new Response(bytes, { headers: { 'Content-Type': 'video/mp4', ...headers } });
}

test('archives full content without Content-Length once, before serving a Safari two-byte probe', async () => {
  const bucket = new R2Mock(), bytes = mp4();
  let fetches = 0;
  const response = await serveArchivedVideo(request('bytes=0-1'), { VIDEO_ARCHIVE: bucket }, JOB, {
    fetchContent: async (...args) => { fetches++; assert.deepEqual(args, []); return content(bytes); },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 0-1/${bytes.length}`);
  assert.equal(response.headers.get('Content-Length'), '2');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(0, 2));
  assert.equal(bucket.records.get(KEY).bytes.length, bytes.length);
  assert.equal(bucket.puts[0].options.onlyIf.get('If-None-Match'), '*');
  assert.equal(bucket.puts[0].options.httpMetadata.contentType, 'video/mp4');
  assert.equal(fetches, 1);
  const again = await archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => { throw new Error('Must not fetch an archived job'); } });
  assert.equal(again.size, bytes.length);
  assert.equal(bucket.puts.length, 1);
});

test('archived replay needs neither upstream access nor any API key', async () => {
  const bucket = new R2Mock(), bytes = mp4();
  bucket.seed(bytes);
  const response = await serveArchivedVideo(request(), { VIDEO_ARCHIVE: bucket }, JOB);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.equal(response.headers.get('Content-Length'), String(bytes.length));
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400, immutable');
  assert.equal(response.headers.get('ETag'), '"stored-etag"');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(bucket.puts.length, 0);
});

test('single ranges return exactly the selected bytes, including open, suffix and clamped ends', async () => {
  const bucket = new R2Mock(), bytes = mp4(60); // 100 bytes total.
  bucket.seed(bytes);
  const cases = [
    ['bytes=0-1', 0, 1], ['bytes=0-0', 0, 0], ['bytes=99-99', 99, 99],
    ['bytes=70-', 70, 99], ['bytes=-7', 93, 99], ['bytes=-100', 0, 99],
    ['bytes=-999', 0, 99], ['bytes=80-999', 80, 99], ['bytes=0-', 0, 99],
    ['bytes=90-9999999999999999999999999999', 90, 99],
    ['bytes=-9999999999999999999999999999', 0, 99],
  ];
  for (const [range, start, end] of cases) {
    const response = await serveArchivedVideo(request(range), { VIDEO_ARCHIVE: bucket }, JOB);
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/100`, range);
    assert.equal(response.headers.get('Content-Length'), String(end - start + 1), range);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(start, end + 1), range);
    assert.deepEqual(bucket.gets.at(-1).options.range, { offset: start, length: end - start + 1 });
  }
});

test('invalid and unsatisfiable ranges return 416 without reading an R2 body', async () => {
  const bucket = new R2Mock(); bucket.seed(mp4(60));
  for (const range of ['bytes=100-', 'bytes=100-150', 'bytes=20-10', 'bytes=-0', 'bytes=-', 'bytes=x-1', 'bytes=999999999999999999999999999-']) {
    const response = await serveArchivedVideo(request(range), { VIDEO_ARCHIVE: bucket }, JOB);
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('Content-Range'), 'bytes */100');
    assert.equal(response.headers.get('Content-Length'), '0');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  assert.equal(bucket.gets.length, 0);
});

test('unsupported multipart ranges and unknown range units fall back to the full response', async () => {
  const bucket = new R2Mock(), bytes = mp4(); bucket.seed(bytes);
  for (const range of ['bytes=0-1,4-5', 'items=0-1']) {
    const response = await serveArchivedVideo(request(range), { VIDEO_ARCHIVE: bucket }, JOB);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Range'), null);
    assert.equal(response.headers.get('Content-Length'), String(bytes.length));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
});

test('HEAD returns full metadata without reading content; other methods return 405', async () => {
  const bucket = new R2Mock(), bytes = mp4(); bucket.seed(bytes);
  for (const range of [undefined, 'bytes=0-1']) {
    const response = await serveArchivedVideo(request(range, { method: 'HEAD' }), { VIDEO_ARCHIVE: bucket }, JOB);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Length'), String(bytes.length));
    assert.equal(response.headers.get('Content-Range'), null);
    assert.equal(response.body, null);
  }
  assert.equal(bucket.gets.length, 0);
  const response = await serveArchivedVideo(request(undefined, { method: 'POST' }), { VIDEO_ARCHIVE: bucket }, JOB);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
});

test('If-Range requires a matching strong ETag or exact Last-Modified date', async () => {
  const bucket = new R2Mock(); bucket.seed(mp4());
  for (const [value, status] of [
    ['"stored-etag"', 206], [UPLOADED.toUTCString(), 206], ['"different"', 200],
    ['W/"stored-etag"', 200], ['"2099"', 200], ['Sun, 16 Oct 2033 12:00:00 GMT', 200],
    ['Thu, 15 Oct 2026 12:00:00 GMT', 200],
  ]) {
    const response = await serveArchivedVideo(request('bytes=0-1', { ifRange: value }), { VIDEO_ARCHIVE: bucket }, JOB);
    assert.equal(response.status, status, value);
    assert.equal((await response.arrayBuffer()).byteLength, status === 206 ? 2 : 104);
  }
});

test('404/410 and missing binding return unavailable without persisting', async () => {
  const bucket = new R2Mock();
  for (const status of [404, 410]) {
    assert.equal(await archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => new Response('expired', { status }) }), null);
  }
  assert.equal(await serveArchivedVideo(request(), { VIDEO_ARCHIVE: bucket }, JOB), null);
  assert.equal(await archiveVideo({}, JOB, { fetchContent: () => { throw new Error('No upstream without storage'); } }), null);
  assert.equal(bucket.puts.length, 0);
});

test('never archives partial responses, HTML, JSON errors, invalid containers or truncated bytes', async () => {
  const valid = mp4();
  const factories = [
    () => new Response(valid, { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-103/999' } }),
    () => content(valid, { 'Content-Range': 'bytes 0-103/999' }),
    () => new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => content(new TextEncoder().encode('<html>Gateway error pretending to be an mp4</html>')),
    () => Response.json({ error: 'upstream error' }, { status: 500 }),
    () => content(valid.slice(0, -1)),
    () => content(valid, { 'Content-Length': String(valid.length + 1) }),
    () => content(valid, { 'Content-Length': String(valid.length - 1) }),
    () => content(new Uint8Array()),
    () => content(valid.slice(0, 32)), // No media box.
  ];
  for (const factory of factories) {
    const bucket = new R2Mock();
    await assert.rejects(archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => factory() }));
    assert.equal(bucket.puts.length, 0);
  }
});

test('bounds unknown-length content and cancels at 24 MiB before persisting', async () => {
  const bucket = new R2Mock();
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'video/mp4' } });
  await assert.rejects(archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => response }), { code: 'video_too_large' });
  assert.equal(cancelled, true);
  assert.equal(bucket.puts.length, 0);
  await assert.rejects(archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => content(mp4(), { 'Content-Length': String(MAX_VIDEO_BYTES + 1) }) }), { code: 'video_too_large' });
  assert.equal(bucket.puts.length, 0);
});

test('stream failures leave no archive and a later read can retry successfully', async () => {
  const bucket = new R2Mock();
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(mp4().slice(0, 40)); controller.error(new Error('Connection interrupted')); } }), { headers: { 'Content-Type': 'video/mp4' } });
  await assert.rejects(archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => response }), /Connection interrupted/);
  assert.equal(bucket.puts.length, 0);
  assert.equal((await archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => content() })).size, 104);
});

test('persistence failure can be retried; a successful archive prevents further fetches', async () => {
  const bucket = new R2Mock(); bucket.failPuts = 1;
  let fetches = 0;
  const options = { fetchContent: async () => { fetches++; return content(); } };
  await assert.rejects(archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, options), /Temporary R2 failure/);
  assert.equal(bucket.records.size, 0);
  await archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, options);
  await archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, options);
  assert.equal(fetches, 2);
  assert.equal(bucket.puts.length, 2);
  assert.equal(bucket.records.size, 1);
});

test('concurrent archivers preserve the first completed immutable object', async () => {
  const bucket = new R2Mock();
  const first = mp4(60), second = mp4(80);
  const results = await Promise.all([
    archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => content(first) }),
    archiveVideo({ VIDEO_ARCHIVE: bucket }, JOB, { fetchContent: async () => content(second) }),
  ]);
  assert.equal(results[0].size, 100);
  assert.equal(results[1].size, 100);
  assert.deepEqual(bucket.records.get(KEY).bytes, first);
});
