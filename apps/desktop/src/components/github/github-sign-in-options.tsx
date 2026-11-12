import { Button } from "@gitru/ui/components/button";
import { Spinner } from "@gitru/ui/components/spinner";
import { GithubIcon, TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import {
  githubErrorMessage,
  useGithubAuth,
  useGithubImportCliToken,
} from "@/hooks/use-github";
import { useStartGithubSignIn } from "./github-provider";

/** The two ways to sign in, shared by the account popover and empty states. */
export function GithubSignInOptions({
  className,
  onDeviceFlowStart,
}: {
  className?: string;
  /** Called after the Device Flow dialog opens, e.g. to close a popover. */
  onDeviceFlowStart?: () => void;
}) {
  const { data: auth } = useGithubAuth();
  const importCliToken = useGithubImportCliToken();
  const startSignIn = useStartGithubSignIn();
  const deviceFlowAvailable = auth?.device_flow_available === true;

  return (
    <div className={className}>
      <div className="flex flex-col gap-2">
        <Button
          disabled={!deviceFlowAvailable}
          onClick={() => {
            startSignIn();
            onDeviceFlowStart?.();
          }}
        >
          <GithubIcon />
          Sign in with GitHub
        </Button>
        <Button
          variant="outline"
          disabled={importCliToken.isPending}
          onClick={() =>
            importCliToken.mutate(undefined, {
              onSuccess: (status) =>
                toast.success(
                  status.viewer
                    ? `Signed in to GitHub as @${status.viewer.login}`
                    : "Signed in to GitHub",
                ),
              onError: (error) => toast.error(githubErrorMessage(error)),
            })
          }
        >
          {importCliToken.isPending ? <Spinner /> : <TerminalIcon />}
          Use GitHub CLI token
        </Button>
      </div>
      {!deviceFlowAvailable && (
        <p className="mt-2 text-xs text-muted-foreground">
          Browser sign-in needs an OAuth App client ID in{" "}
          <code className="font-mono">GITRU_GITHUB_CLIENT_ID</code>. The GitHub
          CLI option works if you already ran{" "}
          <code className="font-mono">gh auth login</code>.
        </p>
      )}
    </div>
  );
}
