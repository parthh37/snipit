import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, snipUrl, type Snip } from "../lib/api";
import { groupByDate, matches, tagCounts } from "./library";

interface Props {
  /** Bumped whenever a snip is added or changed. */
  refreshKey: number;
  onOpen: (snip: Snip) => void;
  notify: (message: string) => void;
  /** Show only the newest few, without the header (used on the Capture page). */
  limit?: number;
  /** The folder snips are saved in, for the header. */
  folder?: string | null;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function Gallery({
  refreshKey,
  onOpen,
  notify,
  limit,
  folder,
}: Props) {
  const [snips, setSnips] = useState<Snip[]>();
  // When the list was read, for "Today" and "Yesterday".
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSnips()
      .then((list) => {
        setSnips(list);
        setNow(Date.now());
      })
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

  const saveTags = async (snip: Snip, tags: string[]) => {
    try {
      const stored = await api.setSnipTags(snip.path, tags);
      setSnips((all) =>
        all?.map((s) => (s.path === snip.path ? { ...s, tags: stored } : s)),
      );
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const tags = useMemo(() => tagCounts(snips ?? []), [snips]);
  // A tag filter that no snip has any more (its last one was untagged) goes away.
  const activeTag = tag && tags.some(([t]) => t === tag) ? tag : null;
  const found = useMemo(
    () => (snips ?? []).filter((s) => matches(s, query, activeTag)),
    [snips, query, activeTag],
  );

  const card = (snip: Snip, withDate: boolean) => (
    <SnipCard
      key={snip.path}
      snip={snip}
      when={(withDate ? dateFormat : timeFormat).format(snip.modified)}
      onOpen={() => onOpen(snip)}
      onCopy={() => void copy(snip)}
      onReveal={() =>
        api.revealSnip(snip.path).catch((e) => notify(errorMessage(e)))
      }
      onDelete={() => void remove(snip)}
      onTags={(next) => void saveTags(snip, next)}
      onTagClick={setTag}
    />
  );

  if (limit) {
    const shown = snips?.slice(0, limit);
    return (
      <>
        {shown?.length === 0 && <Empty />}
        <Grid>{shown?.map((snip) => card(snip, true))}</Grid>
      </>
    );
  }

  const filtering = query.trim() !== "" || activeTag !== null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
          {snips
            ? filtering
              ? `${found.length} of ${snips.length} snips`
              : `${snips.length} snip${snips.length === 1 ? "" : "s"}`
            : " "}{" "}
          · saved in {folder ?? "Pictures\\Snipit"}
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search names, tags, apps, windows"
          aria-label="Search snips"
          className="w-64 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none select-text focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
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

      {tags.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">
            Tags
          </span>
          {tags.map(([t, n]) => (
            <button
              key={t}
              type="button"
              aria-pressed={activeTag === t}
              onClick={() => setTag(activeTag === t ? null : t)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                activeTag === t
                  ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-500"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {t} <span className="text-zinc-400">{n}</span>
            </button>
          ))}
        </div>
      )}

      {snips?.length === 0 && <Empty />}
      {snips && snips.length > 0 && found.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No snips match.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setTag(null);
            }}
            className="text-brand-600 hover:underline dark:text-brand-500"
          >
            Clear the search
          </button>
        </p>
      )}

      <div className="space-y-6">
        {groupByDate(found, now).map((group) => (
          <section key={group.label}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              {group.label}
            </h3>
            <Grid>{group.snips.map((snip) => card(snip, !group.sameDay))}</Grid>
          </section>
        ))}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      No snips yet. Every capture is saved here automatically.
    </p>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {children}
    </div>
  );
}

function SnipCard({
  snip,
  when,
  onOpen,
  onCopy,
  onReveal,
  onDelete,
  onTags,
  onTagClick,
}: {
  snip: Snip;
  when: string;
  onOpen: () => void;
  onCopy: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onTags: (tags: string[]) => void;
  onTagClick: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const origin = [snip.title, snip.app].filter(Boolean).join(" — ");

  return (
    <figure className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onOpen}
        title={origin ? `Open in editor\n${origin}` : "Open in editor"}
        className="checkerboard relative block aspect-video w-full"
      >
        <img
          src={snipUrl(snip)}
          alt={snip.name}
          loading="lazy"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {snip.editable && (
          <span
            title="Annotations can still be edited"
            className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
          >
            Editable
          </span>
        )}
      </button>
      <figcaption className="px-3 py-2">
        <div className="relative flex h-5 items-center">
          <span
            className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400"
            title={snip.name}
          >
            {when}
            {snip.app && ` · ${snip.app}`}
          </span>
          {/* Over the date while hovered, so the date keeps the whole row otherwise. */}
          <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 bg-white pl-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 dark:bg-zinc-900">
            <CardAction label="Copy" onClick={onCopy} />
            <CardAction label="Tags" onClick={() => setEditing(true)} />
            <CardAction label="Show" onClick={onReveal} />
            <CardAction label="Delete" danger onClick={onDelete} />
          </div>
        </div>
        {editing ? (
          <TagInput
            tags={snip.tags}
            onDone={(next) => {
              setEditing(false);
              if (next) onTags(next);
            }}
          />
        ) : (
          snip.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {snip.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  title={`Show snips tagged "${t}"`}
                  onClick={() => onTagClick(t)}
                  className="rounded-full bg-zinc-100 px-2 py-px text-[11px] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  {t}
                </button>
              ))}
            </div>
          )
        )}
      </figcaption>
    </figure>
  );
}

/** Comma-separated tags; Enter or leaving the field saves, Esc cancels. */
function TagInput({
  tags,
  onDone,
}: {
  tags: string[];
  onDone: (tags: string[] | null) => void;
}) {
  const [value, setValue] = useState(tags.join(", "));
  // Enter and Esc unmount the field, which can blur it too: only the first one counts.
  const done = useRef(false);
  const finish = (next: string[] | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  const parse = () =>
    value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(parse())}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(parse());
        if (e.key === "Escape") finish(null);
      }}
      placeholder="bug, release notes…"
      aria-label="Tags, separated by commas"
      className="mt-1.5 w-full rounded-md border border-brand-500 bg-white px-2 py-1 text-xs outline-none select-text dark:bg-zinc-900"
    />
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
      className={`rounded px-1.5 py-0.5 text-xs ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}
