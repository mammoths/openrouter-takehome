import { takehomeRoute, maintainTakehomeVideos } from './takehome-api.mjs';

/** Dedicated demo Worker. Uses isolated D1 metadata and an R2 video archive. */
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/openrouter_takehome/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'meili-openrouter-takehome' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return (await takehomeRoute(request, env, ctx)) ?? new Response('Not found', { status: 404 });
  },
  async scheduled(_event, env) {
    await maintainTakehomeVideos(env);
  },
};
