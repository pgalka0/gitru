import type {
  Actor,
  ReactionGroup,
  Reference,
  TimelineItem,
} from "@gitru/commands";
import { Badge } from "@gitru/ui/components/badge";
import { cn } from "@gitru/ui/lib/utils";
import {
  ArrowRightLeftIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  CopyIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LockIcon,
  LockOpenIcon,
  type LucideIcon,
  MilestoneIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  TagIcon,
  UserRoundMinusIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  GithubMarkdown,
  type IssueLinkTarget,
} from "@/components/github/github-markdown";
import {
  actorLogin,
  GithubAvatar,
  LabelChip,
  RelativeTime,
} from "@/components/github/github-primitives";
import { openExternalUrlSafely } from "@/lib/open-external-url";

export type OpenIssueHandler = (target: IssueLinkTarget) => boolean;

const REACTION_EMOJI: Record<string, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};

const ASSOCIATION_LABEL: Record<string, string> = {
  OWNER: "Owner",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
  CONTRIBUTOR: "Contributor",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor",
  FIRST_TIMER: "First-time contributor",
};

export function Reactions({ reactions }: { reactions: ReactionGroup[] }) {
  if (reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Reactions">
      {reactions.map((reaction) => (
        <span
          key={reaction.content}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums",
            reaction.viewer_has_reacted &&
              "border-info/40 bg-info/10 text-info-foreground",
          )}
          title={reaction.content.toLowerCase().replace("_", " ")}
        >
          <span aria-hidden>{REACTION_EMOJI[reaction.content] ?? "•"}</span>
          {reaction.count}
        </span>
      ))}
    </div>
  );
}

export function CommentCard({
  actor,
  association,
  createdAt,
  lastEditedAt,
  bodyHtml,
  reactions,
  htmlUrl,
  minimizedReason,
  verb = "commented",
  onOpenIssue,
}: {
  actor: Actor | undefined;
  association?: string;
  createdAt: string;
  lastEditedAt?: string;
  bodyHtml: string;
  reactions: ReactionGroup[];
  htmlUrl?: string;
  minimizedReason?: string;
  verb?: string;
  onOpenIssue?: OpenIssueHandler;
}) {
  const associationLabel = association
    ? ASSOCIATION_LABEL[association]
    : undefined;

  const header = (
    <header className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <GithubAvatar actor={actor} className="size-5" />
      <span className="font-semibold text-foreground">{actorLogin(actor)}</span>
      <span>{verb}</span>
      {htmlUrl ? (
        <button
          type="button"
          className="hover:text-foreground hover:underline"
          onClick={() => void openExternalUrlSafely(htmlUrl)}
        >
          <RelativeTime iso={createdAt} />
        </button>
      ) : (
        <RelativeTime iso={createdAt} />
      )}
      {lastEditedAt && (
        <span title={new Date(lastEditedAt).toLocaleString()}>· edited</span>
      )}
      {associationLabel && (
        <Badge variant="outline" size="sm" className="ms-auto">
          {associationLabel}
        </Badge>
      )}
    </header>
  );

  if (minimizedReason) {
    return (
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
          This comment by {actorLogin(actor)} was hidden as{" "}
          {minimizedReason.toLowerCase().replace("_", " ")}.
        </summary>
        {header}
        <div className="px-3 py-3">
          <GithubMarkdown html={bodyHtml} onOpenIssue={onOpenIssue} />
        </div>
      </details>
    );
  }

  return (
    <article className="overflow-hidden rounded-lg border bg-background">
      {header}
      <div className="flex flex-col gap-3 px-3 py-3">
        <GithubMarkdown html={bodyHtml} onOpenIssue={onOpenIssue} />
        <Reactions reactions={reactions} />
      </div>
    </article>
  );
}

function referenceIcon(reference: Reference): {
  icon: LucideIcon;
  className: string;
} {
  if (reference.kind === "commit") {
    return {
      icon: GitCommitHorizontalIcon,
      className: "text-muted-foreground",
    };
  }
  if (reference.kind === "pullRequest") {
    if (reference.state === "merged") {
      return {
        icon: GitMergeIcon,
        className: "text-violet-600 dark:text-violet-400",
      };
    }
    if (reference.state === "closed") {
      return {
        icon: GitPullRequestClosedIcon,
        className: "text-red-600 dark:text-red-400",
      };
    }
    if (reference.is_draft) {
      return {
        icon: GitPullRequestDraftIcon,
        className: "text-muted-foreground",
      };
    }
    return {
      icon: GitPullRequestIcon,
      className: "text-emerald-600 dark:text-emerald-400",
    };
  }
  return reference.state === "open"
    ? {
        icon: CircleDotIcon,
        className: "text-emerald-600 dark:text-emerald-400",
      }
    : {
        icon: CircleCheckIcon,
        className: "text-violet-600 dark:text-violet-400",
      };
}

/** An issue, PR or commit link. Issues of the current repo open in-app. */
export function ReferenceLink({
  reference,
  currentRepository,
  onOpenIssue,
  className,
}: {
  reference: Reference;
  /** `owner/name`, to hide the repository prefix for local references. */
  currentRepository?: string;
  onOpenIssue?: OpenIssueHandler;
  className?: string;
}) {
  const { icon: Icon, className: iconClassName } = referenceIcon(reference);
  const sameRepository =
    reference.repository?.toLowerCase() === currentRepository?.toLowerCase();
  const prefix =
    reference.kind === "commit"
      ? reference.abbreviated_oid
      : `${sameRepository ? "" : (reference.repository ?? "")}#${reference.number}`;

  const open = () => {
    if (
      reference.kind === "issue" &&
      reference.repository &&
      reference.number !== undefined
    ) {
      const [owner, name] = reference.repository.split("/");
      if (
        owner &&
        name &&
        onOpenIssue?.({ owner, name, number: reference.number })
      ) {
        return;
      }
    }
    void openExternalUrlSafely(reference.html_url);
  };

  return (
    <button
      type="button"
      onClick={open}
      title={reference.html_url}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 text-left align-bottom hover:underline",
        className,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", iconClassName)} aria-hidden />
      <span className="truncate text-foreground">{reference.title}</span>
      {prefix && (
        <span className="shrink-0 font-mono text-muted-foreground">
          {prefix}
        </span>
      )}
    </button>
  );
}

