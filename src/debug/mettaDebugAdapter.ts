// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A Debug Adapter Protocol server for stepping through a MeTTa query's reduction. VS Code launches it as a
// separate process; it wraps the runtime's `ReductionSession` (one rewrite per `next`, `continue` runs to a
// `(breakpoint! ...)` atom or the normal form) and reports the current expression as the single stack frame.
// The reduction stepping is verified by the runtime tests; a scripted DAP client smoke exercises this glue.

import * as fs from "node:fs";
import {
  DebugSession,
  InitializedEvent,
  OutputEvent,
  Scope,
  StackFrame,
  StoppedEvent,
  TerminatedEvent,
  Thread,
} from "@vscode/debugadapter";
import type { DebugProtocol } from "@vscode/debugprotocol";
import { createReductionSession, type ReductionSession } from "../runtime/debugSession.js";

interface LaunchArguments extends DebugProtocol.LaunchRequestArguments {
  readonly program: string;
  readonly query: string;
  // Resolved imports (module name -> source), passed by the client so a cross-file query debugs against them.
  // The adapter cannot resolve them itself: it must not depend on the server layer.
  readonly imports?: Readonly<Record<string, string>>;
}

const THREAD_ID = 1;

class MettaDebugSession extends DebugSession {
  private session: ReductionSession | undefined;

  protected override initializeRequest(response: DebugProtocol.InitializeResponse): void {
    response.body = response.body ?? {};
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsStepInTargetsRequest = false;
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected override launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: LaunchArguments,
  ): void {
    let source: string;
    try {
      source = fs.readFileSync(args.program, "utf8");
    } catch {
      source = "";
    }
    void createReductionSession(source, args.query, args.imports ?? {})
      .then((session) => {
        this.session = session;
        this.sendResponse(response);
        this.reportStop("entry");
      })
      .catch((error: unknown) => {
        this.sendErrorResponse(
          response,
          1001,
          error instanceof Error ? error.message : String(error),
        );
      });
  }

  protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = { threads: [new Thread(THREAD_ID, "reduction")] };
    this.sendResponse(response);
  }

  protected override stackTraceRequest(response: DebugProtocol.StackTraceResponse): void {
    const expression = this.session?.state().expression ?? "<no reduction>";
    response.body = { stackFrames: [new StackFrame(1, expression)], totalFrames: 1 };
    this.sendResponse(response);
  }

  protected override scopesRequest(response: DebugProtocol.ScopesResponse): void {
    response.body = { scopes: [new Scope("Reduction", 1, false)] };
    this.sendResponse(response);
  }

  protected override variablesRequest(response: DebugProtocol.VariablesResponse): void {
    const state = this.session?.state();
    response.body = {
      variables: [
        { name: "expression", value: state?.expression ?? "", variablesReference: 0 },
        { name: "step", value: String(state?.step ?? 0), variablesReference: 0 },
      ],
    };
    this.sendResponse(response);
  }

  protected override nextRequest(response: DebugProtocol.NextResponse): void {
    this.session?.step();
    this.sendResponse(response);
    this.reportStop("step");
  }

  protected override stepInRequest(response: DebugProtocol.StepInResponse): void {
    this.session?.step();
    this.sendResponse(response);
    this.reportStop("step");
  }

  protected override continueRequest(response: DebugProtocol.ContinueResponse): void {
    this.session?.continue();
    this.sendResponse(response);
    this.reportStop("breakpoint");
  }

  // Emit a Stopped event, or Terminated once the reduction reaches its normal form without a pending
  // breakpoint. A `(breakpoint! ...)` atom keeps the session stopped so the user can inspect it.
  private reportStop(reason: string): void {
    const state = this.session?.state();
    if (state !== undefined && state.done && !state.atBreakpoint) {
      this.sendEvent(new OutputEvent(`normal form: ${state.expression}\n`));
      this.sendEvent(new TerminatedEvent());
      return;
    }
    this.sendEvent(new StoppedEvent(reason, THREAD_ID));
  }
}

DebugSession.run(MettaDebugSession);
