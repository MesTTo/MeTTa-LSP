// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Browser-backed workspace storage for the analyzer. The LSP worker cannot read an editor workspace itself,
// so the browser client answers file requests and this provider stores those files under stable internal
// paths. Non-file URI schemes keep working because imports resolve through the cached path and map back to
// the original URI.

import * as path from "pathe";
import { URI } from "vscode-uri";
import { pathToUri, uriToPath } from "../language-service/index.js";
import { InMemoryFileProvider } from "./fileProvider.js";

function pathForUri(uri: string): string | null {
  if (uri.startsWith("file://")) return uriToPath(uri);
  try {
    const parsed = URI.parse(uri);
    const authority = parsed.authority ? `/${parsed.authority}` : "";
    const uriPath = parsed.path.startsWith("/") ? parsed.path : `/${parsed.path}`;
    return path.normalize(`/${parsed.scheme}${authority}${uriPath}`);
  } catch {
    return null;
  }
}

export class BrowserFileProvider extends InMemoryFileProvider {
  private readonly pathsByUri = new Map<string, string>();
  private readonly urisByPath = new Map<string, string>();

  public cacheFile(uri: string, text: string): string | null {
    const fsPath = pathForUri(uri);
    if (fsPath === null) return null;
    const normalizedPath = path.normalize(fsPath);
    this.pathsByUri.set(uri, normalizedPath);
    this.urisByPath.set(normalizedPath, uri);
    this.writeFile(normalizedPath, text);
    return normalizedPath;
  }

  public deleteUri(uri: string): void {
    const fsPath = this.uriToPath(uri);
    if (fsPath === null) return;
    this.deleteFile(fsPath);
    this.pathsByUri.delete(uri);
    this.urisByPath.delete(path.normalize(fsPath));
  }

  public uriToPath(uri: string): string | null {
    return this.pathsByUri.get(uri) ?? pathForUri(uri);
  }

  public pathToUri(fsPath: string): string {
    const normalizedPath = path.normalize(fsPath);
    return this.urisByPath.get(normalizedPath) ?? pathToUri(normalizedPath);
  }
}
