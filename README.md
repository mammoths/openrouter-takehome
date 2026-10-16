# The Daily Meili — OpenRouter take-home

A reference-to-video studio for turning a product brief and photos of Meili into a short clip, comparing attempts, and deciding whether another take is worth the cost.

**[Open the live demo](https://thedailymeili.com/openrouter_takehome/)** · [Implementation notes](OPENROUTER-TAKEHOME.md)

Reviewer login details are supplied separately. Saved takes can be reviewed in the demo; submitting a new generation is a paid action and requires an explicit button press.

## The workflow

1. Choose a product brief and review its prompt and reference images.
2. Start with one four-second, 480p draft using Seedance 2.0 Mini, or choose a compatible alternative.
3. Review the output, reported cost, and saved notes. Request another model only when useful.
4. Use Compare mode for a deliberate, two-model 720p comparison and save a favorite.

The surrounding pixel-art office tells the story of the creative workflow. Its sourcing, writing, and mail-room characters are simulated animations. The production studio makes real OpenRouter requests. The product briefs are illustrative examples, not partnerships.

## What's in the repository

| Path | Purpose |
| --- | --- |
| `dist/openrouter_takehome/` | Frontend source: HTML, CSS, JavaScript, Canvas scenes, and assets. No frontend build step. |
| `openrouter-takehome-server/worker.mjs` | Cloudflare Worker entry point and scheduled maintenance. |
| `openrouter-takehome-server/takehome-api.mjs` | OpenRouter integration, authentication, model compatibility, cost estimates, job persistence, and notes. |
| `openrouter-takehome-server/video-storage.mjs` | R2 archival and video playback with range requests. |
| `openrouter-takehome-server/schema.sql` | Complete schema for a fresh D1 database. Other SQL files migrate older schemas. |
| `openrouter-takehome-server/*.test.mjs` | Backend tests using in-memory SQLite and mocked upstream services. |
| `OPENROUTER-TAKEHOME.md` | Design decisions, observed results, limitations, and validation notes. |

This is a standalone export of the take-home. It excludes the rest of The Daily Meili site, production database contents, generated video archives, credentials, and the original site's Git history.

## Run the tests

Use **Node.js 24 or newer**. There are no package dependencies to install.

```sh
npm test
```

The tests use mocked provider responses and do not spend OpenRouter credits. They cover authentication, encryption, concurrent submissions, budget reservations, rejected and uncertain requests, model selection, quote changes, note conflicts, and video archival/playback.

## Preview the frontend

From the repository root, with Python 3 installed:

```sh
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080/openrouter_takehome/`. This previews the frontend and animations. The studio API needs a separate backend; the static server alone cannot log in, load saved takes, or generate video.

## Configure your own backend

The included `wrangler.jsonc` is a deployment template, with the production D1 ID and custom-domain route removed. To run a separate instance:

1. Create your own Cloudflare D1 database and R2 bucket, and replace the template database ID and bucket name. Keep the bindings named `DB` and `VIDEO_ARCHIVE`.
2. Apply `openrouter-takehome-server/schema.sql` to the new database. The migration files are for existing older schemas, not an additional step for a fresh database.
3. Set `DEMO_PASSCODE` and `DEMO_ENCRYPTION_KEY` as Worker secrets. Set `OPENROUTER_API_KEY` as a server secret, or configure a key through the authenticated demo UI. `.env.example` lists the variable names; it contains no values.
4. Configure the frontend's `API_BASE` in `takehome.js` to reach your Worker. For local development, route `/openrouter_takehome/api` from your frontend server to the Worker.
5. Update the explicit frontend-origin allowlist and reference-asset base URL in `takehome-api.mjs` for your deployment. The exported application code retains the live demo URLs.

The Worker expects a five-minute cron trigger to maintain accepted jobs and archive completed videos. It does not submit new generations from the cron. Saved attempts live in D1, and video files live in R2; neither is included here.

## Design choices and limitations

- Start small: the default draft makes one paid request. An alternate take always requires a separate decision.
- Keep the evidence: preserve prompts, references, settings, attempts, costs, notes, and the selected result.
- Treat cost estimates honestly: the app's $20 estimated reservation cap is separate from account credit and actual provider charges.
- Avoid duplicate spending: use atomic admission, idempotent actions, and conservative handling of uncertain submissions.
- Keep keys on the server: configured keys are encrypted with AES-GCM; no live key or demo password is included in this repository.

One saved 480p Mini draft reported about $0.14. A separate 720p comparison reported about $0.31 for Mini and $0.50 for Wan. These are individual observations, not a controlled model-quality benchmark. Human review is still necessary: a model can miss creative requirements, including the requested orientation.

## Assets

The repository includes the demo's sprites, generated artwork, reference photos, and available provenance notes. Product names and images belong to their respective owners. The bundled IBM Plex Mono font retains its [SIL Open Font License](dist/openrouter_takehome/assets/fonts/OFL.txt).
