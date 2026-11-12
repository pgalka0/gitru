import type { Actor, IssueSummary, Label } from "@gitru/commands";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@gitru/ui/components/avatar";
import { cn } from "@gitru/ui/lib/utils";
import { CircleCheckIcon, CircleDotIcon, CircleSlashIcon } from "lucide-react";
import { format } from "timeago.js";
import { normalizeRemoteImageUrl } from "@/lib/external-content";
import { labelColors } from "@/lib/github-labels";

type IssueStateProps = Pick<IssueSummary, "state" | "state_reason">;

export function issueStateLabel({ state, state_reason }: IssueStateProps) {
  if (state === "open") return "Open";
  if (state_reason === "notPlanned") return "Closed as not planned";
  if (state_reason === "duplicate") return "Closed as duplicate";
  return "Closed";
}

/** Same meaning as on github.com: open, completed, not planned/duplicate. */
export function IssueStateIcon({
  state,
  state_reason,
  className,
}: IssueStateProps & { className?: string }) {
  const label = issueStateLabel({ state, state_reason });

  if (state === "open") {
    return (
      <CircleDotIcon
        aria-label={label}
        className={cn("text-emerald-600 dark:text-emerald-400", className)}
      />
    );
  }
  if (state_reason === "notPlanned" || state_reason === "duplicate") {
    return (
      <CircleSlashIcon
        aria-label={label}
        className={cn("text-muted-foreground", className)}
      />
    );
  }
  return (
    <CircleCheckIcon
      aria-label={label}
      className={cn("text-violet-600 dark:text-violet-400", className)}
    />
  );
}

export function LabelChip({
  label,
  className,
}: {
  label: Pick<Label, "name" | "color" | "description">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-48 items-center truncate rounded-full px-2 py-px text-xs font-medium leading-4",
        className,
      )}
      style={labelColors(label.color)}
      title={label.description ?? label.name}
    >
      {label.name}
    </span>
  );
}

export function GithubAvatar({
  actor,
  className,
}: {
  actor: Pick<Actor, "login" | "avatar_url"> | undefined;
  className?: string;
}) {
  const login = actor?.login ?? "ghost";
  return (
    <Avatar className={cn("size-5 rounded-full", className)}>
      <AvatarImage
        src={normalizeRemoteImageUrl(actor?.avatar_url)}
        alt={login}
      />
      <AvatarFallback className="rounded-full text-[0.6rem]">
        {login.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/** "3 days ago", with the exact local time on hover. */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return (
    <time dateTime={iso} title={date.toLocaleString()} className={className}>
      {format(date)}
    </time>
  );
}

export const actorLogin = (actor: Pick<Actor, "login"> | undefined) =>
  actor?.login ?? "ghost";
