import { MeTTa } from "@metta-ts/hyperon";

/** Larger of two numbers, registered as the MeTTa operation `my-max`. */
export function myMax(a: number, b: number): number {
  return a > b ? a : b;
}

const metta = new MeTTa();
// @ts-expect-error // reason: the bridge demo preserves myMax's concrete TypeScript signature at the registration site.
metta.registerOperation("my-max", myMax);
