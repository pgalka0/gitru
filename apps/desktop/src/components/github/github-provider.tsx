import { createContext, type ReactNode, useContext } from "react";
import { useGithubAuthSync } from "@/hooks/use-github";
import {
  GithubSignInDialog,
  useGithubDeviceFlowSession,
} from "./github-sign-in-dialog";

const StartSignInContext = createContext<(() => void) | null>(null);

/**
 * Mounted once per webview, inside the QueryClientProvider. Keeps the auth
 * cache in sync across webviews and owns the single Device Flow dialog, so a
 * sign-in started from a popover survives that popover closing.
 */
export function GithubProvider({ children }: { children: ReactNode }) {
  useGithubAuthSync();
  const session = useGithubDeviceFlowSession();

  return (
    <StartSignInContext.Provider value={session.begin}>
      {children}
      <GithubSignInDialog session={session} />
    </StartSignInContext.Provider>
  );
}

/** Opens the Device Flow dialog and requests a sign-in code. */
export function useStartGithubSignIn() {
  const start = useContext(StartSignInContext);
  if (!start) {
    throw new Error("useStartGithubSignIn must be used inside GithubProvider");
  }
  return start;
}
