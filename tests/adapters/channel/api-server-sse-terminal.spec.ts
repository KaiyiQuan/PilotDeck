import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { ApiServerChannel } from "../../../src/adapters/channel/api-server/ApiServerChannel.js";
import type { GatewayEvent } from "../../../src/gateway/protocol/types.js";

function fakeReq(body: object, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  const req = Object.assign(stream, {
    method: "POST",
    url: "/v1/chat/completions",
    headers: { "content-type": "application/json", host: "127.0.0.1:8642", ...headers },
  }) as unknown as IncomingMessage;
  return req;
}

function fakeRes(): { res: ServerResponse; chunks: string[] } {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    headers,
    setHeader(k: string, v: string) { headers[k] = v; },
    flushHeaders() {},
    write(chunk: string | Buffer): boolean { chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk); return true; },
    end(chunk?: string | Buffer): void { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk); },
  } as unknown as ServerResponse;
  return { res, chunks };
}

test("SSE error path emits the OpenAI terminal markers (finish chunk + [DONE])", async () => {
  const channel = new ApiServerChannel({
    mapper: {
      resolve: () => ({ sessionKey: "sk-test", message: "hi" }),
    } as never,
  });
  // Gateway that throws mid-stream, after the request was accepted.
  const failingGateway = {
    submitTurn(): AsyncIterable<GatewayEvent> {
      const gen = (async function* () {
        throw new Error("gateway boom");
        yield { type: "turn_started", runId: "r1" } as unknown as GatewayEvent;
      })();
      return gen;
    },
  } as never;
  await channel.start({ gateway: failingGateway, logger: { error() {}, info() {}, warn() {} } } as never);

  const req = fakeReq({ stream: true, messages: [{ role: "user", content: "hi" }] });
  const { res, chunks } = fakeRes();
  await (channel as unknown as { handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> }).handleRequest(req, res);

  const joined = chunks.join("");
  assert.match(joined, /channel_submit_failed/);
  assert.match(joined, /"finish_reason":"stop"/);
  assert.match(joined, /data: \[DONE\]/);
});

test("SSE success path emits the OpenAI terminal markers", async () => {
  const channel = new ApiServerChannel({
    mapper: {
      resolve: () => ({ sessionKey: "sk-test", message: "hi" }),
    } as never,
  });
  const okGateway = {
    submitTurn(): AsyncIterable<GatewayEvent> {
      const gen = (async function* () {
        yield { type: "turn_started", runId: "r1" } as GatewayEvent;
        yield { type: "assistant_text_delta", runId: "r1", text: "hello" } as unknown as GatewayEvent;
      })();
      return gen;
    },
  } as never;
  await channel.start({ gateway: okGateway, logger: { error() {}, info() {}, warn() {} } } as never);

  const req = fakeReq({ stream: true, messages: [{ role: "user", content: "hi" }] });
  const { res, chunks } = fakeRes();
  await (channel as unknown as { handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> }).handleRequest(req, res);

  const joined = chunks.join("");
  assert.match(joined, /"content":"hello"/);
  assert.match(joined, /"finish_reason":"stop"/);
  assert.match(joined, /data: \[DONE\]/);
});
