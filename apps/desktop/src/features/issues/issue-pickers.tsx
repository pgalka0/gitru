import type { Label, Milestone, RepositoryRef, User } from "@gitru/commands";
import { Button } from "@gitru/ui/components/button";
import { Checkbox } from "@gitru/ui/components/checkbox";
import { Input } from "@gitru/ui/components/input";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@gitru/ui/components/popover";
import { Spinner } from "@gitru/ui/components/spinner";
import { cn } from "@gitru/ui/lib/utils";
import { CheckIcon, Settings2Icon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { GithubAvatar } from "@/components/github/github-primitives";
import { githubErrorMessage } from "@/hooks/use-github";
import {
  useGithubAssignableUsers,
  useGithubIssueMetadata,
  useGithubRepositoryLabels,
} from "@/hooks/use-github-issues";
import { byLogin, byName } from "@/lib/github-issue-changes";
import { labelColors } from "@/lib/github-labels";

/** GitHub allows at most 10 assignees per issue. */
export const MAX_ASSIGNEES = 10;

function PickerTrigger({ label }: { label: string }) {
  return (
    <PopoverTrigger
      render={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          title={label}
          className="text-muted-foreground"
        />
      }
    >
      <Settings2Icon />
    </PopoverTrigger>
  );
}

function PickerShell({
  title,
  filter,
  onFilterChange,
  filterLabel,
  status,
  children,
}: {
  title: string;
  filter: string;
  onFilterChange: (value: string) => void;
  filterLabel: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PopoverPopup align="end" className="w-72 p-0 *:p-0!">
      <div className="flex flex-col gap-2 border-b p-2">
        <PopoverTitle className="px-1 text-xs font-medium">
          {title}
        </PopoverTitle>
        <Input
          size="sm"
          aria-label={filterLabel}
          placeholder={filterLabel}
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          autoFocus
        />
      </div>
      {status}
      <div className="max-h-72 overflow-y-auto p-1">{children}</div>
    </PopoverPopup>
  );
}

function PickerStatus({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: unknown;
  empty?: string;
}) {
  if (loading) {
    return (
      <div className="flex justify-center p-3">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="px-3 py-2 text-xs text-destructive-foreground">
        {githubErrorMessage(error)}
      </p>
    );
  }
  if (empty) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{empty}</p>;
  }
  return null;
}

function CheckRow({
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside is the control
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="flex min-w-0 flex-1 flex-col">{children}</span>
    </label>
  );
}

const matches = (filter: string, ...values: (string | undefined)[]) => {
  const needle = filter.trim().toLowerCase();
  return (
    !needle || values.some((value) => value?.toLowerCase().includes(needle))
  );
};

/**
 * Pick labels; the change is applied when the popover closes, like on
 * github.com, so toggling several labels costs one request.
 */
