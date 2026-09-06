import { useState, useId } from "react";
import { shortSha } from "./format";

type GitHubCommitReference = {
  apiUrl: string;
  webUrl: string;
};

const commitMessageCache = new Map<string, Promise<string>>();

function githubCommitReference(
  repository: string | null,
  sha: string | null,
): GitHubCommitReference | null {
  const normalizedRepository = repository
    ?.trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  if (
    !normalizedRepository ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedRepository) ||
    !sha ||
    !/^[a-f0-9]{7,40}$/i.test(sha)
  ) {
    return null;
  }
  const [owner, name] = normalizedRepository.split("/");
  return {
    apiUrl: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`,
    webUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commit/${encodeURIComponent(sha)}`,
  };
}

function loadGitHubCommitMessage(reference: GitHubCommitReference) {
  const cached = commitMessageCache.get(reference.apiUrl);
  if (cached) return cached;
  const request = fetch(reference.apiUrl, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
      }
      const payload = (await response.json()) as {
        commit?: { message?: string };
      };
      const message = payload.commit?.message?.trim();
      if (!message) throw new Error("GitHub did not return a commit message");
      return message;
    })
    .catch((error) => {
      commitMessageCache.delete(reference.apiUrl);
      throw error;
    });
  commitMessageCache.set(reference.apiUrl, request);
  return request;
}

export function CommitLink({
  repository,
  sha,
}: {
  repository: string | null;
  sha: string | null;
}) {
  const reference = githubCommitReference(repository, sha);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const tooltipId = useId();

  if (!reference) return <code>{shortSha(sha)}</code>;

  function requestMessage() {
    if (message || loading || unavailable) return;
    setLoading(true);
    setUnavailable(false);
    loadGitHubCommitMessage(reference!)
      .then(setMessage)
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }

  const tooltip = message ??
    (unavailable ? "Commit message unavailable from GitHub" : "Loading commit message…");

  return (
    <span
      className="commit-link-wrap"
      onMouseEnter={requestMessage}
      onFocus={requestMessage}
    >
      <a
        className="commit-link"
        href={reference.webUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open commit ${shortSha(sha)} in ${repository} on GitHub`}
        aria-describedby={tooltipId}
      >
        <code>{shortSha(sha)}</code>
        <span className="commit-link-icon" aria-hidden="true">↗</span>
      </a>
      <span
        className="commit-tooltip"
        id={tooltipId}
        role="tooltip"
        aria-live="polite"
      >
        {tooltip}
      </span>
    </span>
  );
}
