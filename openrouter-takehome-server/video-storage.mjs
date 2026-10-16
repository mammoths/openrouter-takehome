// Completed videos are immutable. No generation or account credentials belong here.
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

export class VideoArchiveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VideoArchiveError';
    this.code = code;
  }
}

function videoKey(jobId) {
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(jobId)) {
    throw new VideoArchiveError('invalid_job_id', 'Invalid video job ID.');
  }
  return `videos/${jobId}.mp4`;
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch { /* Preserve the original failure. */ }
}

async function readVideo(response) {
  const declared = response.headers.get('Content-Length');
  const expected = declared === null ? null : /^\d+$/.test(declared) ? Number(declared) : NaN;
  if (expected !== null && (!Number.isSafeInteger(expected) || expected > MAX_VIDEO_BYTES)) {
    await cancelBody(response);
    throw new VideoArchiveError('video_too_large', 'Video exceeds the 24 MiB archive limit.');
  }
  if (!response.body) throw new VideoArchiveError('invalid_video', 'Video content is empty.');

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VIDEO_BYTES) {
        throw new VideoArchiveError('video_too_large', 'Video exceeds the 24 MiB archive limit.');
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Preserve the read failure. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size || (expected !== null && expected !== size)) {
    throw new VideoArchiveError('incomplete_video', 'Video content is incomplete.');
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  validateMp4(bytes);
  return bytes;
}

// A successful HTTP status alone is insufficient: providers can return HTML or
// a truncated MP4. Check the container header and complete top-level boxes.
function validateMp4(bytes) {
  const invalid = () => { throw new VideoArchiveError('invalid_video', 'Upstream did not return a complete MP4 video.'); };
  if (bytes.length < 24) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0, hasMovie = false, hasMedia = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let size = view.getUint32(offset), header = 8;
    if (size === 1) {
      if (bytes.length - offset < 16 || view.getUint32(offset + 8) !== 0) invalid();
      size = view.getUint32(offset + 12); header = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (size < header || size > bytes.length - offset) invalid();
    if (offset === 0 && (type !== 'ftyp' || size < header + 8)) invalid();
    if (type === 'moov') hasMovie = true;
    if (type === 'mdat' && size > header) hasMedia = true;
    offset += size;
  }
  if (!hasMovie || !hasMedia) invalid();
}

/**
 * Return R2 metadata, or null when storage/content is unavailable. fetchContent
 * must return a full authenticated upstream Response (GET without Range).
 * Validation, transport and persistence failures throw, so later calls can retry.
 */
export async function archiveVideo(env, jobId, { fetchContent } = {}) {
  const bucket = env.VIDEO_ARCHIVE;
  if (!bucket) return null;
  const key = videoKey(jobId);
  const existing = await bucket.head(key);
  if (existing) return existing;
  if (!fetchContent) return null;

  const response = await fetchContent();
  if (response.status === 404 || response.status === 410) {
    await cancelBody(response);
    return null;
  }
  const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (response.status !== 200 || response.headers.has('Content-Range')) {
    await cancelBody(response);
    throw new VideoArchiveError('upstream_video_error', 'Upstream did not return the full video.');
  }
  if (type && !['video/mp4', 'application/mp4', 'application/octet-stream'].includes(type)) {
    await cancelBody(response);
    throw new VideoArchiveError('invalid_video', 'Upstream did not return MP4 content.');
  }
  const bytes = await readVideo(response);
  const stored = await bucket.put(key, bytes, {
    httpMetadata: { contentType: 'video/mp4' },
    onlyIf: new Headers({ 'If-None-Match': '*' }),
  });
  if (stored) return stored;
  // Another request may have archived this immutable job while we fetched it.
  const winner = await bucket.head(key);
  if (winner) return winner;
  throw new VideoArchiveError('archive_write_failed', 'Video could not be archived.');
}

function requestedRange(value, size) {
  value = value.trim();
  // Multipart bodies and unknown range units are deliberately unsupported.
  // HTTP permits ignoring Range and sending the full representation instead.
  if (!/^bytes=/i.test(value) || value.includes(',')) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start >= size || start > end ? null : { start, end };
}

function matchesIfRange(value, object) {
  if (!value) return true;
  if (value === object.httpEtag && !value.startsWith('W/')) return true;
  const uploaded = new Date(object.uploaded);
  return Number.isFinite(uploaded.getTime()) && value === uploaded.toUTCString();
}

/**
 * Serve an archived video, optionally archiving a missing one first. Returns null
 * for unavailable content; throws on archive failures. HEAD never reads R2 body.
 * This helper does not authorize requests; the caller must validate the job.
 */
export async function serveArchivedVideo(request, env, jobId, options = {}) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const object = await archiveVideo(env, jobId, options);
  if (!object) return null;
  const size = object.size;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new VideoArchiveError('invalid_archive', 'Archived video metadata is invalid.');
  }
  const headers = new Headers({ 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400, immutable' });
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (object.uploaded) headers.set('Last-Modified', new Date(object.uploaded).toUTCString());
  let range = null;
  // HTTP Range applies to GET; HEAD reports the complete representation size.
  const requested = request.method === 'GET' ? request.headers.get('Range') : null;
  if (requested && matchesIfRange(request.headers.get('If-Range'), object)) {
    range = requestedRange(requested, size);
    if (range === null) {
      headers.set('Content-Range', `bytes */${size}`);
      headers.set('Content-Length', '0');
      headers.set('Cache-Control', 'no-store');
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      headers.set('Content-Length', String(range.end - range.start + 1));
    }
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  const stored = await env.VIDEO_ARCHIVE.get(videoKey(jobId), range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!stored) return null;
  if (!stored.body) throw new VideoArchiveError('archive_read_failed', 'Archived video could not be read.');
  return new Response(stored.body, { status: range ? 206 : 200, headers });
}
