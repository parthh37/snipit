import type { ReactNode } from "react";
import type { Tool } from "./types";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      fill="none"
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
  select: (
    <Svg>
      <path d="M5 3l14 8-6 2-2 6z" />
    </Svg>
  ),
  arrow: (
    <Svg>
      <path d="M5 19L19 5M10 5h9v9" />
    </Svg>
  ),
  rect: (
    <Svg>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </Svg>
  ),
  ellipse: (
    <Svg>
      <ellipse cx="12" cy="12" rx="9" ry="7" />
    </Svg>
  ),
  line: (
    <Svg>
      <path d="M5 19L19 5" />
    </Svg>
  ),
  pen: (
    <Svg>
      <path d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3" />
    </Svg>
  ),
  highlighter: (
    <Svg>
      <path d="M9 15l-3 3v2h4l2-2M9 15l6-10 4 4-10 6zM4 21h16" />
    </Svg>
  ),
  text: (
    <Svg>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </Svg>
  ),
  callout: (
    <Svg>
      <path d="M4 5h16v10H10l-5 4v-4H4z" />
    </Svg>
  ),
  step: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M11 9l2-1v8" />
    </Svg>
  ),
  pixelate: (
    <Svg>
      <path d="M4 4h5v5H4zM15 4h5v5h-5zM9.5 9.5h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5z" />
    </Svg>
  ),
};

export function ToolIcon({ tool }: { tool: Tool }) {
  return toolIcons[tool];
}

export const UndoIcon = () => (
  <Svg>
    <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />
  </Svg>
);

export const RedoIcon = () => (
  <Svg>
    <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />
  </Svg>
);

export const CopyIcon = () => (
  <Svg>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 011-1h9" />
  </Svg>
);

export const SaveIcon = () => (
  <Svg>
    <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />
  </Svg>
);

export const PasteIcon = () => (
  <Svg>
    <path d="M9 4h6v3H9zM9 5H6v15h12V5h-3" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
