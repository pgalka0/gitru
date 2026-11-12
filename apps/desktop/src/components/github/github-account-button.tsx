import type { AuthStatus } from "@gitru/commands";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@gitru/ui/components/avatar";
import { Button } from "@gitru/ui/components/button";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@gitru/ui/components/popover";
import { Separator } from "@gitru/ui/components/separator";
import { Skeleton } from "@gitru/ui/components/skeleton";
import {
  CircleUserRoundIcon,
  ExternalLinkIcon,
  LogOutIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  githubErrorMessage,
  useGithubAuth,
  useGithubSignOut,
} from "@/hooks/use-github";
import { normalizeRemoteImageUrl } from "@/lib/external-content";
import { openExternalUrlSafely } from "@/lib/open-external-url";
import { GithubSignInOptions } from "./github-sign-in-options";

const SOURCE_LABEL: Record<NonNullable<AuthStatus["source"]>, string> = {
  deviceFlow: "Signed in with GitHub",
  ghCli: "Using the GitHub CLI token",
};

export function formatRateLimit(rateLimit: AuthStatus["rate_limit"]) {
  if (!rateLimit) return undefined;
  const reset = new Date(rateLimit.reset_at * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${rateLimit.remaining.toLocaleString()} / ${rateLimit.limit.toLocaleString()} API points left · resets ${reset}`;
}

export function GithubAccountButton() {
  const { data: auth, isPending } = useGithubAuth();
  const [open, setOpen] = useState(false);

  if (isPending) {
    return <Skeleton className="size-7 rounded-md" />;
  }

  const viewer = auth?.viewer;
  const label = viewer ? `GitHub: @${viewer.login}` : "Sign in to GitHub";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 p-0"
            aria-label={label}
            title={label}
          />
        }
      >
        {viewer ? (
          <Avatar className="size-7 rounded-md">
            <AvatarImage
              src={normalizeRemoteImageUrl(viewer.avatar_url)}
              alt={viewer.login}
            />
            <AvatarFallback className="rounded-md text-xs">
              {viewer.login.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ) : (
          <CircleUserRoundIcon className="opacity-70" />
        )}
      </PopoverTrigger>
      <PopoverPopup side="right" align="end" className="w-72">
        {auth?.signed_in ? (
          <SignedInPanel auth={auth} />
        ) : (
          <div className="flex flex-col gap-3">
            <PopoverTitle className="text-sm">Connect GitHub</PopoverTitle>
            <p className="text-xs text-muted-foreground">
              Browse issues and review pull requests for your repositories.
            </p>
            {auth?.error && (
              <p className="text-xs text-destructive-foreground" role="alert">
                {auth.error}
              </p>
            )}
            <GithubSignInOptions onDeviceFlowStart={() => setOpen(false)} />
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function SignedInPanel({ auth }: { auth: AuthStatus }) {
  const signOut = useGithubSignOut();
  const viewer = auth.viewer;
  const rateLimit = formatRateLimit(auth.rate_limit);

  return (
    <div className="flex flex-col gap-3">
      {viewer ? (
        <div className="flex items-center gap-3">
          <Avatar className="size-10 rounded-lg">
            <AvatarImage
              src={normalizeRemoteImageUrl(viewer.avatar_url)}
              alt={viewer.login}
            />
            <AvatarFallback className="rounded-lg">
              {viewer.login.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <PopoverTitle className="truncate text-sm">
              {viewer.name ?? viewer.login}
            </PopoverTitle>
            <p className="truncate text-xs text-muted-foreground">
              @{viewer.login}
            </p>
          </div>
        </div>
      ) : (
        <PopoverTitle className="text-sm">GitHub</PopoverTitle>
      )}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {auth.source && <span>{SOURCE_LABEL[auth.source]}</span>}
        {auth.scopes && (
          <span>
            Scopes: {auth.scopes.length > 0 ? auth.scopes.join(", ") : "none"}
          </span>
        )}
        {rateLimit && <span>{rateLimit}</span>}
        {auth.error && (
          <span className="text-destructive-foreground" role="alert">
            {auth.error}
          </span>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        {viewer && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => void openExternalUrlSafely(viewer.html_url)}
          >
            <ExternalLinkIcon />
            Open profile on GitHub
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          disabled={signOut.isPending}
          onClick={() =>
            signOut.mutate(undefined, {
              onError: (error) => toast.error(githubErrorMessage(error)),
            })
          }
        >
          <LogOutIcon />
          Sign out
        </Button>
      </div>
    </div>
  );
}
