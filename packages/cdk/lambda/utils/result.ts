export type Result<T = any, E = any> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, any> => {
  return {
    ok: true,
    value: value,
  };
};

export const Err = <E>(error: E): Result<any, E> => {
  return {
    ok: false,
    error: error,
  };
};
