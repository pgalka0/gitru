import type { Label, Milestone, RepositoryRef, User } from "@gitru/commands";
import { Button } from "@gitru/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@gitru/ui/components/dialog";
import { Input } from "@gitru/ui/components/input";
import { Spinner } from "@gitru/ui/components/spinner";
import { PlusIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { GithubAvatar, LabelChip } from "@/components/github/github-primitives";
import {
  MAX_MARKDOWN_LENGTH,
  MarkdownEditor,
} from "@/components/github/markdown-editor";
import { githubErrorMessage } from "@/hooks/use-github";
import { useCreateIssue } from "@/hooks/use-github-issue-mutations";
import { useGithubIssueMetadata } from "@/hooks/use-github-issues";
import { byLogin, byName } from "@/lib/github-issue-changes";
import {
  AssigneesPicker,
  LabelsPicker,
  MilestonePicker,
} from "./issue-pickers";

const MAX_TITLE_LENGTH = 256;

function MetadataField({
  title,
  picker,
  children,
}: {
  title: string;
  picker: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        {picker}
      </div>
      <div className="flex min-h-5 flex-wrap gap-1 text-sm">{children}</div>
    </div>
  );
}

const None = ({ children }: { children: ReactNode }) => (
  <span className="text-xs text-muted-foreground">{children}</span>
);

/** "New issue" button and the dialog it opens. */
export function NewIssueButton({
  repository,
  onCreated,
}: {
  repository: RepositoryRef;
  onCreated: (number: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const metadata = useGithubIssueMetadata(repository);
  const blocked = metadata.data?.can_create_issues === false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            disabled={blocked}
            title={
              blocked
                ? "You cannot open issues in this repository"
                : "New issue"
            }
          />
        }
      >
        <PlusIcon />
        New issue
      </DialogTrigger>
      <DialogPopup className="sm:max-w-2xl">
        {open && (
          <NewIssueForm
            repository={repository}
            canTriage={metadata.data?.can_triage ?? false}
            onCancel={() => setOpen(false)}
            onCreated={(number) => {
              setOpen(false);
              onCreated(number);
            }}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function NewIssueForm({
  repository,
  canTriage,
  onCancel,
  onCreated,
}: {
  repository: RepositoryRef;
  canTriage: boolean;
  onCancel: () => void;
  onCreated: (number: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  const [assignees, setAssignees] = useState<User[]>([]);
  const [milestone, setMilestone] = useState<Milestone>();
  const create = useCreateIssue(repository);
  const valid =
    title.trim().length > 0 &&
    title.length <= MAX_TITLE_LENGTH &&
    body.length <= MAX_MARKDOWN_LENGTH;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid || create.isPending) return;
    create.mutate(
      {
        title: title.trim(),
        body,
        label_ids: labels.map((label) => label.id),
        assignee_ids: assignees.map((user) => user.id),
        milestone_id: milestone?.id,
      },
      { onSuccess: (created) => onCreated(created.number) },
    );
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>New issue</DialogTitle>
        <DialogDescription>
          In {repository.owner}/{repository.name}
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-2">
        <Input
          aria-label="Title"
          placeholder="Title"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
        <MarkdownEditor
          repository={repository}
          label="Description"
          placeholder="Add a description"
          value={body}
          onChange={setBody}
          onSubmit={submit}
        />

        {canTriage && (
          <div className="grid gap-4 sm:grid-cols-3">
            <MetadataField
              title="Assignees"
              picker={
                <AssigneesPicker
                  repository={repository}
                  selected={assignees}
                  onChange={(next) => setAssignees([...next].sort(byLogin))}
                />
              }
            >
              {assignees.length === 0 ? (
                <None>No one</None>
              ) : (
                assignees.map((user) => (
                  <span
                    key={user.id}
                    className="flex items-center gap-1 text-xs"
                  >
                    <GithubAvatar actor={user} className="size-4" />
                    {user.login}
                  </span>
                ))
              )}
            </MetadataField>
            <MetadataField
              title="Labels"
              picker={
                <LabelsPicker
                  repository={repository}
                  selected={labels}
                  onChange={(next) => setLabels([...next].sort(byName))}
                />
              }
            >
              {labels.length === 0 ? (
                <None>None yet</None>
              ) : (
                labels.map((label) => (
                  <LabelChip key={label.id} label={label} />
                ))
              )}
            </MetadataField>
            <MetadataField
              title="Milestone"
              picker={
                <MilestonePicker
                  repository={repository}
                  selected={milestone}
                  onChange={setMilestone}
                />
              }
            >
              {milestone ? (
                <span className="truncate text-xs">{milestone.title}</span>
              ) : (
                <None>No milestone</None>
              )}
            </MetadataField>
          </div>
        )}

        {create.error && (
          <p role="alert" className="text-sm text-destructive-foreground">
            {githubErrorMessage(create.error)}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || create.isPending}>
          {create.isPending && <Spinner />}
          Create issue
        </Button>
      </DialogFooter>
    </form>
  );
}
