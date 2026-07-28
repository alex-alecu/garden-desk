import type { DesktopApi } from "./api.js";
import { retryLocalRequest, waitForAgentRun } from "./run-polling.js";
import type { DesktopAction } from "./state.js";

type Dispatch = (action: DesktopAction) => void;
type SetError = (message: string | undefined) => void;

export async function addFolder(api: DesktopApi, dispatch: Dispatch, setError: SetError) {
  setError(undefined);
  try {
    const folder = await api.chooseFolder();
    if (folder !== undefined) dispatch({ type: "folder.add", folder });
  } catch {
    setError("The selected folder could not be added.");
  }
}

export async function addDroppedFolders(
  api: DesktopApi,
  paths: string[],
  dispatch: Dispatch,
  setError: SetError,
) {
  setError(undefined);
  try {
    for (const folder of await api.addFolders(paths)) {
      dispatch({ type: "folder.add", folder });
    }
  } catch {
    setError("Drop folders on the sidebar to add them.");
  }
}

export async function reorderFolders(
  api: DesktopApi,
  folderIds: string[],
  dispatch: Dispatch,
  setError: SetError,
) {
  setError(undefined);
  try {
    const folders = await api.reorderFolders(folderIds);
    dispatch({ type: "folders.reorder", folderIds: folders.map((folder) => folder.id) });
  } catch {
    setError("The folder order could not be saved.");
  }
}

export async function showFolder(api: DesktopApi, folderId: string, setError: SetError) {
  setError(undefined);
  try {
    await api.openFolder(folderId);
  } catch {
    setError("The folder could not be opened.");
  }
}

interface StartSessionOptions {
  api: DesktopApi;
  dispatch: Dispatch;
  draft?: string;
  folderId: string | null;
  setError: SetError;
}

async function startSession(options: StartSessionOptions) {
  const { api, dispatch, draft, folderId, setError } = options;
  setError(undefined);
  try {
    const session = await api.createSession(folderId);
    dispatch({ type: "session.created", session });
    if (draft !== undefined) dispatch({ type: "draft.change", draft });
    if (folderId !== null) {
      dispatch({ type: "folder.refresh", folderId, page: await api.listSessions(folderId) });
    }
    return session.id;
  } catch {
    setError("The conversation could not be created.");
    return undefined;
  }
}

export async function selectSession(
  api: DesktopApi,
  sessionId: string,
  dispatch: Dispatch,
  setError: SetError,
) {
  setError(undefined);
  dispatch({ type: "session.select", sessionId });
  try {
    const [messages, attachments, draft, runs] = await Promise.all([
      api.listMessages(sessionId),
      api.listAttachments(sessionId),
      api.loadDraft(sessionId),
      api.listAgentRuns(sessionId),
    ]);
    const lastUserMessage = messages.filter((message) => message.role === "user").at(-1);
    dispatch({ type: "messages.load", sessionId, messages });
    dispatch({
      type: "attachments.load",
      sessionId,
      attachments,
      removableIds: attachments
        .filter(
          (item) => lastUserMessage === undefined || item.createdAt > lastUserMessage.createdAt,
        )
        .map((item) => item.id),
    });
    dispatch({ type: "draft.load", sessionId, draft: draft?.content ?? "" });
    for (const snapshot of await Promise.all(runs.map((run) => api.getAgentRun(run.id)))) {
      dispatch({ type: "agent.snapshot", snapshot });
    }
  } catch {
    setError("The conversation could not be loaded.");
  }
}

export async function deleteConversation(
  api: DesktopApi,
  sessionId: string,
  dispatch: Dispatch,
  setError: SetError,
) {
  setError(undefined);
  try {
    if (await api.deleteSession(sessionId)) dispatch({ type: "session.deleted", sessionId });
  } catch {
    setError("Stop the conversation if it is running, then try deleting it again.");
  }
}

interface ShowMoreOptions {
  api: DesktopApi;
  folderId: string;
  cursor: string | null;
  dispatch: Dispatch;
  setError: SetError;
}

