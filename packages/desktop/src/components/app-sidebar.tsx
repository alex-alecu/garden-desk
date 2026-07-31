import type { DesktopApi } from "../api.js";
import { deleteSessionConfirmation, revokeFolderConfirmation } from "../confirmations.js";
import {
  addFolder,
  reorderFolders,
  selectSession,
  showFolder,
  showMore,
} from "../desktop-actions.js";
import type { DropIntent } from "../desktop-drop.js";
import type { DesktopAction, DesktopState } from "../state.js";
import type { ConfirmationRequest } from "./confirmation.js";
import { Sidebar } from "./sidebar.js";

interface AppSidebarProps {
  api: DesktopApi;
  dispatch(action: DesktopAction): void;
  dropIntent: DropIntent | undefined;
  nativeActionMessage: string | undefined;
  setConfirmation(request: ConfirmationRequest): void;
  setError(message: string | undefined): void;
  state: DesktopState;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one sidebar wiring boundary; its actions live in desktop-actions and confirmations.
export function AppSidebar({
  api,
  dispatch,
  dropIntent,
  nativeActionMessage,
  setConfirmation,
  setError,
  state,
}: AppSidebarProps) {
  return (
    <Sidebar
      activeSessionId={state.activeSessionId}
      disabled={!state.loaded}
      dropActive={dropIntent === "folders" || dropIntent === "mixed"}
      dispatch={dispatch}
      folders={state.folders}
      globalSessions={state.globalSessions}
      workingSessionIds={state.workingSessionIds}
      nativeActionMessage={nativeActionMessage}
      onAddFolder={() => void addFolder(api, dispatch, setError)}
      onNewSession={(folderId) => dispatch({ type: "session.new", folderId })}
      onOpenFolder={(folderId) => void showFolder(api, folderId, setError)}
      onDeleteSession={(session) =>
        setConfirmation(
          deleteSessionConfirmation({
            api,
            dispatch,
            session,
            setError: setError,
          }),
        )
      }
      onRevokeFolder={(folderId) =>
        setConfirmation(
          revokeFolderConfirmation({
            api,
            dispatch,
            folderId,
            folderName: state.folders.find((folder) => folder.id === folderId)?.name,
            setError: setError,
          }),
        )
      }
      onReorderFolders={(folderIds) => void reorderFolders(api, folderIds, dispatch, setError)}
      onSelectSession={(sessionId) => void selectSession(api, sessionId, dispatch, setError)}
      onShowMore={(folderId) =>
        void showMore({
          api,
          folderId,
          dispatch,
          setError: setError,
          folders: state.folders,
        })
      }
    />
  );
}
