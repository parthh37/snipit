import {
  type CaptureEntry,
  captureSrc,
  copyCapture,
  revealCapture,
} from "../../lib/capture";

interface Props {
  captures: CaptureEntry[];
  onCopied(): void;
}

export default function RecentCaptures({ captures, onCopied }: Props) {
  if (captures.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No captures yet. Press{" "}
        <kbd className="font-sans font-medium">PrtSc</kbd> to take your first
        one.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {captures.map((c) => (
        <li
          key={c.path}
          className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="relative aspect-video bg-[repeating-conic-gradient(#e4e4e7_0_25%,#fafafa_0_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)]">
            <img
              src={captureSrc(c)}
              alt={c.name}
              loading="lazy"
              draggable={false}
              className="absolute inset-0 size-full object-contain"
            />
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-t from-black/60 p-2 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              <ActionButton
                label="Copy"
                onClick={() => copyCapture(c.path).then(onCopied)}
              />
              <ActionButton
                label="Show in folder"
                onClick={() => revealCapture(c.path)}
              />
            </div>
          </div>
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium" title={c.name}>
              {c.name}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {c.width} × {c.height}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick(): Promise<unknown>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick().catch(() => undefined)}
      className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
    >
      {label}
    </button>
  );
}
