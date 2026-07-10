// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

export const BROWSER_WORKSPACE_ROOT = "file:///metta-browser-workspace";
export const BROWSER_WORKSPACE_STORAGE_KEY = "metta-lsp.browser-ide.v1";
export const MAX_BROWSER_FILES = 24;
export const MAX_BROWSER_FILE_CHARS = 128 * 1024;
export const MAX_BROWSER_WORKSPACE_CHARS = 512 * 1024;

export interface BrowserFileSnapshot {
  readonly name: string;
  readonly text: string;
}

export interface BrowserWorkspaceSnapshot {
  readonly version: 1;
  readonly activeName: string;
  readonly files: readonly BrowserFileSnapshot[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_BROWSER_FILES: readonly BrowserFileSnapshot[] = [
  {
    name: "main.metta",
    text: `!(import! &self "math.metta")

(: answer (-> Number))
(= (answer) (double 21))
!(answer)

; The extra argument produces a live LSP diagnostic.
(: broken (-> Number))
(= (broken) (double 10 20))`,
  },
  {
    name: "math.metta",
    text: `(: double (-> Number Number))
(= (double $x) (* $x 2))

(: square (-> Number Number))
(= (square $x) (* $x $x))`,
  },
  {
    name: "facts.metta",
    text: `(parent Tom Bob)
(parent Tom Liz)

!(match &self (parent Tom $child) $child)`,
  },
];

function decodedFileName(uri: string): string | null {
  const prefix = `${BROWSER_WORKSPACE_ROOT}/`;
  if (!uri.startsWith(prefix)) return null;
  try {
    return uri
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

export function browserFileUri(name: string): string {
  return `${BROWSER_WORKSPACE_ROOT}/${name
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function browserFileName(uri: string): string | null {
  return decodedFileName(uri);
}

export function normalizeBrowserFileName(input: string): string {
  let name = input.trim().replaceAll("\\", "/");
  if (name !== "" && !name.includes(".", name.lastIndexOf("/") + 1)) name += ".metta";
  if (name.length === 0 || name.length > 96) throw new Error("Use a file name up to 96 characters.");
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    throw new Error("Use a relative file name.");
  }
  const segments = name.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "." || segment === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment),
    )
  ) {
    throw new Error("Use letters, numbers, dots, underscores, dashes, and optional folders.");
  }
  if (!name.endsWith(".metta")) throw new Error("Browser IDE files must end in .metta.");
  return name;
}

function validateText(text: string): void {
  validateTextLength(text.length);
}

function validateTextLength(length: number): void {
  if (length > MAX_BROWSER_FILE_CHARS) {
    throw new Error(`A browser file cannot exceed ${MAX_BROWSER_FILE_CHARS} characters.`);
  }
}

export class BrowserFileStore {
  private readonly files = new Map<string, string>();

  public constructor(
    initial: readonly BrowserFileSnapshot[] = DEFAULT_BROWSER_FILES,
    ensureFile = true,
  ) {
    for (const file of initial) this.create(file.name, file.text);
    if (ensureFile && this.files.size === 0) this.create("main.metta", "");
  }

  public names(): readonly string[] {
    return [...this.files.keys()];
  }

  public snapshots(): readonly BrowserFileSnapshot[] {
    return [...this.files].map(([name, text]) => ({ name, text }));
  }

  public has(name: string): boolean {
    return this.files.has(name);
  }

  public hasCaseInsensitive(name: string, except?: string): boolean {
    const folded = name.toLocaleLowerCase("en-US");
    return this.names().some(
      (candidate) => candidate !== except && candidate.toLocaleLowerCase("en-US") === folded,
    );
  }

  public get(name: string): string {
    const text = this.files.get(name);
    if (text === undefined) throw new Error(`Unknown browser file: ${name}`);
    return text;
  }

  public getByUri(uri: string): string | null {
    const name = browserFileName(uri);
    return name === null ? null : (this.files.get(name) ?? null);
  }

  public create(inputName: string, text = ""): string {
    const name = normalizeBrowserFileName(inputName);
    if (this.files.size >= MAX_BROWSER_FILES) {
      throw new Error(`The browser workspace is limited to ${MAX_BROWSER_FILES} files.`);
    }
    if (this.hasCaseInsensitive(name)) throw new Error(`${name} already exists.`);
    validateText(text);
    this.assertWorkspaceSize(text.length);
    this.files.set(name, text);
    return name;
  }

  public update(name: string, text: string): void {
    this.validateUpdateLength(name, text.length);
    this.files.set(name, text);
  }

  public validateUpdateLength(name: string, length: number): void {
    const previous = this.get(name);
    validateTextLength(length);
    this.assertWorkspaceSize(length - previous.length);
  }

  public rename(currentName: string, inputName: string): string {
    const text = this.get(currentName);
    const nextName = normalizeBrowserFileName(inputName);
    if (this.hasCaseInsensitive(nextName, currentName)) throw new Error(`${nextName} already exists.`);
    if (nextName === currentName) return currentName;
    const entries = [...this.files];
    this.files.clear();
    for (const [name, value] of entries) {
      this.files.set(name === currentName ? nextName : name, value);
    }
    return nextName;
  }

  public delete(name: string): void {
    if (!this.files.has(name)) throw new Error(`Unknown browser file: ${name}`);
    if (this.files.size === 1) throw new Error("The browser workspace needs at least one file.");
    this.files.delete(name);
  }

  private assertWorkspaceSize(delta: number): void {
    const nextSize = this.snapshots().reduce((sum, file) => sum + file.text.length, 0) + delta;
    if (nextSize > MAX_BROWSER_WORKSPACE_CHARS) {
      throw new Error(`The browser workspace cannot exceed ${MAX_BROWSER_WORKSPACE_CHARS} characters.`);
    }
  }
}

function parseStoredSnapshot(raw: string): BrowserWorkspaceSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<BrowserWorkspaceSnapshot>;
  if (candidate.version !== 1 || typeof candidate.activeName !== "string") return null;
  if (!Array.isArray(candidate.files) || candidate.files.length === 0) return null;
  try {
    const store = new BrowserFileStore([], false);
    for (const file of candidate.files) {
      if (typeof file !== "object" || file === null) return null;
      const entry = file as Partial<BrowserFileSnapshot>;
      if (typeof entry.name !== "string" || typeof entry.text !== "string") return null;
      store.create(entry.name, entry.text);
    }
    if (!store.has(candidate.activeName)) return null;
    return { version: 1, activeName: candidate.activeName, files: store.snapshots() };
  } catch {
    return null;
  }
}

export function loadBrowserWorkspace(storage: StorageLike): BrowserWorkspaceSnapshot | null {
  try {
    const raw = storage.getItem(BROWSER_WORKSPACE_STORAGE_KEY);
    return raw === null ? null : parseStoredSnapshot(raw);
  } catch {
    return null;
  }
}

export function saveBrowserWorkspace(
  storage: StorageLike,
  store: BrowserFileStore,
  activeName: string,
): void {
  try {
    const snapshot: BrowserWorkspaceSnapshot = {
      version: 1,
      activeName,
      files: store.snapshots(),
    };
    storage.setItem(BROWSER_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Persistence is optional. Private browsing and storage quotas must not disable the IDE.
  }
}
