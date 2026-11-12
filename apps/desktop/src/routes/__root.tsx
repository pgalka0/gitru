import { createRootRoute, Outlet } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StateFlags, saveWindowState } from "@tauri-apps/plugin-window-state";
import { useEffect } from "react";

const WINDOW_STATE_FLAGS =
  StateFlags.SIZE | StateFlags.POSITION | StateFlags.MAXIMIZED;
const WINDOW_STATE_SAVE_DELAY_MS = 400;
const WINDOW_STATE_STARTUP_DELAY_MS = 1_000;

const isEmbeddedRuntime = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  return (
    searchParams.get("embedded") === "1" ||
    searchParams.get("embedded") === "true"
  );
};

function WindowStatePersistence() {
  useEffect(() => {
    let disposed = false;
    let saveTimer: number | undefined;
    let removeMoveListener: (() => void) | undefined;
    let removeResizeListener: (() => void) | undefined;

    const save = () => {
      saveTimer = undefined;
      void saveWindowState(WINDOW_STATE_FLAGS).catch((error) => {
        console.error("failed to persist window state", error);
      });
    };

    const scheduleSave = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(save, WINDOW_STATE_SAVE_DELAY_MS);
    };

    const registerListeners = async () => {
      const appWindow = getCurrentWindow();
      const listeners = await Promise.all([
        appWindow.onMoved(scheduleSave),
        appWindow.onResized(scheduleSave),
      ]);

      if (disposed) {
        for (const removeListener of listeners) removeListener();
        return;
      }

      [removeMoveListener, removeResizeListener] = listeners;
    };

    const startupTimer = window.setTimeout(() => {
      void registerListeners().catch((error) => {
        console.error("failed to monitor window state", error);
      });
    }, WINDOW_STATE_STARTUP_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(startupTimer);
      window.clearTimeout(saveTimer);
      removeMoveListener?.();
      removeResizeListener?.();
    };
  }, []);

  return null;
}

export const Route = createRootRoute({
  component: () => {
    const content = (
      <div className="h-screen w-full">
        <Outlet />
      </div>
    );

    if (isEmbeddedRuntime()) {
      return content;
    }

    return (
      <>
        <WindowStatePersistence />
        {content}
      </>
    );
  },
});
