interface IconProps {
  name:
    | "activity"
    | "add"
    | "appearance-dark"
    | "appearance-light"
    | "appearance-system"
    | "close"
    | "drag"
    | "folder"
    | "message"
    | "power"
    | "send"
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
  close: "M6 6l12 12M18 6 6 18",
  drag: "M7 7h10M7 12h10M7 17h10",
  folder: "M3 7h6l2 2h10v10H3z",
  message: "M4 5h16v11H8l-4 4z",
  power: "M12 3v9m5.7-6.7a8 8 0 1 1-11.4 0",
  send: "m5 12 14-7-4 14-3-6z",
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
