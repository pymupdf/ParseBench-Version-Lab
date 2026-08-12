import { notFound, redirect } from "next/navigation";

function validateGithubRunId(value: string) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) notFound();
}

export default async function WorkflowDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runId } = await params;
  validateGithubRunId(runId);
  const query = await searchParams;
  const nextQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((item) => nextQuery.append(key, item));
    else if (value != null) nextQuery.set(key, value);
  }
  const suffix = nextQuery.size ? `?${nextQuery.toString()}` : "";
  redirect(`/workflows/${runId}/triage${suffix}`);
}
