import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStoryPack } from "../skills/skill-loader.ts";
import { cueFor } from "./camera-staging.ts";
import { getReaderSession, readerView, startReaderSession, stepReader, submitReaderDanmaku } from "./reader-session.ts";

process.env.READER_STORY_PACK = "volunteer-17";
process.env.READER_LLM_PROVIDER = "mock";
const pack = await loadStoryPack("volunteer-17");

async function hide(choice: "e009" | "e012") {
  let now = 0;
  const initial = (await startReaderSession(() => now))!;
  const session = getReaderSession(initial.id)!;
  const choices = ["e002", "e004", "step-into-hall", choice];
  for (let i = 0; i < 40; i++) {
    const view = readerView(initial.id, session);
    if (view.nextStepDelayMs) return {
      session, view: () => readerView(initial.id, session),
      elapse: (ms: number) => { now += ms; },
    };
    if (view.mode === "waiting_for_player") {
      const action = choices.shift();
      assert.ok(action);
      await submitReaderDanmaku(session, pack.events.find(event => event.id === action)!.description, crypto.randomUUID());
    } else await stepReader(session, view.revision);
  }
  throw new Error("Hiding did not schedule a patrol");
}

for (const choice of ["e009", "e012"] as const) test(`patrol continues without player input after ${choice}`, async () => {
  const { session, view, elapse } = await hide(choice);
  const clues = view().discoveredClueIds;
  const hidden = view();
  assert.equal(hidden.mode, "advancing");
  assert.equal(hidden.nextStepDelayMs, 6000);
  elapse(5999);
  await stepReader(session, hidden.revision);
  assert.equal(view().revision, hidden.revision);
  assert.equal(view().nextStepDelayMs, 1);
  elapse(1);
  await stepReader(session, hidden.revision);
  assert.equal(view().eventIds.at(-1), "patrol-1-moving");
  const moving = view();
  assert.equal(moving.nextStepDelayMs, 12000);
  const cue = cueFor("s02", moving.eventIds)!;
  assert.equal(cue.hei?.exit, true);
  assert.ok(cue.hei!.at[0] > 320);
  assert.equal(choice === "e012" ? cue.qu.exit : cue.qu.pose, choice === "e012" ? true : "crouch");
  elapse(12000);
  await stepReader(session, hidden.revision); // Stale retries cannot skip a beat.
  assert.equal(view().eventIds.at(-1), "patrol-1-moving");
  await stepReader(session, moving.revision);
  assert.equal(view().eventIds.at(-1), "patrol-1-clear");
  assert.equal(view().mode, "waiting_for_player");
  assert.deepEqual(session.engine.getSnapshot().openEventIds.sort(), ["e014", "safe-escape"].sort());
  assert.deepEqual(view().discoveredClueIds, clues);
  assert.equal(view().sceneId, "s02");
  assert.ok(session.engine.getSnapshot().state.knownFactIds.includes("f-patrol-first-floor-clear"));
  const cleared = view();
  elapse(60000);
  await stepReader(session, cleared.revision);
  assert.equal(view().revision, cleared.revision); // Wait for the player's route choice.
});

test("messages during hiding neither reset the timer nor let the character leave early", async () => {
  const { session, view, elapse } = await hide("e012");
  elapse(3000);
  await submitReaderDanmaku(session, "出来上二楼找设备日志", crypto.randomUUID());
  assert.equal(view().nextStepDelayMs, 3000);
  assert.equal(view().eventIds.at(-1), "e012");
  elapse(3000);
  await stepReader(session, view().revision);
  assert.equal(view().eventIds.at(-1), "patrol-1-moving");
  elapse(view().nextStepDelayMs);
  await stepReader(session, view().revision);
  assert.equal(view().eventIds.at(-1), "patrol-1-clear");
  await stepReader(session, view().revision);
  assert.equal(view().eventIds.at(-1), "e014");
  assert.equal(session.engine.getSnapshot().pendingDanmaku.length, 0);
});
