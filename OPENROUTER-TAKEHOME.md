# The Daily Meili — OpenRouter take-home

Demo: https://thedailymeili.com/openrouter_takehome

Michelle's own experiments involved generating and inspecting Meili content one model at a time. This small developer prototype puts a repeatable reference-based comparison inside one interface: one product, one Meili reference, one prompt, two video models, and a human selection. It investigates the effort and cost of reaching a usable shot; it does not claim measured cost savings or a universal best workflow.

## What the demo does

The four rooms reuse The Daily Meili's existing Canvas projection and character sprites. Pip, Owl, Meili, the mail chute, and the elevator are simulated, local presentation animations. They do not research brands, send email, approve projects, or read private app data. The three brand briefs are fictional examples, not partnerships.

The production lab makes real OpenRouter API requests only after the owner supplies a normal generation key and presses a red generation button. Each brief uses its supplied product image and its matching Meili wardrobe/pose image:

- Pink pennyboard + Meili in her pink dress.
- Cream pet stairs + Meili in her red sailor jacket.
- NomoHaus Leo Bed + sleeping Meili in her cream robe.

The studio offers two modes. Cheap draft starts with one four-second clip at 480p, with Seedance Mini recommended and Fast available when compatible. After it finishes, the user can explicitly request a second model using the same saved prompt and references; that alternate recommends Wan at 720p and lets the user choose another compatible model distinct from the first. Nothing automatically buys an alternate. Compare recommends Mini and Wan, and lets the user select two different compatible 720p models before submitting them together. Both modes display generation status, estimated prices, reported actual costs, and a saved human preference; two completed outputs can be reviewed side by side. An optional product-page importer supports official NomoHaus and Penny Shopify product pages; the owner explicitly selects up to two extra photos.

## Technical choices

- The existing public Sites project serves `dist/openrouter_takehome/`. The original homepage is unchanged.
- A new, separate Cloudflare Worker at `studio-api.thedailymeili.com` handles API calls, with its own D1 database. The live office Worker and its database are unchanged.
- The studio reads the live OpenRouter video catalog and checks duration, resolution, aspect ratio and reference-to-video support. Cheap draft uses Seedance 2.0 Mini at 480p; Compare prefers Mini and Wan 2.7 at 720p. Seedance 2.0 Fast is the catalog fallback for the alternate model. Recommended defaults remain in place while the user can choose from the compatible Mini, Wan, and Fast options. This is the studio's model-selection UI, not OpenRouter's text auto-router. Each job saves its actual chosen model and requested settings.
- Catalog base estimates are approximately $0.134505 for a Mini 480p draft, $0.3024 for Mini at 720p and $0.40 for Wan at 720p per four-second clip. Prices are labeled estimates; completed `usage.cost` is the actual reported price. Our observed 720p Pennyboard pair reported $0.30555 for Mini and $0.50 for Wan. This single run is not a model-quality benchmark. Estimate verification is October 15, 2026.
- Model choices and the total base estimate are shown before submission. The server validates model compatibility, distinct comparison models, and the current estimate. If the current estimate exceeds the amount confirmed in the browser, it requires a new review before any video request is submitted. Actual provider charges can exceed base estimates due to inputs and provider rounding.
- Notes beneath each completed video autosave to D1 and reload in other browsers after demo login. Notes are shared among authenticated demo users and excluded from public comparison responses. Revision checks prevent a stale browser from silently replacing a newer note; the user can choose which version to retain.
- The account's API key stays on the server. Owner-entered keys are verified using OpenRouter and encrypted with AES-GCM in D1. The encryption key and owner passcode are Worker secrets. No OpenRouter key is stored in browser storage or source.
- The primary allowance is the app's $20 estimated reservation cap, separate from prepaid OpenRouter account credit and the API key's spending limit. A definite rejection before a video job is accepted releases its local estimate exactly once. Accepted failures and uncertain submissions retain their estimates. This is not an account balance, provider refund, or guaranteed upstream billing limit.
- Comparisons, job IDs, prompts, references, settings, costs, and selected favorites persist in D1. Atomic admission transactions and a unique active-preset index prevent duplicate paid submissions. Each preset is limited to six accepted or uncertain attempts; definite pre-job rejections do not consume that limit. Regeneration requires an explicit extra confirmation after the current attempt is terminal. Adding a draft's alternate is a separate idempotent paid action that reserves only the extra job's estimate.
- The browser polls saved jobs; the server throttles upstream status polls to ten seconds. A network error after submission may leave the job outcome uncertain. Such attempts stay locked for manual reconciliation rather than automatically charging for a retry.
- Completed MP4 outputs are copied to an isolated R2 archive and replayed through the server without browser credentials or a live OpenRouter key. Exact byte ranges and HEAD responses support Safari playback and seeking. A five-minute maintenance task checks already accepted jobs and saves their outputs even after the browser closes; it never submits paid generations. Existing completed outputs are archived on first playback. MP4 archive reads are limited to 24 MiB per clip, with incomplete or invalid payloads rejected. The Saved takes selector restores earlier attempts and chosen favorites across browsers.