export function LabelsPicker({
  repository,
  selected,
  onChange,
}: {
  repository: RepositoryRef;
  selected: Label[];
  onChange: (next: Label[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Label[]>(selected);
  const [filter, setFilter] = useState("");
  const labels = useGithubRepositoryLabels(open ? repository : undefined);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(selected);
      setFilter("");
    } else {
      onChange(draft);
    }
    setOpen(next);
  };

  // Labels selected when the picker opened stay on top while toggling.
  const initial = new Set(selected.map((label) => label.id));
  const known = labels.data ?? [];
  const options = [
    ...selected.filter((label) => !known.some((k) => k.id === label.id)),
    ...known,
  ]
    .filter((label) => matches(filter, label.name, label.description))
    .sort(
      (a, b) =>
        Number(initial.has(b.id)) - Number(initial.has(a.id)) || byName(a, b),
    );

  const toggle = (label: Label, checked: boolean) =>
    setDraft((current) =>
      checked
        ? [...current, label]
        : current.filter((item) => item.id !== label.id),
    );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PickerTrigger label="Edit labels" />
      <PickerShell
        title="Apply labels to this issue"
        filter={filter}
        onFilterChange={setFilter}
        filterLabel="Filter labels"
        status={
          <PickerStatus
            loading={labels.isPending && labels.fetchStatus !== "idle"}
            error={labels.error}
            empty={
              !labels.isPending && options.length === 0
                ? "No labels match"
                : undefined
            }
          />
        }
      >
        {options.map((label) => {
          const colors = labelColors(label.color);
          return (
            <CheckRow
              key={label.id}
              checked={draft.some((item) => item.id === label.id)}
              onCheckedChange={(checked) => toggle(label, checked)}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full border border-black/10 dark:border-white/15"
                  style={{ backgroundColor: colors.backgroundColor }}
                />
                <span className="truncate font-medium">{label.name}</span>
              </span>
              {label.description && (
                <span className="truncate ps-5 text-xs text-muted-foreground">
                  {label.description}
                </span>
              )}
            </CheckRow>
          );
        })}
      </PickerShell>
    </Popover>
  );
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Pick assignees from the repository's assignable users. */
export function AssigneesPicker({
  repository,
  selected,
  onChange,
}: {
  repository: RepositoryRef;
  selected: User[];
  onChange: (next: User[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<User[]>(selected);
  const [filter, setFilter] = useState("");
  const query = useDebouncedValue(filter, 250);
  const users = useGithubAssignableUsers(repository, query, open);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(selected);
      setFilter("");
    } else {
      onChange(draft);
    }
    setOpen(next);
  };

  const initial = selected.filter((user) => matches(filter, user.login));
  const options = [
    ...initial.sort(byLogin),
    ...(users.data ?? []).filter(
      (user) => !initial.some((item) => item.id === user.id),
    ),
  ];
  const full = draft.length >= MAX_ASSIGNEES;

  const toggle = (user: User, checked: boolean) =>
    setDraft((current) =>
      checked
        ? [...current, user]
        : current.filter((item) => item.id !== user.id),
    );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PickerTrigger label="Edit assignees" />
      <PickerShell
        title={`Assign up to ${MAX_ASSIGNEES} people`}
        filter={filter}
        onFilterChange={setFilter}
        filterLabel="Type or choose a user"
        status={
          <PickerStatus
            loading={users.isPending && users.fetchStatus !== "idle"}
            error={users.error}
            empty={
              !users.isPending && options.length === 0
                ? "No one matches"
                : undefined
            }
          />
        }
      >
        {options.map((user) => {
          const checked = draft.some((item) => item.id === user.id);
          return (
            <CheckRow
              key={user.id}
              checked={checked}
              disabled={!checked && full}
              onCheckedChange={(value) => toggle(user, value)}
            >
              <span className="flex items-center gap-2">
                <GithubAvatar actor={user} className="size-4" />
                <span className="truncate">{user.login}</span>
              </span>
            </CheckRow>
          );
        })}
      </PickerShell>
    </Popover>
  );
}

/** Pick one open milestone, or none. Applies immediately. */
export function MilestonePicker({
  repository,
  selected,
  onChange,
}: {
  repository: RepositoryRef;
  selected: Milestone | undefined;
  onChange: (next: Milestone | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const metadata = useGithubIssueMetadata(open ? repository : undefined);
  const milestones = (metadata.data?.milestones ?? []).filter((milestone) =>
    matches(filter, milestone.title),
  );

  const choose = (milestone: Milestone | undefined) => {
    setOpen(false);
    onChange(milestone);
  };

  const row = (
    key: string,
    milestone: Milestone | undefined,
    content: ReactNode,
  ) => {
    const active = (milestone?.id ?? null) === (selected?.id ?? null);
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => choose(milestone)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <CheckIcon
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0", !active && "invisible")}
        />
        <span className="flex min-w-0 flex-1 flex-col">{content}</span>
      </button>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setFilter("");
        setOpen(next);
      }}
    >
      <PickerTrigger label="Edit milestone" />
      <PickerShell
        title="Set milestone"
        filter={filter}
        onFilterChange={setFilter}
        filterLabel="Filter milestones"
        status={
          <PickerStatus
            loading={metadata.isPending && metadata.fetchStatus !== "idle"}
            error={metadata.error}
          />
        }
      >
        {row(
          "none",
          undefined,
          <span className="text-muted-foreground">No milestone</span>,
        )}
        {milestones.map((milestone) =>
          row(
            milestone.id,
            milestone,
            <>
              <span className="truncate font-medium">{milestone.title}</span>
              {milestone.due_on && (
                <span className="text-xs text-muted-foreground">
                  Due {new Date(milestone.due_on).toLocaleDateString()}
                </span>
              )}
            </>,
          ),
        )}
      </PickerShell>
    </Popover>
  );
}
