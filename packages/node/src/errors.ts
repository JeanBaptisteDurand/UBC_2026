/** errors.ts — erreurs attendues : un message (en anglais) pour l'humain et un code de sortie, jamais une pile. */

export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

/** mauvaise utilisation (option inconnue, valeur invalide) : code de sortie 2 */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
  }
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