## Scope and learnings

This is one production-room comparison, not an automated film editor. The user provides creative direction and decides which output is usable. Four-second reference-to-video clips keep the experiment bounded. Cheap draft allows a user to stop after one acceptable clip; Compare retains the two-model experiment. These are workflow choices, not proven savings per usable shot. Existing products can perform similar tasks; the point is to demonstrate an integration, its tradeoffs, and an actual personal workflow.

The implementation surfaced differences between reference-to-video and first-frame image-to-video. Separate product and dog photos should be passed as references; they are not a composed opening frame. The API also distinguishes signed video URLs from authenticated content endpoints, and a scoped key budget from the account's balance. These distinctions are reflected in the code rather than hidden by a polished interface.

The first live user attempts returned HTTP 402 before any video job IDs were accepted. The original app incorrectly retained those estimates and discarded the upstream error body. The fix preserves bounded, redacted error details, distinguishes submission rejection from a model failure, releases only the local rejected estimate, and requires a deliberate funding-check acknowledgement before another submission. Actual cost remains unknown until OpenRouter reports it. An owner-only read-only diagnostic checks recorded key usage and reported credit totals without generating content.

The UI distinguishes reported purchased-credit totals from the key's spending ceiling and the local allowance. OpenRouter documents the credits endpoint as purchased-credit totals; coverage of promotional coupon grants is unverified. Zero purchased-credit totals therefore do not veto a request. Known exhausted key limits and the local cap still prevent submission; OpenRouter's actual submission response determines credit eligibility. Replacing a key clears the current payment block, while historical rejection details remain visible. Account checks that are unavailable are labeled unavailable rather than interpreted as zero.

The take-home's Discord initiative can investigate the same developer question: **what does one usable shot actually take?** A weekly shared brief asks builders to contribute their prompt, references, model, failures, attempts, actual cost, and selected result. Reproducible findings become small examples other developers can reuse. This remains a proposal; any claims about current Discord behavior need real observations and links from the server before submission.

## Validation

Run `node --test openrouter-takehome-server/*.test.mjs` using Node 24. The tests exercise actual SQLite admission transactions with mocked upstream responses: authentication, encryption, CORS, reference validation, duplicate/concurrent requests, budget admission, uncertain submissions, partial output, polling, selection, streaming, rejection accounting, diagnostic access, model selection, quote changes, and note persistence/conflicts. They do not spend credits.

Mobile and desktop room layouts, prompt dialogs, references, and reduced-motion controls were visually inspected. Live video generation still requires the owner's API key and a deliberate button press; it was not represented as tested before the key was supplied.

A live Mini 480p Pennyboard draft completed with reported cost $0.142079. It created one job only; no alternate was automatically requested. The optional second-stage action is covered by transaction, concurrency and failure tests with mocked provider responses. The existing completed 720p comparison remains available separately in Compare mode.

## Frame asset

`dist/openrouter_takehome/assets/picture-frame.png` was generated with the built-in image-generation tool. Prompt: one freestanding pale-oak pixel-art picture frame with sage backing, a transparent background and empty transparent portrait opening, crisp edges, subtle three-quarter depth, and no photo, scenery, lettering or reflections. The product and Meili photos are drawn behind the frame opening in the Canvas renderer; the reference photos themselves are unchanged.

## Deployment

Frontend publication follows the existing Sites project's source workflow and public audience. Backend source and schema live in `openrouter-takehome-server/`. Its deployment binds the isolated database as `DB`, the `daily-meili-takehome-videos` R2 bucket as `VIDEO_ARCHIVE`, a five-minute cron trigger, plus `DEMO_PASSCODE` and `DEMO_ENCRYPTION_KEY` secrets. A normal `OPENROUTER_API_KEY` environment secret may override the encrypted owner-entered key. Secret values are deliberately absent from the repository and exports.

## Reviewer access

Use the Log in button and the shared demo password supplied by Michelle. A reviewer uses the saved studio API key and does not need an OpenRouter account or their own key. Login closes automatically when the configured studio is ready. API-key replacement is collapsed under Demo settings. The app estimates and reserves up to $20 in total, while actual upstream billing remains reported separately.

The primary balance display is the remaining estimated $20 demo allowance, not an account-balance claim. OpenRouter may report a larger key spending limit; that limit is distinct from loaded prepaid account credit.
