import Link from "next/link";
import type { BenchmarkRun } from "./lib/data";
import { BrandMark, Icon } from "./ui/icons";

export function DashboardNavigation({
  view,
  run,
  runCount,
  loading,
}: {
  view: "runs" | "overview" | "triage" | "inspect";
  run: BenchmarkRun | null;
  runCount: number | null;
  loading: boolean;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <Link
          className="brand"
          href="/workflows"
          aria-label="ParseBench run observatory home"
        >
          <BrandMark />
          <span>
            <strong>
              ParseBench<span className="brand-period">.</span>
            </strong>
            <small>Run Observatory</small>
          </span>
        </Link>
        <nav className="view-nav" aria-label="Dashboard sections">
          <Link
            href="/workflows"
            aria-label="Workflows"
            aria-current={view === "runs" ? "page" : undefined}
            className={view === "runs" ? "view-nav-active" : ""}
          >
            <Icon name="grid" /> Workflows{" "}
            <span className="nav-count">
              {loading ? "…" : (runCount ?? "—")}
            </span>
          </Link>
          {run && (
            <>
              <Link
                href={`/workflows/${run.github_run_id}`}
                aria-current={view === "overview" ? "page" : undefined}
                className={view === "overview" ? "view-nav-active" : ""}
              >
                <Icon name="chart" /> Overview
              </Link>
              <Link
                href={`/workflows/${run.github_run_id}/triage`}
                aria-current={
                  view === "triage" || view === "inspect" ? "page" : undefined
                }
                className={
                  view === "triage" || view === "inspect"
                    ? "view-nav-active"
                    : ""
                }
              >
                <Icon name="document" /> Document triage
              </Link>
            </>
          )}
        </nav>
        <div className="topbar-utility">
          <span className="index-status">
            <span className="connection-dot" />{" "}
            {loading
              ? "Loading run index"
              : runCount == null
                ? "Run Observatory"
                : `${runCount} indexed runs`}
          </span>
          <a
            className="repository-link"
            href="https://github.com/pymupdf/ParseBench-Version-Lab"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="branch" size={16} />
            <span>Repository</span>
            <Icon name="external" size={13} />
          </a>
        </div>
      </header>
    </>
  );
}
