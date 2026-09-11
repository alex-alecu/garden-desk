import type { CommandSummary } from "@gardendesk/shared";
import { type KeyboardEvent, type RefObject, useEffect, useId, useState } from "react";

interface CommandMenuInput {
  commands: CommandSummary[];
  draft: string;
  enabled: boolean;
  textarea: RefObject<HTMLTextAreaElement | null>;
  onChange: (draft: string) => void;
}

function menuAction(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.nativeEvent.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey
  )
    return undefined;
  const keys: Record<string, "close" | "next" | "previous" | "insert"> = {
    Escape: "close",
    ArrowDown: "next",
    ArrowUp: "previous",
    Enter: "insert",
    Tab: "insert",
  };
  return keys[event.key];
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: keep focus, cursor, selection, and insertion state in one hook.
export function useCommandMenu({ commands, draft, enabled, textarea, onChange }: CommandMenuInput) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [index, setIndex] = useState(0);
  const token = /^\/([^\s]*)/u.exec(draft);
  const query = token?.[1]?.toLowerCase() ?? "";
  const matches = commands.filter(
    (command) => command.name.includes(query) || command.description.toLowerCase().includes(query),
  );
  const selected = Math.min(index, Math.max(0, matches.length - 1));
  const open =
    enabled && focused && !dismissed && token !== null && cursor > 0 && cursor <= token[0].length;

  function choose(command: CommandSummary) {
    const prefix = `/${command.name} `;
    onChange(prefix + draft.slice(token?.[0].length ?? 0).trimStart());
    setDismissed(true);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(prefix.length, prefix.length);
    });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: each keyboard action has one explicit selection guard.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    const action = menuAction(event);
    if (!open || action === undefined) return false;
    const command = matches[selected];
    switch (action) {
      case "close":
        setDismissed(true);
        break;
      case "insert":
        if (command === undefined) return false;
        choose(command);
        break;
      case "next":
      case "previous":
        if (command === undefined) return false;
        setIndex((selected + (action === "next" ? 1 : -1) + matches.length) % matches.length);
        break;
    }
    event.preventDefault();
    return true;
  }

  return {
    id,
    open,
    matches,
    selected,
    choose,
    onKeyDown,
    onFocus: () => {
      setFocused(true);
      setDismissed(false);
    },
    onBlur: () => setFocused(false),
    onSelect: (position: number) => setCursor(position),
    onChange: (text: string, position: number) => {
      setDismissed(false);
      setIndex(0);
      setCursor(position);
      onChange(text);
    },
  };
}

export function CommandMenu({ menu }: { menu: ReturnType<typeof useCommandMenu> }) {
  useEffect(() => {
    if (menu.open)
      document.getElementById(`${menu.id}-${menu.selected}`)?.scrollIntoView({ block: "nearest" });
  }, [menu.id, menu.open, menu.selected]);
  if (!menu.open) return null;
  return (
    <div className="command-menu">
      <div className="command-menu-heading">
        <span>Commands</span>
        <span>↑↓ Select · Tab Insert · Esc Close</span>
      </div>
      <div aria-label="Commands" id={menu.id} role="listbox" className="command-menu-list">
        {menu.matches.map((command, index) => (
          <button
            aria-selected={index === menu.selected}
            className="command-menu-option"
            id={`${menu.id}-${index}`}
            key={command.name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => menu.choose(command)}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span className="command-menu-name">/{command.name}</span>
            <span className="command-menu-description">{command.description}</span>
            {index === menu.selected && (
              <span className="command-menu-enter" aria-hidden="true">
                ↵
              </span>
            )}
          </button>
        ))}
      </div>
      {menu.matches.length === 0 && <p className="command-menu-empty">No matching commands</p>}
    </div>
  );
}
