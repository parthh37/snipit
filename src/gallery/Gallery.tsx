import { useEffect, useState } from "react";
import { api, errorMessage, snipUrl, type Snip } from "../lib/api";

interface Props {
  /** Bumped whenever a snip is added or changed. */
  refreshKey: number;
  onOpen: (snip: Snip) => void;
  notify: (message: string) => void;
  /** Show only the newest few, without the header (used on the Capture page). */
  limit?: number;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function Gallery({ refreshKey, onOpen, notify, limit }: Props) {
  const [snips, setSnips] = useState<Snip[]>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api
      .listSnips()
      .then(setSnips)
      .catch((e) => notify(errorMessage(e)));
  }, [refreshKey, reload, notify]);

  const copy = async (snip: Snip) => {
    try {
      await api.copyPng(new Uint8Array(await api.readSnip(snip.path)));
      notify("Copied to clipboard");
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const remove = async (snip: Snip) => {
    if (!window.confirm(`Move "${snip.name}" to the Recycle Bin?`)) return;
    try {
      await api.deleteSnip(snip.path);
      setReload((n) => n + 1);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const shown = limit ? snips?.slice(0, limit) : snips;

  return (
    <div>
      {!limit && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {snips
              ? `${snips.length} snip${snips.length === 1 ? "" : "s"}`
              : " "}{" "}
            · saved in Pictures\Snipit
          </p>
          <button
            type="button"
            onClick={() =>
              api.openGalleryFolder().catch((e) => notify(errorMessage(e)))
            }
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Open folder
          </button>
        </div>
      )}

      {shown?.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No snips yet. Every capture is saved here automatically.
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {shown?.map((snip) => (
          <figure
            key={snip.path}
            className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => onOpen(snip)}
              title="Open in editor"
              className="checkerboard relative block aspect-video w-full"
            >
              <img
                src={snipUrl(snip)}
                alt={snip.name}
                loading="lazy"
                draggable={false}
                className="absolute inset-0 h-full w-full object-contain"
              />
            </button>
            <figcaption className="flex items-center gap-1 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {dateFormat.format(snip.modified)}
              </span>
              <CardAction label="Copy" onClick={() => void copy(snip)} />
              <CardAction
                label="Show"
                onClick={() =>
                  api
                    .revealSnip(snip.path)
                    .catch((e) => notify(errorMessage(e)))
                }
              />
              <CardAction
                label="Delete"
                danger
                onClick={() => void remove(snip)}
              />
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function CardAction({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-xs opacity-0 transition group-hover:opacity-100 focus:opacity-100 ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}
