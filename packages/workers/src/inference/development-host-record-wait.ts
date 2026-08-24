const DEVELOPMENT_HOST_RECORD_WAIT_MS = 250;

export async function waitForDevelopmentHostRecord(
  record: Promise<void>,
  timeoutMilliseconds = DEVELOPMENT_HOST_RECORD_WAIT_MS,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMilliseconds);
      void record.then(resolve, resolve);
    });
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
