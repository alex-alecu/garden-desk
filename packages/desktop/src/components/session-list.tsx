import type { SessionSummary } from "@gardendesk/shared";
import type { FolderGroup } from "../state.js";
import { Icon } from "./icons.js";
import { SidebarItemRow } from "./sidebar-item-row.js";

interface SessionListProps {
  activeSessionId: string | undefined;
  disabled: boolean;
  folder: FolderGroup;
  workingSessionIds: string[];
  nativeActionMessage?: string | undefined;
  onNewSession(folderId: string | null): void;
  onDeleteSession(session: SessionSummary): void;
  onSelectSession(sessionId: string): void;
  onShowMore(folderId: string): void;
}

export function SessionList(props: SessionListProps) {
  return (
    <div className="session-list">
      <button
        className="new-folder-session"
        disabled={props.disabled}
        onClick={() => props.onNewSession(props.folder.id)}
        type="button"
      >
        <Icon name="message" />
        New conversation
      </button>
      {props.folder.sessions.map((session) => (
        <SidebarItemRow
          active={session.id === props.activeSessionId}
          deleteLabel={`Delete ${session.title}`}
          disabled={props.disabled}
          key={session.id}
          label={session.title}
          working={props.workingSessionIds.includes(session.id)}
          nativeActionMessage={props.nativeActionMessage}
          onDelete={() => props.onDeleteSession(session)}
          onSelect={() => props.onSelectSession(session.id)}
        />
      ))}
      {props.folder.nextCursor === null ? null : (
        <button
          className="show-more"
          disabled={props.disabled}
          onClick={() => props.onShowMore(props.folder.id)}
          type="button"
        >
          Show more
        </button>
      )}
    </div>
  );
}
