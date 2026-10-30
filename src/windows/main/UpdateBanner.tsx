import type { UpdaterState } from "./useUpdater";

interface UpdateBannerProps {
  state: UpdaterState;
  onInstall: () => void;
  onDismiss: () => void;
}

function UpdateBanner({ state, onInstall, onDismiss }: UpdateBannerProps) {
  if (state.status === "idle" || state.status === "checking") return null;

  const button =
    "rounded-md px-3 py-1 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/10";

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-zinc-200 bg-sky-50 px-6 py-2 text-sm dark:border-zinc-800 dark:bg-sky-950/40"
    >
      <p className="flex-1">
        {state.status === "available" && (
          <>
            <span className="font-medium">
              Snipit {state.update.version} is available.
            </span>{" "}
            <span className="text-zinc-500 dark:text-zinc-400">
              You have {state.update.currentVersion}.
            </span>
          </>
        )}
        {state.status === "installing" &&
          `Downloading Snipit ${state.version}… ${
            state.progress === undefined
              ? ""
              : `${Math.round(state.progress * 100)}%`
          }`}
        {state.status === "up-to-date" && "You're on the latest version."}
        {state.status === "error" && `Couldn't update: ${state.message}`}
      </p>
      {state.status === "available" && (
        <button
          type="button"
          onClick={onInstall}
          className={`${button} bg-sky-600 text-white hover:bg-sky-700 dark:hover:bg-sky-500`}
        >
          Update &amp; restart
        </button>
      )}
      {state.status !== "installing" && (
        <button type="button" onClick={onDismiss} className={button}>
          {state.status === "available" ? "Later" : "Dismiss"}
        </button>
      )}
    </div>
  );
}

export default UpdateBanner;
