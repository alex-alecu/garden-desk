import { type Dispatch, type MutableRefObject, useEffect, useRef } from "react";
import type { DesktopApi, DroppedPaths, NativeDropEvent } from "./api.js";
import { addDroppedFolders, attachDroppedFiles } from "./desktop-actions.js";
import type { DesktopAction } from "./state.js";

export type DropIntent = "checking" | "files" | "folders" | "mixed";

interface DropContext {
  activeSessionId: string | undefined;
  draft: string;
  newSessionFolderId: string | null | undefined;
  running: boolean;
}

export interface NativeDropOptions {
  api: DesktopApi;
  context: DropContext;
  dispatch: Dispatch<DesktopAction>;
  setDropIntent(intent: DropIntent | undefined): void;
  setError(message: string | undefined): void;
}

export function intentForDroppedPaths(paths: DroppedPaths): DropIntent | undefined {
  if (paths.files.length > 0 && paths.folders.length > 0) return "mixed";
  if (paths.files.length > 0) return "files";
  if (paths.folders.length > 0) return "folders";
  return undefined;
}

async function importDroppedPaths(paths: DroppedPaths, options: NativeDropOptions) {
  const imports: Promise<void>[] = [];
  if (paths.folders.length > 0) {
    imports.push(addDroppedFolders(options.api, paths.folders, options.dispatch, options.setError));
  }
  if (paths.files.length > 0 && !options.context.running) {
    imports.push(
      attachDroppedFiles({
        api: options.api,
        activeSessionId: options.context.activeSessionId,
        newSessionFolderId: options.context.newSessionFolderId,
        dispatch: options.dispatch,
        draft: options.context.draft,
        paths: paths.files,
        setError: options.setError,
      }),
    );
  }
  await Promise.all(imports);
}

interface UseNativeDropOptions extends NativeDropOptions {
  enabled: boolean;
}

async function classifyHover(
  paths: string[],
  options: NativeDropOptions,
  sequence: MutableRefObject<number>,
): Promise<void> {
  const request = ++sequence.current;
  options.setDropIntent("checking");
  try {
    const classified = await options.api.classifyDroppedPaths(paths);
    if (sequence.current === request) options.setDropIntent(intentForDroppedPaths(classified));
  } catch {
    if (sequence.current === request) options.setDropIntent(undefined);
  }
}

export async function handleNativeDrop(
  event: NativeDropEvent,
  options: NativeDropOptions,
  sequence: MutableRefObject<number>,
): Promise<void> {
  if (event.type === "over") return;
  if (event.type === "leave") {
    sequence.current += 1;
    options.setDropIntent(undefined);
    return;
  }
  if (event.type === "enter") {
    await classifyHover(event.paths, options, sequence);
    return;
  }
  sequence.current += 1;
  options.setDropIntent(undefined);
  try {
    await importDroppedPaths(await options.api.classifyDroppedPaths(event.paths), options);
  } catch {
    options.setError("The dropped files or folders could not be read.");
  }
}

export function useNativeDrop(options: UseNativeDropOptions) {
  const { api, dispatch, enabled, setDropIntent, setError } = options;
  const context = useRef(options.context);
  const sequence = useRef(0);
  context.current = options.context;
  useEffect(() => {
    if (!enabled || api.listenForDroppedPaths === undefined) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handle = (event: NativeDropEvent) => {
      void handleNativeDrop(
        event,
        { api, context: context.current, dispatch, setDropIntent, setError },
        sequence,
      );
    };
    void api
      .listenForDroppedPaths(handle)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => setError("File and folder drop could not be started."));
    return () => {
      disposed = true;
      sequence.current += 1;
      unlisten?.();
    };
  }, [api, dispatch, enabled, setDropIntent, setError]);
}
