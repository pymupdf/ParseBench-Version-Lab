import { notFound } from "next/navigation";

function validateGithubRunId(value: string) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) notFound();
}

export default async function WorkflowOverviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  validateGithubRunId(runId);
  return null;
}
