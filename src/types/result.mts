import type { Ok } from './ok.mts';
import type { Err } from './err.mts';

export type Result<T, E = Error> = Ok<T> | Err<E>;
