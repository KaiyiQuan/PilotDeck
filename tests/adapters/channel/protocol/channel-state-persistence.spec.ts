import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChannelStatePersistence } from "../../../src/adapters/channel/protocol/ChannelStatePersistence.js";

test("load after save returns the in-memory (not yet flushed) state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pilotdeck-state-"));
  // Seed an old snapshot on disk with a long debounce so the new save cannot
  // have flushed yet.
  const persistence = new ChannelStatePersistence({ stateDir: dir, debounceMs: 60_000 });
  await persistence.save("ch1", { session: "old" });
  await persistence.flush();
  assert.deepEqual(await persistence.load("ch1"), { session: "old" });

  await persistence.save("ch1", { session: "new" });
  // Immediately after save(new), a load must NOT read the old disk snapshot.
  assert.deepEqual(await persistence.load("ch1"), { session: "new" });
});

test("load waits for an in-flight write instead of reading a stale file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pilotdeck-state-"));
  const persistence = new ChannelStatePersistence({ stateDir: dir, debounceMs: 1 });

  await persistence.save("ch1", { v: "first" });
  await persistence.flush();
  // Force a write in flight, then load while it is still draining.
  await persistence.save("ch1", { v: "second" });
  // debounceMs=1 means the timer fires almost immediately; drainWrites writes
  // through inFlight. A load issued now must observe the latest value either
  // from dirty or after the in-flight write completes.
  const loaded = await persistence.load("ch1");
  assert.equal((loaded as { v: string } | undefined)?.v, "second");
});

test("load returns disk state when nothing is pending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pilotdeck-state-"));
  const persistence = new ChannelStatePersistence({ stateDir: dir });
  await writeFile(join(dir, "ch2.state.json"), JSON.stringify({ hello: "disk" }), "utf8");
  assert.deepEqual(await persistence.load("ch2"), { hello: "disk" });
});

test("load returns undefined for a missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pilotdeck-state-"));
  const persistence = new ChannelStatePersistence({ stateDir: dir });
  assert.equal(await persistence.load("missing"), undefined);
});
