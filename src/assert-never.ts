/**
 * Makes a missing case in a `switch` a compile error the moment a variant is added. It
 * throws rather than returning a value, because reaching it means the union and the code
 * that reads it have already gone out of step — a programmer error, not a domain failure.
 */
export function assertNever(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`)
}
