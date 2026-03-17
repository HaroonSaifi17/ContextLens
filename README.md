# ContextLimit2

Long-document intelligence platform for **live hallucination detection**, **triple-pipeline comparison**, and **reliability analytics**.

Upload a document (or paste text), ask a question, and compare answers in real time across:

- No context (question-only)
- Full context (entire document)
- RAG context (retrieved chunks)

Each run is stored in Convex and shown with sentence-level grounding, context usage tags, and aggregate research metrics.

## Tech stack

- Frontend: SvelteKit + shadcn-svelte + Tailwind
- Runtime: Bun
- Backend/data: Convex
- LLM provider: Groq

## Features

- Document upload with progress states (PDF/TXT/MD)
- Paste-text input for quick testing
- Triple answer engine streamed via SSE
- Sentence-level hallucination highlighting
- Reliability dashboard across all sessions/runs
- Positional bias heatmap (lost-in-the-middle signal)
- Noise injection lab (controlled robustness test)
- Session history with one-click restore
- Exportable reliability reports (PDF + JSON)

## Environment variables

Create `.env.local` with:

```env
PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
PUBLIC_CONVEX_SITE_URL=https://<your-deployment>.convex.site
GROQ_API_KEY=<your_groq_api_key>
```

## Setup

```bash
bun install
bunx convex dev
```

In another terminal:

```bash
bun run dev
```

## Build and checks

```bash
bun run check
bun run build
```

## Project structure

- `src/routes/+page.svelte` main app shell and client orchestration
- `src/lib/components/DocumentPanel.svelte` upload/paste/noise/query controls
- `src/lib/components/ModelResult.svelte` per-run result rendering
- `src/lib/components/AnalyticsPanel.svelte` global metrics and heatmap
- `src/routes/api/analyze/+server.ts` SSE triple-engine execution
- `src/routes/api/upload/+server.ts` ingestion + parsing + session creation
- `src/routes/api/runs/+server.ts` all-runs analytics feed
- `src/routes/api/report/+server.ts` report export endpoint
- `src/routes/api/report/pdf/+server.ts` formatted PDF report export endpoint
- `src/lib/server/analysis.ts` retrieval, context shaping, run logic
- `src/lib/server/groq.ts` Groq model discovery and JSON chat wrapper
- `convex/` schema and Convex functions

## Data model overview

- `sessions`: uploaded document metadata + preview + full text
- `chunks`: tokenized document segments for retrieval
- `runs`: per-question per-pipeline outputs, grounding, citations, metrics

## Notes

- Context is automatically resized per model to reduce token-limit failures.
- Model families are deduplicated to avoid showing multiple variants of the same base family.
- For production, rotate API keys and avoid committing secrets.

## Exporting reports

From the Analytics tab you can export:

- **PDF report**: polished one-page layout with key metrics, summary table, and recent runs
- **JSON report**: raw structured data for further analysis
