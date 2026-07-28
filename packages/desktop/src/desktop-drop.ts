import { type Dispatch, useEffect, useRef } from "react";
import type { DesktopApi, NativeDropEvent } from "./api.js";
import { addDroppedFolders, attachDroppedFiles } from "./desktop-actions.js";
import type { DesktopAction } from "./state.js";

export type DropTarget = "files" | "folders";

interface DropContext {
  activeSessionId: string | undefined;
  draft: string;
  newSessionFolderId: string | null | undefined;
  running: boolean;
}

interface NativeDropOptions {
  api: DesktopApi;
  context: DropContext;
  dispatch: Dispatch<DesktopAction>;
  setDropTarget(target: DropTarget | undefined): void;
  setError(message: string | undefined): void;
}

export function dropTargetAt(x: number, y: number): DropTarget | undefined {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-target]")
    ?.dataset.dropTarget;
  return target === "files" || target === "folders" ? target : undefined;
}

function importDroppedPaths(target: DropTarget, paths: string[], options: NativeDropOptions) {
  if (target === "folders") {
    void addDroppedFolders(options.api, paths, options.dispatch, options.setError);
    return;
  }
  if (options.context.running) return;
  void attachDroppedFiles({
    api: options.api,
    activeSessionId: options.context.activeSessionId,
    newSessionFolderId: options.context.newSessionFolderId,
    dispatch: options.dispatch,
    draft: options.context.draft,
    paths,
    setError: options.setError,
  });
}

function handleNativeDrop(event: NativeDropEvent, options: NativeDropOptions) {
  if (event.type === "leave") {
    options.setDropTarget(undefined);
    return;
  }
  const target = dropTargetAt(event.x, event.y);
  options.setDropTarget(target);
  if (event.type !== "drop" || target === undefined) return;
  options.setDropTarget(undefined);
  importDroppedPaths(target, event.paths, options);
}

interface UseNativeDropOptions extends Omit<NativeDropOptions, "context"> {
  context: DropContext;
  enabled: boolean;
}

export function useNativeDrop(options: UseNativeDropOptions) {
  const { api, dispatch, enabled, setDropTarget, setError } = options;
  const context = useRef(options.context);
  context.current = options.context;
  useEffect(() => {
    if (!enabled || api.listenForDroppedPaths === undefined) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void api
      .listenForDroppedPaths((event) =>
        handleNativeDrop(event, {
          api,
          context: context.current,
          dispatch,
          setDropTarget,
          setError,
        }),
      )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => setError("File and folder drop could not be started."));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [api, dispatch, enabled, setDropTarget, setError]);
}
