const REVISION_PATTERN = /^[a-f0-9]{7,64}$/i;
const REPOSITORY_PART_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function textResponse(message: string, status: number, includeBody: boolean) {
  return new Response(includeBody ? message : null, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function encodePath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function pdfFileName(path: string) {
  const name = path.split("/").at(-1) || "source.pdf";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return ascii.toLowerCase().endsWith(".pdf") ? ascii : `${ascii}.pdf`;
}

function upstreamUrl(request: Request): { error: string } | { fileName: string; url: string } {
  const query = new URL(request.url).searchParams;
  const repository = query.get("repository")?.trim();
  const revision = query.get("revision")?.trim();
  const path = query.get("path")?.trim();

  const repositoryParts = repository?.split("/");
  if (
    repositoryParts?.length !== 2 ||
    repositoryParts.some((part) => !REPOSITORY_PART_PATTERN.test(part))
  ) {
    return { error: "A valid dataset repository is required." } as const;
  }
  if (!revision || !REVISION_PATTERN.test(revision)) {
    return { error: "A valid dataset revision is required." } as const;
  }
  if (
    !path ||
    !path.toLowerCase().endsWith(".pdf") ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return { error: "A valid PDF path is required." } as const;
  }

  return {
    fileName: pdfFileName(path),
    url: `https://huggingface.co/datasets/${encodePath(repositoryParts.join("/"))}/resolve/${encodeURIComponent(revision)}/${encodePath(path)}`,
  } as const;
}

async function servePdf(request: Request, includeBody: boolean) {
  const source = upstreamUrl(request);
  if ("error" in source) return textResponse(source.error, 400, includeBody);

  const requestHeaders = new Headers();
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"] as const) {
    const value = request.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(source.url, {
      method: includeBody ? "GET" : "HEAD",
      headers: requestHeaders,
      redirect: "follow",
      signal: request.signal,
    });
  } catch {
    return textResponse("The source PDF could not be loaded.", 502, includeBody);
  }

  // Keep upstream error pages inert on the dashboard's origin. Range and cache
  // responses retain their status and headers so PDF.js can retry correctly.
  const isPdfResponse = upstream.ok || upstream.status === 304;
  const headers = new Headers({
    "Content-Type": isPdfResponse ? "application/pdf" : "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (isPdfResponse) {
    headers.set("Content-Disposition", `inline; filename="${source.fileName}"`);
  }
  for (const name of [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ] as const) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(includeBody ? upstream.body : null, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function GET(request: Request) {
  return servePdf(request, true);
}

export async function HEAD(request: Request) {
  return servePdf(request, false);
}
