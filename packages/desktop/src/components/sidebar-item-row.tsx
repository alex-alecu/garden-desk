import type { ComponentProps, KeyboardEvent, PointerEvent } from "react";
import { Icon } from "./icons.js";

interface SidebarItemRowProps {
  active?: boolean;
  deleteLabel: string;
  deleteIcon?: ComponentProps<typeof Icon>["name"];
  disabled: boolean;
  nativeActionMessage?: string | undefined;
  expanded?: boolean;
  dragLabel?: string;
  label: string;
  startActionLabel?: string;
  startIcon?: ComponentProps<typeof Icon>["name"];
  onDelete(): void;
  onDragEnd?: (() => void) | undefined;
  onDragKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
  onDragPointerDown?: ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
  onDragPointerMove?: ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
  onDragPointerUp?: ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
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

function DragHandle(props: SidebarItemRowProps) {
  if (props.dragLabel === undefined || props.onDragPointerDown === undefined) return null;
  return (
    <button
      aria-label={props.dragLabel}
      className="sidebar-item-drag"
      disabled={props.disabled}
      onKeyDown={props.onDragKeyDown}
      onPointerCancel={(event) => {
        props.onDragEnd?.();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        props.onDragPointerDown?.(event);
      }}
      onPointerMove={props.onDragPointerMove}
      onPointerUp={(event) => {
        props.onDragPointerUp?.(event);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      title="Drag to reorder; use arrow keys while focused"
      type="button"
    >
      <Icon name="drag" />
    </button>
  );
}

function StartAction(props: SidebarItemRowProps) {
  if (props.startIcon === undefined || props.onStartAction === undefined) return null;
  return (
    <button
      aria-label={props.startActionLabel}
      className="sidebar-item-start"
      disabled={props.disabled || props.nativeActionMessage !== undefined}
      onClick={props.onStartAction}
      title={props.nativeActionMessage}
      type="button"
    >
      <Icon name={props.startIcon} />
    </button>
  );
}

export function SidebarItemRow(props: SidebarItemRowProps) {
  const hasStartAction = props.startIcon !== undefined && props.onStartAction !== undefined;
  const hasDragHandle = props.dragLabel !== undefined && props.onDragPointerDown !== undefined;
  return (
    <div
      className={`sidebar-item-row${hasStartAction ? " sidebar-item-row-with-start" : ""}${hasDragHandle ? " sidebar-item-row-with-drag" : ""}`}
    >
      <DragHandle {...props} />
      <StartAction {...props} />
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
      {props.working ? null : (
        <button
          aria-label={props.deleteLabel}
          className={deleteClassName(props.deleteIcon)}
          disabled={props.disabled || props.nativeActionMessage !== undefined}
          onClick={props.onDelete}
          title={deleteTitle(props)}
          type="button"
        >
          <Icon name={props.deleteIcon ?? "trash"} />
        </button>
      )}
    </div>
  );
}
