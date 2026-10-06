import type { ErrorCode, Result } from '../electron/preload';

export class BridgeError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Unwraps a main-process result, turning a failure into a thrown BridgeError. */
export async function call<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new BridgeError(result.code, result.message);
  return result.data;
}
