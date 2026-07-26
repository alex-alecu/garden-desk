import type { SessionSummary } from "@vault/shared";
import {
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  useRef,
  useState,
} from "react";
import type { DesktopAction, FolderGroup } from "../state.js";
import { Icon } from "./icons.js";
import { SessionList } from "./session-list.js";
import { SidebarItemRow } from "./sidebar-item-row.js";

interface SidebarProps {
  activeSessionId: string | undefined;
  disabled: boolean;
  dispatch: Dispatch<DesktopAction>;
  folders: FolderGroup[];
  globalSessions: SessionSummary[];
  workingSessionIds: string[];
  nativeActionMessage?: string | undefined;
  onAddFolder(): void;
  onNewSession(folderId: string | null): void;
  onOpenFolder(folderId: string): void;
  onDeleteSession(session: SessionSummary): void;
  onRevokeFolder(folderId: string): void;
  onSelectSession(sessionId: string): void;
  onShowMore(folderId: string): void;
}

const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_DEFAULT_WIDTH = 244;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function useSidebarResize() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const drag = useRef<{ pointerId: number; startWidth: number; startX: number } | undefined>(
    undefined,
  );
  const begin = (event: PointerEvent<HTMLHRElement>) => {
    event.preventDefault();
    drag.current = { pointerId: event.pointerId, startWidth: width, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    setWidth(clampSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX));
  };
  const end = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setWidth((current) => clampSidebarWidth(current + (event.key === "ArrowLeft" ? -16 : 16)));
  };
  return { begin, end, keyDown, move, width };
}

function SidebarResizeHandle({ resize }: { resize: ReturnType<typeof useSidebarResize> }) {
  return (
    <hr
      aria-label="Resize navigation sidebar"
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuenow={resize.width}
      className="sidebar-resize-handle"
      onKeyDown={resize.keyDown}
      onPointerCancel={resize.end}
      onPointerDown={resize.begin}
      onPointerMove={resize.move}
      onPointerUp={resize.end}
      tabIndex={0}
    />
  );
}

function FolderSection(props: SidebarProps) {
  if (props.folders.length === 0) {
    return <p className="sidebar-empty">Add a folder to start a group of private sessions.</p>;
  }
  return props.folders.map((folder) => (
    <section className="folder-group" key={folder.id}>
      <SidebarItemRow
        deleteIcon="unmount"
        deleteLabel={`Unmount ${folder.name}`}
        disabled={props.disabled}
        expanded={folder.expanded}
        label={folder.name}
        nativeActionMessage={props.nativeActionMessage}
        onDelete={() => props.onRevokeFolder(folder.id)}
        onSelect={() => props.dispatch({ type: "folder.toggle", folderId: folder.id })}
        onStartAction={() => props.onOpenFolder(folder.id)}
        startActionLabel={`Open ${folder.name} folder`}
        startIcon="folder"
      />
      {folder.expanded ? (
        <SessionList
          activeSessionId={props.activeSessionId}
          disabled={props.disabled}
          folder={folder}
          workingSessionIds={props.workingSessionIds}
          nativeActionMessage={props.nativeActionMessage}
          onNewSession={props.onNewSession}
          onDeleteSession={props.onDeleteSession}
          onSelectSession={props.onSelectSession}
          onShowMore={props.onShowMore}
        />
      ) : null}
    </section>
  ));
}

export function Sidebar(props: SidebarProps) {
  const resize = useSidebarResize();
  return (
    <aside className="sidebar" style={{ "--sidebar-width": `${resize.width}px` } as CSSProperties}>
      <div aria-hidden="true" className="window-drag-region" data-tauri-drag-region="" />
      <div className="brand">Vault Desk</div>
      <div className="sidebar-content">
        <h2 className="sidebar-label">Chats</h2>
        <button
          className="nav-action"
          disabled={props.disabled}
          onClick={() => props.onNewSession(null)}
          type="button"
        >
          <Icon name="message" />
          New chat
        </button>
        <div className="session-list global-session-list">
          {props.globalSessions.map((session) => (
            <SidebarItemRow
              active={session.id === props.activeSessionId}
              deleteLabel={`Delete ${session.title}`}
              deleteDisabled={props.workingSessionIds.includes(session.id)}
              disabled={props.disabled}
              key={session.id}
              label={session.title}
              working={props.workingSessionIds.includes(session.id)}
              nativeActionMessage={props.nativeActionMessage}
              onDelete={() => props.onDeleteSession(session)}
              onSelect={() => props.onSelectSession(session.id)}
            />
          ))}
        </div>
        <h2 className="sidebar-label">Folders</h2>
        <button
          className="nav-action"
          disabled={props.disabled || props.nativeActionMessage !== undefined}
          onClick={props.onAddFolder}
          title={props.nativeActionMessage}
          type="button"
        >
          <Icon name="add" />
          Add folder
        </button>
        {props.nativeActionMessage === undefined ? null : (
          <p className="demo-unavailable-note">{props.nativeActionMessage}</p>
        )}
        <div className="folder-scroll">
          <FolderSection {...props} />
        </div>
      </div>
      <SidebarResizeHandle resize={resize} />
    </aside>
  );
}
