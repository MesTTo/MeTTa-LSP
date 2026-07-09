/**
 * Optional @metta-ts integration point.
 *
 * Static analysis paths are read-only. Explicit guarded evaluation is implemented
 * in guardedEvaluation.ts through an isolated worker; this adapter only
 * introspects package availability.
 */
export interface MettaTsPackageStatus {
  readonly coreAvailable: boolean;
  readonly exportedSymbols: readonly string[];
  readonly error?: string;
}

export async function inspectMettaTsCore(): Promise<MettaTsPackageStatus> {
  try {
    const mod = await import("@metta-ts/core");
    return { coreAvailable: true, exportedSymbols: Object.keys(mod).sort() };
  } catch (error) {
    return {
      coreAvailable: false,
      exportedSymbols: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
