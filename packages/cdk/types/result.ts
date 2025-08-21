export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, Error> => {
  return {
    ok: true,
    value: value,
  };
};

export const Err = <E = Error>(error: E): Result<any, E> => {
  return {
    ok: false,
    error: error as E,
  };
};
