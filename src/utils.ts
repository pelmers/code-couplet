export function getErrorMessage(e: unknown): string {
  if ((e as Error).message != null) {
    return (e as Error).message;
  }
  return "unknown error";
}
