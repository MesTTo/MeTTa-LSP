declare module "@metta-ts/edsl" {
  export interface MettaDb {
    add(source: unknown): void;
    q<T = unknown>(source: string): T[];
    run(source: string): Promise<unknown[]>;
  }

  export function mettaDB(): MettaDb;
  export function m(strings: TemplateStringsArray, ...values: readonly unknown[]): unknown;
  export function mAll(strings: TemplateStringsArray, ...values: readonly unknown[]): unknown[];
  export function parseSource(source: string): unknown;
}
