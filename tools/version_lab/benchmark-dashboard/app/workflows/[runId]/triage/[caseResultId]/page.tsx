import { notFound } from "next/navigation";

function validateNumericRouteValue(value: string) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) notFound();
}

export default async function WorkflowTriageCasePage({
  params,
}: {
  params: Promise<{ runId: string; caseResultId: string }>;
}) {
  const { runId, caseResultId } = await params;
  validateNumericRouteValue(runId);
  validateNumericRouteValue(caseResultId);
  return null;
}