function EventRow({
  icon: Icon,
  actor,
  createdAt,
  children,
}: {
  icon: LucideIcon;
  actor: Actor | undefined;
  createdAt: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1 ps-3 text-xs text-muted-foreground">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-3" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 pt-0.5 leading-4">
        <GithubAvatar actor={actor} className="size-4" />
        <span className="font-semibold text-foreground">
          {actorLogin(actor)}
        </span>
        {children}
        <RelativeTime iso={createdAt} />
      </div>
    </div>
  );
}

const closedAs = (item: TimelineItem) =>
  item.state_reason === "notPlanned"
    ? "as not planned"
    : item.state_reason === "duplicate"
      ? "as duplicate"
      : "as completed";

export function TimelineEntry({
  item,
  currentRepository,
  onOpenIssue,
}: {
  item: TimelineItem;
  currentRepository: string;
  onOpenIssue: OpenIssueHandler;
}) {
  const ref = item.reference ? (
    <ReferenceLink
      reference={item.reference}
      currentRepository={currentRepository}
      onOpenIssue={onOpenIssue}
    />
  ) : null;
  const event = (icon: LucideIcon, children: ReactNode) => (
    <EventRow icon={icon} actor={item.actor} createdAt={item.created_at}>
      {children}
    </EventRow>
  );
  const selfAssigned =
    item.assignee?.login !== undefined &&
    item.assignee.login === item.actor?.login;

  switch (item.kind) {
    case "comment":
      return (
        <CommentCard
          actor={item.actor}
          association={item.author_association}
          createdAt={item.created_at}
          lastEditedAt={item.last_edited_at}
          bodyHtml={item.body_html ?? ""}
          reactions={item.reactions}
          htmlUrl={item.html_url}
          minimizedReason={item.minimized_reason}
          onOpenIssue={onOpenIssue}
        />
      );
    case "labeled":
    case "unlabeled":
      return event(
        TagIcon,
        <>
          {item.kind === "labeled" ? "added" : "removed"}
          {item.label && <LabelChip label={item.label} />}
        </>,
      );
    case "assigned":
      return event(
        UserRoundPlusIcon,
        selfAssigned ? (
          "self-assigned this"
        ) : (
          <>assigned {actorLogin(item.assignee)}</>
        ),
      );
    case "unassigned":
      return event(
        UserRoundMinusIcon,
        selfAssigned ? (
          "removed their assignment"
        ) : (
          <>unassigned {actorLogin(item.assignee)}</>
        ),
      );
    case "closed":
      return event(
        item.state_reason === "notPlanned" || item.state_reason === "duplicate"
          ? CircleSlashIcon
          : CircleCheckIcon,
        <>
          closed this {closedAs(item)}
          {ref && <>in {ref}</>}
        </>,
      );
    case "reopened":
      return event(CircleDotIcon, "reopened this");
    case "renamed":
      return event(
        PencilIcon,
        <>
          changed the title <del>{item.previous_title}</del>{" "}
          <span className="text-foreground">{item.current_title}</span>
        </>,
      );
    case "milestoned":
      return event(
        MilestoneIcon,
        <>
          added this to the{" "}
          <span className="text-foreground">{item.milestone_title}</span>{" "}
          milestone
        </>,
      );
    case "demilestoned":
      return event(
        MilestoneIcon,
        <>
          removed this from the{" "}
          <span className="text-foreground">{item.milestone_title}</span>{" "}
          milestone
        </>,
      );
    case "crossReferenced":
      return event(
        item.reference?.kind === "pullRequest"
          ? GitPullRequestIcon
          : CircleDotIcon,
        <>
          mentioned this in {ref}
          {item.will_close && (
            <Badge variant="outline" size="sm">
              will close
            </Badge>
          )}
        </>,
      );
    case "referenced":
      return event(
        GitCommitHorizontalIcon,
        <>
          referenced this in commit {ref}
          {item.reference?.repository &&
            item.reference.repository.toLowerCase() !==
              currentRepository.toLowerCase() && (
              <>in {item.reference.repository}</>
            )}
        </>,
      );
    case "connected":
      return event(GitPullRequestIcon, <>linked {ref}</>);
    case "disconnected":
      return event(GitPullRequestClosedIcon, <>removed a link to {ref}</>);
    case "locked":
      return event(
        LockIcon,
        item.lock_reason
          ? `locked this as ${item.lock_reason.toLowerCase().replace("_", " ")}`
          : "locked this conversation",
      );
    case "unlocked":
      return event(LockOpenIcon, "unlocked this conversation");
    case "pinned":
      return event(PinIcon, "pinned this issue");
    case "unpinned":
      return event(PinOffIcon, "unpinned this issue");
    case "transferred":
      return event(
        ArrowRightLeftIcon,
        <>
          transferred this issue from{" "}
          {item.from_repository ?? "another repository"}
        </>,
      );
    case "markedAsDuplicate":
      return event(CopyIcon, <>marked this as a duplicate of {ref}</>);
    default:
      return null;
  }
}
