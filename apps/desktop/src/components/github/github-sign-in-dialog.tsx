import type { DeviceVerification } from "@gitru/commands";
import { Button } from "@gitru/ui/components/button";
import { CopyButton } from "@gitru/ui/components/copy-button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@gitru/ui/components/dialog";
import { Spinner } from "@gitru/ui/components/spinner";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { githubErrorMessage, useGithubDeviceFlow } from "@/hooks/use-github";
import { openExternalUrlSafely } from "@/lib/open-external-url";

type DeviceFlowState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "waiting"; verification: DeviceVerification }
  | { kind: "error"; message: string };

/**
 * Drives one Device Flow attempt. `begin` is called from a click handler; a
 * newer attempt or `abort` makes results of older attempts be ignored.
 */
export function useGithubDeviceFlowSession() {
  const { start, complete, cancel } = useGithubDeviceFlow();
  const [state, setState] = useState<DeviceFlowState>({ kind: "idle" });
  const attempt = useRef(0);

  const run = async () => {
    const id = ++attempt.current;
    const isCurrent = () => attempt.current === id;
    setState({ kind: "requesting" });

    try {
      const verification = await start.mutateAsync();
      if (!isCurrent()) return;
      setState({ kind: "waiting", verification });

      const status = await complete.mutateAsync();
      if (!isCurrent()) return;
      setState({ kind: "idle" });
      toast.success(
        status.viewer
          ? `Signed in to GitHub as @${status.viewer.login}`
          : "Signed in to GitHub",
      );
    } catch (error) {
      if (!isCurrent()) return;
      setState({ kind: "error", message: githubErrorMessage(error) });
    }
  };

  const begin = () => {
    void run();
  };

  const abort = () => {
    attempt.current++;
    setState({ kind: "idle" });
    void cancel();
  };

  return { state, begin, abort, isOpen: state.kind !== "idle" };
}

export function GithubSignInDialog({
  session,
}: {
  session: ReturnType<typeof useGithubDeviceFlowSession>;
}) {
  const { state, begin, abort, isOpen } = session;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) abort();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to GitHub</DialogTitle>
          <DialogDescription>
            Enter this code on github.com to let Gitru access your issues and
            pull requests. The token is stored in your system keychain.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "requesting" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Requesting a sign-in code…
          </div>
        )}

        {state.kind === "waiting" && (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2">
              <code
                className="rounded-lg border bg-muted px-4 py-2 font-mono text-2xl tracking-[0.2em] select-all"
                aria-label="Sign-in code"
              >
                {state.verification.user_code}
              </code>
              <CopyButton
                text={state.verification.user_code}
                variant="outline"
                size="icon"
                aria-label="Copy sign-in code"
              />
            </div>
            <Button
              onClick={async () => {
                await navigator.clipboard
                  ?.writeText(state.verification.user_code)
                  .catch(() => undefined);
                await openExternalUrlSafely(
                  state.verification.verification_uri,
                );
              }}
            >
              Copy code and open GitHub
              <ExternalLinkIcon />
            </Button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Waiting for you to approve on
              GitHub…
            </div>
          </div>
        )}

        {state.kind === "error" && (
          <p className="text-sm text-destructive-foreground" role="alert">
            {state.message}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={abort}>
            Cancel
          </Button>
          {state.kind === "error" && <Button onClick={begin}>Try again</Button>}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
