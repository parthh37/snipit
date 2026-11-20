/* eslint-disable react-refresh/only-export-components -- the icon components are made by a small factory */
import type { ReactNode } from "react";
import type { Tool } from "./types";

function Svg({
  children,
  size = 18,
  filled,
}: {
  children: ReactNode;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const toolIcons: Record<Tool, ReactNode> = {
  favorites: (
    <path
      d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
      fill="currentColor"
    />
  ),
  arrow: (
    <>
      <path d="M19 19L7 7" strokeWidth={2.4} />
      <path d="M5 5h8.5L5 13.5z" fill="currentColor" stroke="none" />
    </>
  ),
  text: (
    <text
      x="12"
      y="19"
      textAnchor="middle"
      fontSize="21"
      fontFamily="Georgia, 'Times New Roman', serif"
      fill="currentColor"
      stroke="none"
    >
      a
    </text>
  ),
  callout: (
    <>
      <path
        d="M5 4h14a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0119 16h-6l-4 4v-4H5a1.5 1.5 0 01-1.5-1.5v-9A1.5 1.5 0 015 4z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M9 12.5l3-6 3 6M10 10.5h4"
        stroke="var(--icon-knock, #fff)"
        strokeWidth={1.6}
      />
    </>
  ),
  shape: (
    <>
      <rect
        x="3.5"
        y="3.5"
        width="11"
        height="11"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
      <circle cx="15" cy="15" r="5.5" />
    </>
  ),
  stamp: (
    <>
      <path
        d="M9.5 3.5h5l-.8 6.5h4.3a1.5 1.5 0 011.5 1.5V14H4.5v-2.5A1.5 1.5 0 016 10h4.3z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M4.5 17.5h15" />
      <path d="M6 20.5h12" />
    </>
  ),
  fill: (
    <>
      <path d="M11 4l7 7-6 6-7-7z" />
      <path d="M5 10h13" />
      <path
        d="M19.5 15s1.5 2 1.5 3a1.5 1.5 0 01-3 0c0-1 1.5-3 1.5-3z"
        fill="currentColor"
      />
    </>
  ),
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  selection: (
    <rect x="4" y="4" width="16" height="16" rx="1" strokeDasharray="3 3" />
  ),
  blur: (
    <path
      d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"
      fill="currentColor"
      stroke="none"
    />
  ),
  simplify: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <rect
        x="6"
        y="7.5"
        width="5"
        height="9"
        fill="currentColor"
        stroke="none"
      />
      <path d="M13.5 8h4M13.5 11h4M13.5 14h3" />
    </>
  ),
  magicwand: (
    <>
      <path d="M4 20L14 10" strokeWidth={2.4} />
      <path d="M15 3v3M15 12v2M19 7h2M10 7H8M18 4l-1.5 1.5M18 10l-1.5-1.5M12 4l1.5 1.5" />
    </>
  ),
  crop: <path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" />,
  cutout: (
    <>
      <path
        d="M3 6h18v4l-3 2 3 2v4H3v-4l3-2-3-2z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  pen: <path d="M4 17c3-9 6-12 8-8s-1 9 2 9 4-6 6-9" />,
  line: <path d="M5 19L19 5" strokeWidth={2.4} />,
  highlighter: (
    <>
      <path d="M14.5 4.5l5 5-7.5 7.5-5-5z" fill="currentColor" stroke="none" />
      <path d="M7 12l-2.5 5.5 2 2L12 17" />
      <path d="M3 21h8" strokeWidth={2.6} />
    </>
  ),
  step: (
    <>
      <circle cx="8" cy="8" r="5" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="16" r="4.5" />
      <path
        d="M7.2 6.5L8.4 5.8v4.6"
        stroke="var(--icon-knock, #fff)"
        strokeWidth={1.5}
      />
    </>
  ),
  eraser: (
    <>
      <path d="M8.5 19.5l-4-4a1.5 1.5 0 010-2.1L13.4 4.5a1.5 1.5 0 012.1 0l4 4a1.5 1.5 0 010 2.1L11 19.5z" />
      <path d="M8.5 9.5l6 6" />
      <path d="M11 19.5h9" />
    </>
  ),
  magnify: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5L20 20" strokeWidth={2.6} />
      <path d="M7.5 10h5M10 7.5v5" />
    </>
  ),
  spotlight: (
    <>
      <path d="M3 3h18v18H3z" strokeOpacity={0.45} />
      <circle cx="12" cy="12" r="5" />
    </>
  ),
};

/** One side of a sheet, torn: for the Effects panel's torn-edge buttons. */
export function TornIcon({
  side,
}: {
  side: "top" | "right" | "bottom" | "left";
}) {
  const rotate = { top: 180, right: 270, bottom: 0, left: 90 }[side];
  return (
    <Svg size={16}>
      <g transform={`rotate(${rotate} 12 12)`}>
        <path d="M5 4h14v11l-2.3 2-2.4-2-2.3 2-2.3-2-2.4 2L5 15z" />
      </g>
    </Svg>
  );
}

export function ToolIcon({ tool, size = 22 }: { tool: Tool; size?: number }) {
  return <Svg size={size}>{toolIcons[tool]}</Svg>;
}

const icon =
  (body: ReactNode, defaultSize = 18) =>
  ({ size = defaultSize }: { size?: number }) => <Svg size={size}>{body}</Svg>;

export const UndoIcon = icon(
  <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />,
  20,
);
export const RedoIcon = icon(
  <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />,
  20,
);
export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 011-1h9" />
  </>,
);
export const SaveIcon = icon(
  <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />,
);
export const PasteIcon = icon(<path d="M9 4h6v3H9zM9 5H6v15h12V5h-3" />);
export const ZoomIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </>,
  15,
);
export const CheckIcon = icon(<path d="M5 12l5 5 9-10" />);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const ChevronDown = icon(<path d="M6 9l6 6 6-6" />, 12);
export const MoreIcon = icon(<path d="M6 9l6 6 6-6" />, 10);
export const LibraryIcon = icon(
  <>
    <rect x="4" y="4" width="4" height="4" fill="currentColor" stroke="none" />
    <rect x="10" y="4" width="4" height="4" fill="currentColor" stroke="none" />
    <rect x="16" y="4" width="4" height="4" fill="currentColor" stroke="none" />
    <rect x="4" y="10" width="4" height="4" fill="currentColor" stroke="none" />
    <rect
      x="10"
      y="10"
      width="4"
      height="4"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="16"
      y="10"
      width="4"
      height="4"
      fill="currentColor"
      stroke="none"
    />
    <rect x="4" y="16" width="4" height="4" fill="currentColor" stroke="none" />
    <rect
      x="10"
      y="16"
      width="4"
      height="4"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="16"
      y="16"
      width="4"
      height="4"
      fill="currentColor"
      stroke="none"
    />
  </>,
  20,
);
export const EditorIcon = icon(
  <>
    <rect
      x="3"
      y="5"
      width="15"
      height="15"
      rx="3"
      fill="currentColor"
      stroke="none"
    />
    <path
      d="M10 14l9.5-9.5"
      stroke="var(--icon-knock, #fff)"
      strokeWidth={3.2}
    />
    <path d="M10 14l9.5-9.5" />
  </>,
  20,
);
export const CaptureIcon = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
    <circle
      cx="12"
      cy="12"
      r="8.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    />
    <circle cx="12" cy="12" r="6" fill="#6c6cff" />
  </svg>
);
export const RecentIcon = icon(
  <>
    <path d="M4 12a8 8 0 102.3-5.6L4 8.7" />
    <path d="M4 4v4.7h4.7M12 8v4l3 2" />
  </>,
  16,
);
export const EffectsIcon = icon(
  <>
    <path d="M4 20L15 9" />
    <path d="M17 3v3M17 9v1M20 6h2M12 6h1M19.5 3.5l-1 1M19.5 8.5l-1-1" />
  </>,
  16,
);
export const GearIcon = icon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9L7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
  </>,
  16,
);
export const SelectAllIcon = icon(
  <>
    <path d="M7 3l9 3.5v11L7 21z" fill="currentColor" stroke="none" />
    <path d="M16 6.5L20 5v11l-4 1.5M7 3l4-1.5 9 3.5" />
  </>,
  16,
);
export const EyedropperIcon = icon(
  <>
    <path d="M14.5 6.5l3 3M4 20l1-4 9-9 3 3-9 9z" />
    <path d="M15 5l2-2a2.1 2.1 0 013 3l-2 2" />
  </>,
  16,
);
export const StarIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden>
    <path
      d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
      fill={on ? "#f5b400" : "#ffffff"}
      stroke={on ? "#c48a00" : "#6b7280"}
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </svg>
);
export const BoldIcon = icon(
  <path d="M7 4h6a4 4 0 010 8H7zM7 12h7a4 4 0 010 8H7z" strokeWidth={2.4} />,
  14,
);
export const ItalicIcon = icon(<path d="M10 4h8M6 20h8M14 4l-4 16" />, 14);
export const UnderlineIcon = icon(
  <path d="M7 4v7a5 5 0 0010 0V4M5 20h14" />,
  14,
);
export const AlignIcon = ({
  align,
}: {
  align: "left" | "center" | "right";
}) => (
  <Svg size={14}>
    <path
      d={
        align === "left"
          ? "M4 6h16M4 10h10M4 14h16M4 18h10"
          : align === "center"
            ? "M4 6h16M7 10h10M4 14h16M7 18h10"
            : "M4 6h16M10 10h10M4 14h16M10 18h10"
      }
    />
  </Svg>
);
export const VAlignIcon = ({
  valign,
}: {
  valign: "top" | "middle" | "bottom";
}) => (
  <Svg size={14}>
    <path d="M4 3h16M4 21h16" strokeWidth={1.5} />
    <path
      d={
        valign === "top"
          ? "M8 7h8M8 10h8"
          : valign === "middle"
            ? "M8 10.5h8M8 13.5h8"
            : "M8 14h8M8 17h8"
      }
    />
  </Svg>
);
export const HelpIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01" />
  </>,
  16,
);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </>,
  14,
);
