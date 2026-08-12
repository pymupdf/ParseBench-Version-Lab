import { Suspense } from "react";

import DashboardClient from "../dashboard-client";

export default function WorkflowsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Suspense fallback={<div className="loading-panel">Loading dashboard…</div>}>
      <DashboardClient>{children}</DashboardClient>
    </Suspense>
  );
}
