import type { SessionSummary } from "@vault/shared";
import type { Dispatch } from "react";
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

function FolderSection(props: SidebarProps) {
  if (props.folders.length === 0) {
    return <p className="sidebar-empty">Add a folder to start a group of private sessions.</p>;
  }
  return props.folders.map((folder) => (
    <section className="folder-group" key={folder.id}>
      <SidebarItemRow
        deleteLabel={`Remove ${folder.name}`}
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
  return (
    <aside className="sidebar">
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
    </aside>
  );
}
