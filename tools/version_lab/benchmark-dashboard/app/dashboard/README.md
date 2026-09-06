# Dashboard components

`../dashboard-client.tsx` is the client entry point shared by the workflow routes. It owns route state, URL-backed triage filters, asynchronous data loading, cancellation, and the queue dialog. The modules here are imported beneath that client boundary.

| Module | Responsibility |
| --- | --- |
| `workflow-browser.tsx` | Searchable run catalog, score leaders, run filters, and pagination |
| `overview.tsx` | Run summary, dimension scores, and embedded triage queue |
| `triage-grid.tsx` | Shared document filters, thumbnails, and queue pagination |
| `document-explorer.tsx` | Source viewer, evidence overlays, and result inspector tabs |
| `best-result-panel.tsx` | Historical result provenance and evidence comparison |
| `diagnostic-json.tsx` | Lazily rendered, paginated diagnostic JSON |
| `layout-evidence.ts` | Ground-truth and prediction geometry used by overlays |
| `markdown-panel.tsx` | Sanitized Markdown rendering |
| `commit-link.tsx` | Commit links and cached, on-demand GitHub tooltips |
| `shared.tsx` | Empty states, status badges, and score bars |
| `filters.ts` | Triage filter normalization and URL serialization |
| `format.ts` | Metric, score, date, duration, and run summary formatting |
| `constants.ts`, `types.ts` | Shared dimension configuration and UI state types |

Data access remains in `../lib/data.ts`. Changes to filter or result navigation must preserve the URL so a copied link and browser back/forward navigation reconstruct the same view. Heavy artifact fetching stays tied to the selected result; historical evidence is fetched only when requested.
