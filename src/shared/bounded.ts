export type BoundedResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'timeout' }
  | { status: 'error'; error: unknown };

/**
 * Resolve an asynchronous Chrome/browser operation within a known time budget
 * without pretending a timeout is a successful empty result. The underlying
 * browser promise is intentionally left alone: browser APIs are not generally
 * cancellable, but callers can distinguish uncertainty from authoritative data.
 */
export async function settleBounded<T>(promise: Promise<T>, timeoutMs: number): Promise<BoundedResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<BoundedResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([
      promise.then<BoundedResult<T>, BoundedResult<T>>(
        (value) => ({ status: 'ok', value }),
        (error) => ({ status: 'error', error })
      ),
      timeout
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = 'Operation'): Promise<T> {
  const result = await settleBounded(promise, timeoutMs);
  if (result.status === 'ok') return result.value;
  if (result.status === 'error') throw result.error;
  throw new Error(`${label} timed out.`);
}
