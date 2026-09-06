# ParseBench Run Observatory

A Next.js benchmark analysis application for selecting GitHub Actions runs,
reviewing aggregate benchmark scores, finding low-scoring documents, and
comparing source PDFs with PyMuPDF4LLM markdown and available reference
markdown.

The full-width workspace includes an interactive run history, dimension leaders,
a searchable workflow catalog, document triage, and a source/evidence workbench.
The compact top navigation keeps the analysis canvas available on desktop and
adapts to a small-screen navigation row. History bars include only complete,
leaderboard-eligible runs covering all dimensions; individual dimension leaders
also include eligible runs dedicated to that dimension.

## Code organization

- `app/dashboard-client.tsx` owns route state, data loading, caches, and the queue dialog.
- `app/dashboard/` contains the catalog, overview, triage, and document views, plus
  shared types, formatting, filters, and sanitized Markdown rendering.
- `app/diagnostics/` separates evidence models from table, chart, layout, text,
  and ground-truth views. See its README for the matching and reconstruction rules.
- `app/lib/data.ts` is the read-only data boundary; `app/api/source-pdf/route.ts`
  proxies validated, ranged requests to the pinned source dataset.
- `app/styles/` groups the theme, navigation, catalog, overview, triage, workbench,
  diagnostics, and responsive rules. `app/globals.css` defines their import order.

The document explorer, PDF renderer, and detailed diagnostic views load on demand.
Triage filters and pagination live in the URL, so reloads, copied links, and browser
Back/Forward preserve the selected investigation.

## Data sources

- Supabase provides the read-only workflow, case, aggregate score,
  per-document headline score, artifact locator, and error index.
- Google Cloud Storage provides independently fetchable per-document result and
  diagnostic JSON. Detailed metrics, outcomes, and the ground-truth rows used by
  each evaluation are read from those diagnostic objects.
- The pinned Hugging Face dataset revision provides source PDFs and images.

When ParseBench deterministically separates an ambiguous, side-by-side output
table before scoring, the dashboard reconstructs those table segments in the
browser from the stored result, ground truth, evaluator configuration, and
pairing metadata. The reconstruction is displayed only when its table counts
and pairing indexes agree with the retained diagnostic; otherwise the UI fails
closed and directs the user to the complete output. No reconstructed table data
is persisted in Supabase or GCS.

The browser uses a Supabase publishable key protected by SELECT-only grants and
RLS policies. It never receives the workflow's Supabase secret key and cannot
write database records.

## Local development

Copy `.env.example` to `.env.local`, supply the Supabase URL and publishable
key, then run:

```shell
npm ci
npm run dev
```

The dashboard is available at `http://localhost:3000` and opens the workflow
catalog. Legacy `?run=...&view=...` links redirect to the corresponding workflow route.

## Deployment

The application uses the standard Next.js runtime and can be deployed directly
to Vercel. Configure `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Preview and Production.

## Validation

```shell
npm run lint
npm test
npm run test:data
npm run test:e2e
```

`npm test` runs the production build and offline regression tests. `npm run
test:unit` runs only those offline tests. `npm run typecheck` checks TypeScript
after Next.js has generated route types. The data and browser suites use the
configured read-only data sources; the browser suite starts the local dev server
when one is not already running. Install Chromium with `npx playwright install
chromium` if required.

Push dashboard changes to a feature branch for a Vercel Preview deployment.
The production branch is `main`; preview work does not require a production deploy.
