import type { RepositoryRef } from "@gitru/commands";
import { Spinner } from "@gitru/ui/components/spinner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@gitru/ui/components/tabs";
import { Textarea } from "@gitru/ui/components/textarea";
import { cn } from "@gitru/ui/lib/utils";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useId,
  useState,
} from "react";
import { githubErrorMessage } from "@/hooks/use-github";
import { useGithubMarkdownPreview } from "@/hooks/use-github-issues";
import { GithubMarkdown } from "./github-markdown";

/** GitHub rejects longer issue and comment bodies. */
export const MAX_MARKDOWN_LENGTH = 65_536;

const SUBMIT_SHORTCUT =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
    ? "⌘↵"
    : "Ctrl+↵";

/**
 * A GitHub comment box: Write / Preview tabs, ⌘/Ctrl+Enter to submit and Esc
 * to cancel. The preview is rendered by GitHub for the given repository.
 */
export function MarkdownEditor({
  repository,
  value,
  onChange,
  onSubmit,
  onCancel,
  label,
  placeholder = "Leave a comment",
  autoFocus,
  disabled,
  textareaRef,
  footer,
  className,
}: {
  repository: RepositoryRef;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  /** Accessible name of the text box. */
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Buttons shown under the editor, right-aligned. */
  footer?: ReactNode;
  className?: string;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const preview = useGithubMarkdownPreview(
    repository,
    value,
    tab === "preview",
  );
  const hintId = useId();
  const tooLong = value.length > MAX_MARKDOWN_LENGTH;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!tooLong) onSubmit?.();
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background",
        className,
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as "write" | "preview")}
      >
        <TabsList
          variant="underline"
          className="border-b bg-muted/40 px-2 *:data-[slot=tabs-tab]:text-xs"
        >
          <TabsTab value="write">Write</TabsTab>
          <TabsTab value="preview">Preview</TabsTab>
        </TabsList>
        <TabsPanel value="write" className="p-2">
          <Textarea
            ref={textareaRef}
            aria-label={label}
            aria-describedby={hintId}
            aria-invalid={tooLong || undefined}
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus={autoFocus}
            disabled={disabled}
            spellCheck
            autoCorrect="on"
            style={{ minHeight: "6rem", maxHeight: "60vh" }}
          />
        </TabsPanel>
        <TabsPanel
          value="preview"
          className="min-h-28 px-3 py-2"
          aria-label="Preview"
        >
          {preview.isFetching && !preview.data ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : preview.error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {githubErrorMessage(preview.error)}
            </p>
          ) : (
            <GithubMarkdown
              html={value.trim() ? (preview.data ?? "") : ""}
              emptyText="Nothing to preview"
            />
          )}
        </TabsPanel>
      </Tabs>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-2 py-2">
        <p
          id={hintId}
          className={cn(
            "me-auto text-xs text-muted-foreground",
            tooLong && "text-destructive-foreground",
          )}
        >
          {tooLong
            ? `${(value.length - MAX_MARKDOWN_LENGTH).toLocaleString()} characters over GitHub's limit`
            : `Markdown supported${onSubmit ? ` · ${SUBMIT_SHORTCUT} to submit` : ""}`}
        </p>
        {footer}
      </div>
    </div>
  );
}
