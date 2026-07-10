// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ClientCapabilities } from "vscode-languageserver-protocol";
import { configurationClientSupport } from "../shared/clientCapabilities.js";

describe("configurationClientSupport", () => {
  const cases: readonly {
    readonly name: string;
    readonly capabilities: ClientCapabilities;
    readonly expected: ReturnType<typeof configurationClientSupport>;
  }[] = [
    {
      name: "supports neither configuration mechanism when workspace capabilities are absent",
      capabilities: {},
      expected: { pull: false, dynamicRegistration: false },
    },
    {
      name: "keeps Eglot configuration pulls independent from dynamic registration",
      capabilities: { workspace: { configuration: true } },
      expected: { pull: true, dynamicRegistration: false },
    },
    {
      name: "supports dynamic registration without configuration pulls",
      capabilities: {
        workspace: { didChangeConfiguration: { dynamicRegistration: true } },
      },
      expected: { pull: false, dynamicRegistration: true },
    },
    {
      name: "supports both capabilities when the client advertises both",
      capabilities: {
        workspace: {
          configuration: true,
          didChangeConfiguration: { dynamicRegistration: true },
        },
      },
      expected: { pull: true, dynamicRegistration: true },
    },
  ];

  it.each(cases)("$name", ({ capabilities, expected }) => {
    expect(configurationClientSupport(capabilities)).toStrictEqual(expected);
  });
});
