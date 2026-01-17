type Either<T, U> =
  | { IsSuccess: true; Value: T }
  | { IsSuccess: false; Error: U };
