/**
 * Result type inspired by Rust's Result<T, E>
 * Forces explicit error handling at compile time
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Err<E> {
  ok: false;
  error: E;
}

// Constructor functions
export const Ok = <T>(value: T): Ok<T> => ({
  ok: true,
  value
});

export const Err = <E>(error: E): Err<E> => ({
  ok: false,
  error
});

// Type guards
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;