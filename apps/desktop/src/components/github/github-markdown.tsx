import { cn } from "@gitru/ui/lib/utils";
import { type MouseEvent, useMemo } from "react";
import { parseGithubIssueUrl, sanitizeGithubHtml } from "@/lib/github-html";
import { openExternalUrlSafely } from "@/lib/open-external-url";
import "./github-markdown.css";

export type IssueLinkTarget = NonNullable<
  ReturnType<typeof parseGithubIssueUrl>
>;

/**
 * Renders GitHub's `bodyHTML` after sanitizing it. Links never navigate the
 * webview: issue links may be handled in-app (`onOpenIssue` returns true),
 * everything else opens in the system browser.
 */
export function GithubMarkdown({
  html,
  onOpenIssue,
  className,
}: {
  html: string;
  onOpenIssue?: (target: IssueLinkTarget) => boolean;
  className?: string;
}) {
  const sanitized = useMemo(() => sanitizeGithubHtml(html), [html]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest("a");
    if (!anchor || !event.currentTarget.contains(anchor)) return;

    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    const issue = parseGithubIssueUrl(href);
    if (issue && onOpenIssue?.(issue)) return;
    void openExternalUrlSafely(href);
  };

  if (!sanitized.trim()) {
    return (
      <p className={cn("text-sm italic text-muted-foreground", className)}>
        No description provided.
      </p>
    );
  }

  return (
    // Links inside are focusable and Enter fires `click`, so the delegated
    // handler also covers keyboard use.
    // biome-ignore lint/a11y/useKeyWithClickEvents: delegated link clicks
    // biome-ignore lint/a11y/noStaticElementInteractions: delegated link clicks
    <div
      className={cn("gh-markdown", className)}
      onClick={handleClick}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by sanitizeGithubHtml
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
