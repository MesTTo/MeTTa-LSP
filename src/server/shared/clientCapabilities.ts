import type { ClientCapabilities } from "vscode-languageserver-protocol";

export interface ConfigurationClientSupport {
  readonly pull: boolean;
  readonly dynamicRegistration: boolean;
}

export function configurationClientSupport(
  capabilities: ClientCapabilities,
): ConfigurationClientSupport {
  return {
    pull: capabilities.workspace?.configuration === true,
    dynamicRegistration:
      capabilities.workspace?.didChangeConfiguration?.dynamicRegistration === true,
  };
}
