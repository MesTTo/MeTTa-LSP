// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// MCP clients in the wild use either newline-delimited JSON or LSP-style Content-Length frames over stdio.
// This reader keeps one byte buffer and chooses the parser by the buffer prefix, so split frames never leak
// into the newline parser.

const CONTENT_LENGTH = "content-length:";
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024;

export interface StdioJsonReaderOptions {
  readonly onMessage: (body: string) => void;
  readonly onProtocolError: (message: string) => void;
  readonly maxContentLength?: number;
}

function startsWithContentLength(buffer: Buffer): boolean {
  const prefix = buffer
    .subarray(0, Math.min(buffer.length, CONTENT_LENGTH.length))
    .toString("ascii");
  return CONTENT_LENGTH.startsWith(prefix.toLowerCase());
}

export class StdioJsonReader {
  private buffer = Buffer.alloc(0);
  private readonly maxContentLength: number;

  public constructor(private readonly options: StdioJsonReaderOptions) {
    this.maxContentLength = options.maxContentLength ?? MAX_CONTENT_LENGTH;
  }

  public push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length === 0) return;
      if (startsWithContentLength(this.buffer)) {
        if (!this.processContentLengthFrame()) return;
      } else if (!this.processLine()) {
        return;
      }
    }
  }

  private processContentLengthFrame(): boolean {
    const sep = this.buffer.indexOf("\r\n\r\n");
    if (sep < 0) return false;
    const header = this.buffer.subarray(0, sep).toString("ascii");
    const match = /^Content-Length:\s*(\d+)(?:\r\n.*)?$/is.exec(header);
    if (match === null) {
      this.buffer = Buffer.alloc(0);
      this.options.onProtocolError("Invalid Content-Length framing.");
      return false;
    }
    const length = Number(match[1]);
    if (!Number.isSafeInteger(length) || length < 0 || length > this.maxContentLength) {
      this.buffer = Buffer.alloc(0);
      this.options.onProtocolError("Invalid or oversized Content-Length.");
      return false;
    }
    const bodyStart = sep + 4;
    const bodyEnd = bodyStart + length;
    if (this.buffer.length < bodyEnd) return false;
    const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    this.buffer = this.buffer.subarray(bodyEnd);
    this.options.onMessage(body);
    return true;
  }

  private processLine(): boolean {
    const newline = this.buffer.indexOf("\n");
    if (newline < 0) return false;
    const line = this.buffer.subarray(0, newline).toString("utf8").trim();
    this.buffer = this.buffer.subarray(newline + 1);
    if (line.length > 0) this.options.onMessage(line);
    return true;
  }
}
