// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { StdioJsonReader } from "../stdioFraming.js";

function frame(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

describe("StdioJsonReader", () => {
  it("buffers split Content-Length frames without emitting newline garbage", () => {
    const bodies: string[] = [];
    const errors: string[] = [];
    const reader = new StdioJsonReader({
      onMessage: (body) => bodies.push(body),
      onProtocolError: (message) => errors.push(message),
    });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const encoded = frame(body);

    reader.push(Buffer.from(encoded.slice(0, 25)));
    expect(bodies).toStrictEqual([]);
    reader.push(Buffer.from(encoded.slice(25)));

    expect(bodies).toStrictEqual([body]);
    expect(errors).toStrictEqual([]);
  });

  it("reassembles arbitrary byte chunks for Unicode payloads", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.array(fc.integer({ min: 1, max: 16 }), { maxLength: 20 }),
        (value, chunkSizes) => {
          const body = JSON.stringify({ jsonrpc: "2.0", id: 1, value });
          const encoded = Buffer.from(frame(body));
          const bodies: string[] = [];
          const errors: string[] = [];
          const reader = new StdioJsonReader({
            onMessage: (message) => bodies.push(message),
            onProtocolError: (message) => errors.push(message),
          });
          let offset = 0;
          for (const chunkSize of chunkSizes) {
            if (offset >= encoded.length) break;
            reader.push(encoded.subarray(offset, offset + chunkSize));
            offset += chunkSize;
          }
          if (offset < encoded.length) reader.push(encoded.subarray(offset));

          expect(bodies).toStrictEqual([body]);
          expect(errors).toStrictEqual([]);
        },
      ),
      { numRuns: 250 },
    );
  });

  it("still accepts newline-delimited JSON", () => {
    const bodies: string[] = [];
    const reader = new StdioJsonReader({
      onMessage: (body) => bodies.push(body),
      onProtocolError: () => undefined,
    });

    reader.push(Buffer.from('{"jsonrpc":"2.0","method":"ping"}\n'));

    expect(bodies).toStrictEqual(['{"jsonrpc":"2.0","method":"ping"}']);
  });
});
