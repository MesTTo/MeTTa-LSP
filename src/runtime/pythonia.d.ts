// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// pythonia ships no TypeScript types; this declares the slice the unguarded worker consumes — the
// `python` import function with its `exit`, the exact PythoniaLike shape @metta-ts/py's bridge takes.
declare module "pythonia" {
  import type { PythoniaLike } from "@metta-ts/py/pythonia";
  export const python: PythoniaLike;
}
