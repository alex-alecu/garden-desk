import { useEffect, useRef } from "react";
import type { DesktopApi } from "./api.js";
import { retryLocalRequest } from "./run-polling.js";

export function useDraftPersistence(
  api: DesktopApi,
  setError: (message: string | undefined) => void,
) {
  const timer = useRef<number | undefined>(undefined);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current += 1;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );
  const cancel = () => {
    sequence.current += 1;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const schedule = (sessionId: string | undefined, draft: string) => {
    cancel();
    if (sessionId === undefined) return;
    const request = sequence.current;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void retryLocalRequest(() => api.saveDraft(sessionId, draft)).catch(() => {
        if (sequence.current === request) setError("The draft could not be saved.");
      });
    }, 250);
  };
  return { cancel, schedule };
}
