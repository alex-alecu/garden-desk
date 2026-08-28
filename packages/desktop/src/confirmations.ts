import type { DesktopApi } from "./api.js";
import { deleteConversation } from "./desktop-actions.js";
import type { DesktopAction } from "./state.js";

type Dispatch = (action: DesktopAction) => void;
type SetError = (message: string | undefined) => void;

interface RevokeFolderConfirmation {
  api: DesktopApi;
  dispatch: Dispatch;
  folderId: string;
  folderName: string | undefined;
  setError: SetError;
}

export function revokeFolderConfirmation(request: RevokeFolderConfirmation) {
  const { api, dispatch, folderId, folderName, setError } = request;
  return {
    title: `Unmount “${folderName ?? "this folder"}”?`,
    description:
      "Garden Desk will unmount this folder and remove its access grant. Files on your computer and existing conversation history are not deleted.",
    confirmLabel: "Unmount folder",
    onConfirm: () => {
      void api
        .revokeFolder(folderId)
        .then((revoked) => {
          if (revoked) dispatch({ type: "folder.revoked", folderId });
        })
        .catch(() => setError("The folder could not be unmounted."));
    },
  };
}

interface DeleteSessionConfirmation {
  api: DesktopApi;
  dispatch: Dispatch;
  session: { id: string; title: string };
  setError: SetError;
}

export function deleteSessionConfirmation(request: DeleteSessionConfirmation) {
  const { api, dispatch, session, setError } = request;
  return {
    title: `Delete “${session.title}”?`,
    description:
      "This permanently removes the conversation, its activity, and its generated-file records. This cannot be undone.",
    confirmLabel: "Delete conversation",
    onConfirm: () => void deleteConversation(api, session.id, dispatch, setError),
  };
}
