import type { ComponentProps } from "react";
import { Icon } from "./icons.js";

interface SidebarItemRowProps {
  active?: boolean;
  deleteLabel: string;
  deleteDisabled?: boolean;
  deleteIcon?: ComponentProps<typeof Icon>["name"];
  disabled: boolean;
  nativeActionMessage?: string | undefined;
  expanded?: boolean;
  label: string;
  startActionLabel?: string;
  startIcon?: ComponentProps<typeof Icon>["name"];
  onDelete(): void;
  onSelect(): void;
  onStartAction?(): void;
  working?: boolean;
}

function deleteClassName(icon: SidebarItemRowProps["deleteIcon"]): string {
  return icon === "unmount" ? "sidebar-item-delete sidebar-item-unmount" : "sidebar-item-delete";
}

function deleteTitle(props: SidebarItemRowProps): string | undefined {
  return props.nativeActionMessage ?? props.deleteLabel;
}

export function SidebarItemRow(props: SidebarItemRowProps) {
  const hasStartAction = props.startIcon !== undefined && props.onStartAction !== undefined;
  return (
    <div className={`sidebar-item-row${hasStartAction ? " sidebar-item-row-with-start" : ""}`}>
      {hasStartAction ? (
        <button
          aria-label={props.startActionLabel}
          className="sidebar-item-start"
          disabled={props.disabled || props.nativeActionMessage !== undefined}
          onClick={props.onStartAction}
          title={props.nativeActionMessage}
          type="button"
        >
          <Icon name={props.startIcon ?? "folder"} />
        </button>
      ) : null}
      <button
        aria-current={props.active ? "page" : undefined}
        aria-expanded={props.expanded}
        className={`sidebar-item-select${props.working ? " sidebar-item-working" : ""}`}
        disabled={props.disabled}
        onClick={props.onSelect}
        type="button"
      >
        <span title={props.label}>{props.label}</span>
        {props.working ? (
          <i aria-label="Working" className="sidebar-working-indicator" role="status" />
        ) : null}
      </button>
      <button
        aria-label={props.deleteLabel}
        className={deleteClassName(props.deleteIcon)}
        disabled={props.disabled || props.deleteDisabled || props.nativeActionMessage !== undefined}
        onClick={props.onDelete}
        title={deleteTitle(props)}
        type="button"
      >
        <Icon name={props.deleteIcon ?? "trash"} />
      </button>
    </div>
  );
}
