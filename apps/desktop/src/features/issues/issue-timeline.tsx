import type {
  Actor,
  ReactionGroup,
  Reference,
  RepositoryRef,
  TimelineItem,
} from "@gitru/commands";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@gitru/ui/components/alert-dialog";
import { Badge } from "@gitru/ui/components/badge";
import { Button } from "@gitru/ui/components/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@gitru/ui/components/menu";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@gitru/ui/components/popover";
import { Spinner } from "@gitru/ui/components/spinner";
import { cn } from "@gitru/ui/lib/utils";
import {
  ArrowRightLeftIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  CopyIcon,
  EllipsisIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LinkIcon,
  LockIcon,
  LockOpenIcon,
  type LucideIcon,
  MilestoneIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  QuoteIcon,
  SmilePlusIcon,
  TagIcon,
  Trash2Icon,
  UserRoundMinusIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { MarkdownEditor } from "@/components/github/markdown-editor";
import {
  REACTION_EMOJI,
  REACTION_LABEL,
  REACTION_ORDER,
  type ReactionContent,
} from "@/lib/github-issue-changes";
import { openExternalUrlSafely } from "@/lib/open-external-url";

export type OpenIssueHandler = (target: IssueLinkTarget) => boolean;

const ASSOCIATION_LABEL: Record<string, string> = {
  OWNER: "Owner",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
  CONTRIBUTOR: "Contributor",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor",
  FIRST_TIMER: "First-time contributor",
};

type ReactHandler = (content: ReactionContent, reacted: boolean) => void;

function ReactionPicker({
  reactions,
  onReact,
}: {
  reactions: ReactionGroup[];
  onReact: ReactHandler;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Add reaction"
            title="Add reaction"
            className="rounded-full text-muted-foreground"
          />
        }
      >
        <SmilePlusIcon />
      </PopoverTrigger>
      <PopoverPopup align="start" className="p-0 *:p-1!">
        <div className="flex gap-0.5">
          {REACTION_ORDER.map((content) => {
            const reacted =
              reactions.find((group) => group.content === content)
                ?.viewer_has_reacted ?? false;
            return (
              <button
                key={content}
                type="button"
                aria-label={REACTION_LABEL[content]}
                aria-pressed={reacted}
                title={REACTION_LABEL[content]}
                onClick={() => {
                  setOpen(false);
                  onReact(content, !reacted);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-base transition-transform hover:scale-110 hover:bg-accent",
                  reacted && "bg-info/10",
                )}
              >
                {REACTION_EMOJI[content]}
              </button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Reaction counts; toggleable when `onReact` is given. */
export function Reactions({
  reactions,
  onReact,
}: {
  reactions: ReactionGroup[];
  onReact?: ReactHandler;
}) {
  if (reactions.length === 0 && !onReact) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Reactions">
      {onReact && <ReactionPicker reactions={reactions} onReact={onReact} />}
      {reactions.map((reaction) => {
        const className = cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums",
          reaction.viewer_has_reacted &&
            "border-info/40 bg-info/10 text-info-foreground",
        );
        const label = `${REACTION_LABEL[reaction.content]}: ${reaction.count}`;
        const content = (
          <>
            <span aria-hidden>{REACTION_EMOJI[reaction.content]}</span>
            {reaction.count}
          </>
        );
        return onReact ? (
          <button
            key={reaction.content}
            type="button"
            aria-label={label}
            aria-pressed={reaction.viewer_has_reacted}
            title={label}
            onClick={() =>
              onReact(reaction.content, !reaction.viewer_has_reacted)
            }
            className={cn(className, "hover:bg-accent")}
          >
            {content}
          </button>
        ) : (
          <span key={reaction.content} className={className} title={label}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

/** What the viewer may do with a comment or the issue body. */
export interface CommentActions {
  /** Saves new markdown; the promise rejects when GitHub refuses it. */
  onSave?: (body: string) => Promise<unknown>;
  onDelete?: () => void;
  onReact?: ReactHandler;
  onQuote?: (markdown: string) => void;
  saving?: boolean;
}

const quote = (markdown: string) =>
  `${markdown
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;

export function CommentCard({
  actor,
  association,
  createdAt,
  lastEditedAt,
  bodyHtml,
  body,
  reactions,
  htmlUrl,
  minimizedReason,
  verb = "commented",
  pending = false,
  repository,
  actions,
  onOpenIssue,
}: {
  actor: Actor | undefined;
  association?: string;
  createdAt: string;
  lastEditedAt?: string;
  /** Absent while a new comment is still being posted. */
  bodyHtml: string | undefined;
  /** Markdown source, needed to edit or quote. */
  body?: string;
  reactions: ReactionGroup[];
  htmlUrl?: string;
  minimizedReason?: string;
  verb?: string;
  pending?: boolean;
  repository?: RepositoryRef;
  actions?: CommentActions;
  onOpenIssue?: OpenIssueHandler;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const associationLabel = association
    ? ASSOCIATION_LABEL[association]
    : undefined;
  const canEdit = Boolean(actions?.onSave && repository && body !== undefined);
  const canQuote = Boolean(actions?.onQuote && body?.trim());

  const startEditing = () => {
    setDraft(body ?? "");
    setEditing(true);
  };

  const save = () => {
    const onSave = actions?.onSave;
    if (!onSave) return;
    const text = draft;
    // Close right away; the cache already shows the new text. Reopen with
    // the draft if GitHub refuses, so nothing typed is lost.
    setEditing(false);
    onSave(text).catch(() => {
      setDraft(text);
      setEditing(true);
    });
  };

  const menu = !pending &&
    (htmlUrl || canEdit || canQuote || actions?.onDelete) && (
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Comment actions"
              className="-me-1 text-muted-foreground"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {htmlUrl && (
            <MenuItem
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(htmlUrl)
                  .catch(() => undefined)
              }
            >
              <LinkIcon />
              Copy link
            </MenuItem>
          )}
          {canQuote && body && (
            <MenuItem onClick={() => actions?.onQuote?.(quote(body))}>
              <QuoteIcon />
              Quote reply
            </MenuItem>
          )}
          {canEdit && (
            <MenuItem onClick={startEditing}>
              <PencilIcon />
              Edit
            </MenuItem>
          )}
          {actions?.onDelete && (
            <>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon />
                Delete
              </MenuItem>
            </>
          )}
        </MenuPopup>
      </Menu>
    );

  const header = (
    <header className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
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
      <span className="ms-auto flex items-center gap-1.5">
        {(pending || actions?.saving) && (
          <span className="flex items-center gap-1">
            <Spinner className="size-3" />
            {pending ? "Posting…" : "Saving…"}
          </span>
        )}
        {associationLabel && (
          <Badge variant="outline" size="sm">
            {associationLabel}
          </Badge>
        )}
        {menu}
      </span>
    </header>
  );

  const content =
    bodyHtml === undefined || (actions?.saving && body !== undefined) ? (
      // Still saving: show the source until GitHub returns rendered HTML.
      <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {body}
      </p>
    ) : (
      <GithubMarkdown html={bodyHtml} onOpenIssue={onOpenIssue} />
    );

  const deleteDialog = actions?.onDelete && (
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
          <AlertDialogDescription>
            The comment is removed from GitHub for everyone. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="px-4 py-3">
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            render={<Button variant="destructive" />}
            onClick={() => actions.onDelete?.()}
          >
            Delete
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );

  if (minimizedReason) {
    return (
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
          This comment by {actorLogin(actor)} was hidden as{" "}
          {minimizedReason.toLowerCase().replace("_", " ")}.
        </summary>
        {header}
        <div className="px-3 py-3">{content}</div>
        {deleteDialog}
      </details>
    );
  }

  if (editing && repository) {
    return (
      <MarkdownEditor
        repository={repository}
        label="Edit comment"
        value={draft}
        onChange={setDraft}
        onSubmit={save}
        onCancel={() => setEditing(false)}
        autoFocus
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Update comment
            </Button>
          </>
        }
      />
    );
  }

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border bg-background",
        pending && "opacity-70",
      )}
      aria-busy={pending || actions?.saving || undefined}
    >
      {header}
      <div className="flex flex-col gap-3 px-3 py-3">
        {content}
        <Reactions reactions={reactions} onReact={actions?.onReact} />
      </div>
      {deleteDialog}
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
  repository,
  actions,
  pending = false,
  onOpenIssue,
}: {
  item: TimelineItem;
  currentRepository: string;
  repository?: RepositoryRef;
  /** Comment actions the viewer may use on this item. */
  actions?: CommentActions;
  pending?: boolean;
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
          bodyHtml={pending ? undefined : (item.body_html ?? "")}
          body={item.body}
          reactions={item.reactions}
          htmlUrl={item.html_url}
          minimizedReason={item.minimized_reason}
          pending={pending}
          repository={repository}
          actions={actions}
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
