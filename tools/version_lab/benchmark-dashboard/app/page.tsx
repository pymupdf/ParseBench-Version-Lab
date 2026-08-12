import { redirect } from "next/navigation";

type LegacySearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LegacyDashboard({
  searchParams,
}: {
  searchParams: LegacySearchParams;
}) {
  const query = await searchParams;
  const run = firstValue(query.run);
  const view = firstValue(query.view);

  if (!run || !/^\d+$/.test(run) || view === "runs") {
    redirect("/workflows");
  }
  if (view === "documents") {
    redirect(`/workflows/${run}/documents`);
  }
  redirect(`/workflows/${run}`);
}