export async function showMore(options: ShowMoreOptions) {
  const { api, folderId, cursor, dispatch, setError } = options;
  if (cursor === null) return;
  try {
    const page = await api.listSessions(folderId, cursor);
    dispatch({ type: "folder.page", folderId, page });
  } catch {
    setError("More conversations could not be loaded.");
  }
}

interface SendOptions {
  api: DesktopApi;
  text: string;
  activeSessionId: string | undefined;
  newSessionFolderId: string | null | undefined;
  dispatch: Dispatch;
  setError: SetError;
  setSubmitting(value: boolean): void;
}

export async function send(options: SendOptions) {
  const { api, text, activeSessionId, newSessionFolderId, dispatch, setError, setSubmitting } =
    options;
  setSubmitting(true);
  setError(undefined);
  let started = false;
  try {
    const sessionId =
      activeSessionId ??
      (await startSession({
        api,
        dispatch,
        folderId: newSessionFolderId ?? null,
        setError,
      }));
    if (sessionId === undefined) return;
    const run = await api.startAgent(sessionId, text);
    started = true;
    dispatch({ type: "agent.started", run });
    setSubmitting(false);
    try {
      dispatch({
        type: "messages.load",
        sessionId,
        messages: await retryLocalRequest(() => api.listMessages(sessionId)),
      });
    } catch {
      // The persisted user message is restored with the terminal refresh below.
    }
    await waitForAgentRun({
      runId: run.id,
      read: api.getAgentRun,
      onSnapshot: (snapshot) => dispatch({ type: "agent.snapshot", snapshot }),
    });
    try {
      dispatch({
        type: "messages.load",
        sessionId,
        messages: await retryLocalRequest(() => api.listMessages(sessionId)),
      });
    } catch {
      setError("The task completed. Reopen this chat to restore its response.");
    }
  } catch {
    setError(
      started
        ? "The task status could not be refreshed. Reopen this chat to restore the latest result."
        : "The offline task could not be started.",
    );
  } finally {
    setSubmitting(false);
  }
}

interface AttachOptions {
  api: DesktopApi;
  activeSessionId: string | undefined;
  newSessionFolderId: string | null | undefined;
  dispatch: Dispatch;
  draft: string;
  setError: SetError;
}

export async function attach(options: AttachOptions) {
  const { api, activeSessionId, newSessionFolderId, dispatch, draft, setError } = options;
  const sessionId =
    activeSessionId ??
    (await startSession({ api, dispatch, draft, folderId: newSessionFolderId ?? null, setError }));
  if (sessionId === undefined) return;
  try {
    await retryLocalRequest(() => api.saveDraft(sessionId, draft));
    const attachments = await api.chooseFiles(sessionId);
    if (attachments.length > 0) dispatch({ type: "attachments.add", attachments });
  } catch {
    setError("The selected files could not be attached.");
  }
}

export async function attachDroppedFiles(options: AttachOptions & { paths: string[] }) {
  const { api, activeSessionId, newSessionFolderId, dispatch, draft, setError, paths } = options;
  const sessionId =
    activeSessionId ??
    (await startSession({ api, dispatch, draft, folderId: newSessionFolderId ?? null, setError }));
  if (sessionId === undefined) return;
  try {
    await retryLocalRequest(() => api.saveDraft(sessionId, draft));
    const attachments = await api.addFiles(sessionId, paths);
    if (attachments.length > 0) dispatch({ type: "attachments.add", attachments });
  } catch {
    setError("Drop files on the chat input to attach them.");
  }
}

export async function openAttachment(
  api: DesktopApi,
  sessionId: string,
  attachmentId: string,
  setError: SetError,
) {
  setError(undefined);
  try {
    await api.openAttachment(sessionId, attachmentId);
  } catch {
    setError("The attached file could not be opened.");
  }
}

interface RemoveOptions {
  api: DesktopApi;
  sessionId: string;
  attachmentId: string;
  dispatch: Dispatch;
  setError: SetError;
}

export async function remove(options: RemoveOptions) {
  const { api, sessionId, attachmentId, dispatch, setError } = options;
  setError(undefined);
  try {
    if (await api.removeAttachment(sessionId, attachmentId)) {
      dispatch({ type: "attachment.remove", attachmentId });
    }
  } catch {
    setError("The attached file could not be removed.");
  }
}
