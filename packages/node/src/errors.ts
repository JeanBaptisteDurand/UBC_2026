/** errors.ts — expected errors: a message (in English) for the person and an exit code, never a stack. */

export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

/** misuse (unknown option, invalid value): exit code 2 */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
  }
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
