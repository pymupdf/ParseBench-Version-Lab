# ParseBench Run Observatory

A standard Next.js, client-only benchmark analysis application for selecting GitHub Actions runs,
reviewing aggregate benchmark scores, finding low-scoring documents, and
comparing source PDFs with PyMuPDF4LLM markdown and available reference
markdown.

## Data sources

- Supabase provides the read-only run, score, case, metric, and error index.
- Google Cloud Storage provides result JSON artifacts.
- The pinned Hugging Face dataset revision provides PDFs and table reference
  markdown.

The browser uses a Supabase publishable key protected by SELECT-only grants and
RLS policies. It never receives the workflow's Supabase secret key and cannot
write database records.

## Local development

Copy `.env.example` to `.env.local`, supply the Supabase URL and publishable
key, then run:

```shell
npm install
npm run dev
```

The dashboard is available at `http://localhost:3000` and selects the latest
indexed workflow run by default.

## Deployment

The application uses the standard Next.js runtime and can be deployed directly
to Vercel. Configure `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Preview and Production.

## Validation

```shell
npm run lint
npm test
npm run test:data
```
