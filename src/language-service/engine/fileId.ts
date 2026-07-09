// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The file interner (§2.3): mints a branded `FileId` for each canonical URI so file identity is a cheap
// integer that cannot be confused with any other id, and so every engine map keys on that integer rather
// than re-normalizing strings at each lookup. Ids are monotonic and never reused (pyright's model), so a
// stored `FileId` stays meaningful even after a file is closed and another is opened.

import type { FileId } from "../interfaces.js";
import { normalizeUri } from "./uri.js";

export class FileRegistry {
  private readonly byUri = new Map<string, FileId>();
  private readonly byId = new Map<FileId, string>();
  private next = 0;

  // The stable id for a URI, minting one on first sight. The URI is canonicalized first, so two spellings
  // of the same file intern to the same id.
  public idFor(uri: string): FileId {
    const canonical = normalizeUri(uri);
    const existing = this.byUri.get(canonical);
    if (existing !== undefined) return existing;
    const id = this.next as FileId;
    this.next += 1;
    this.byUri.set(canonical, id);
    this.byId.set(id, canonical);
    return id;
  }

  // The canonical URI an id was minted for, or undefined if the id was never issued by this registry.
  public uriFor(id: FileId): string | undefined {
    return this.byId.get(id);
  }

  // The id for a URI if one was already minted, without minting a new one. Lets a caller ask "is this file
  // known?" without growing the interner.
  public peek(uri: string): FileId | undefined {
    return this.byUri.get(normalizeUri(uri));
  }

  // The number of distinct files interned so far (test/diagnostic aid).
  public size(): number {
    return this.byId.size;
  }
}
