interface IconProps {
  name:
    | "activity"
    | "add"
    | "appearance-dark"
    | "appearance-light"
    | "appearance-system"
    | "arrow-right"
    | "check"
    | "close"
    | "code"
    | "copy"
    | "copy-check"
    | "chevron-left"
    | "chevron-right"
    | "drag"
    | "error"
    | "folder"
    | "glob"
    | "list"
    | "message"
    | "pencil"
    | "power"
    | "read"
    | "search"
    | "send"
    | "skill"
    | "subagent"
    | "terminal"
    | "thinking"
    | "trash"
    | "unmount";
}

const paths: Record<IconProps["name"], string> = {
  activity: "M5 7h14M5 12h14M5 17h8",
  add: "M12 5v14M5 12h14",
  "appearance-dark": "M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z",
  "appearance-light":
    "M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  "appearance-system": "M4 5h16v12H4zM9 21h6M12 17v4",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  check: "M5 13l4 4L19 7",
  close: "M6 6l12 12M18 6 6 18",
  code: "M9 8l-4 4 4 4m6-8 4 4-4 4",
  copy: "M9 9h10v10H9zM5 5h10v4M5 5v10h4",
  "copy-check": "M9 9h10v10H9zM5 5h10v4M5 5v10h4M12 14l2 2 4-4",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-right": "M9 6l6 6-6 6",
  drag: "M7 7h10M7 12h10M7 17h10",
  error: "M12 3l9 16H3zM12 10v4m0 3v.5",
  folder: "M3 7h6l2 2h10v10H3z",
  glob: "M5 6h14M5 12h14M5 18h9",
  list: "M4 6h16M4 12h16M4 18h16",
  message: "M4 5h16v11H8l-4 4z",
  pencil: "M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3zM14 6l3 3",
  power: "M12 3v9m5.7-6.7a8 8 0 1 1-11.4 0",
  read: "M4 5h7v14H4zM13 5h7v14h-7M11 5v14",
  search: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-5.6-5.6",
  send: "m5 12 14-7-4 14-3-6z",
  skill: "M12 3l2.3 5.5 5.9.5-4.5 3.8 1.4 5.7L12 15.8 6.5 18.5l1.4-5.7L3.4 9l5.9-.5z",
  subagent: "M6 4v6a4 4 0 0 0 4 4h8m0 0-3-3m3 3-3 3",
  terminal: "M4 5h16v14H4zM7 9l3 3-3 3M13 15h4",
  thinking:
    "M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.6.6-1 1.4-1 2.5H9c0-1.1-.4-1.9-1-2.5A6 6 0 0 1 12 3z",
  trash: "M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 10v7m4-7v7",
  unmount: "M12 5 5 15h14L12 5zM5 19h14",
};

export function Icon({ name }: IconProps) {
  return (
    <svg aria-hidden="true" className={`icon icon-${name}`} viewBox="0 0 24 24">
      <path d={paths[name]} />
    </svg>
  );
}
