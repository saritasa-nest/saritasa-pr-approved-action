/**
 * Util type to map another object type with nullable properties
 * to same object type with non nullable properties.
 */
export type NonNullableProperties<
  // eslint-disable-next-line @typescript-eslint/ban-types
  T extends Object,
  K extends keyof T,
> = Readonly<
  {
    [k in K]-?: NonNullable<T[k]>;
  } & {
    [k in Exclude<keyof T, K>]: T[k];
  }
>;
