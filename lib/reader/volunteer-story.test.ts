import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStoryPack } from "../skills/skill-loader.ts";
import { eligibleEnding } from "../engine/transition-validator.ts";
import { getReaderSession, readerView, startReaderSession, stepReader, submitReaderDanmaku } from "./reader-session.ts";
process.env.READER_STORY_PACK = "volunteer-17";
process.env.READER_LLM_PROVIDER = "mock";
const pack = await loadStoryPack("volunteer-17");
const full = ["e002", "e004", "e012", "e014", "e024", "e027", "e031", "e055"];
async function play(choices: string[], expected: string) {
  let now = 0;
  const view = (await startReaderSession(() => now))!;
  const session = getReaderSession(view.id)!;
  const queue = [...choices];
  for (let turn = 0; turn < 150; turn++) {
    const current = readerView(view.id, session);
    assert.deepEqual(current.discoveredClueIds, session.engine.getSnapshot().state.discoveredClueIds);
    assert.equal(new Set(current.guidanceMail.map(mail => mail.id)).size, current.guidanceMail.length);
    if (current.mode === "completed") break;
    if (current.mode === "waiting_for_player") {
      const id = queue.shift();
      assert.ok(id && session.engine.getSnapshot().openEventIds.includes(id), "Unexpected window: " + id + " / " + session.engine.getSnapshot().openEventIds);
      if (["e061", "e063", "e066"].includes(id!)) {
        // Several ambiguous messages must not make the protagonist choose a fatal outcome.
        for (let i = 0; i < 4; i++) {
          session.engine.submitDanmaku({ kind: "intervention", text: "嗯" });
          await session.engine.processIntervention();
          await session.engine.advanceAutonomousStep();
          assert.equal(session.engine.getSnapshot().state.endingId, null);
          assert.ok(session.engine.getSnapshot().openEventIds.includes(id!));
        }
      }
      await submitReaderDanmaku(session, pack.events.find(e => e.id === id)!.description, crypto.randomUUID());
    } else {
      assert.equal(current.mode, "advancing");
      now += current.nextStepDelayMs;
      await stepReader(session, current.revision);
    }
  }
  assert.equal(queue.length, 0);
  const snapshot = session.engine.getSnapshot();
  assert.equal(snapshot.state.endingId, expected);
  assert.equal(readerView(view.id, session).mode, "completed");
  assert.equal(snapshot.timeline.filter(e => e.type === "session_completed").length, 1);
  return snapshot;
}
test("exactly five requested endings", () => {
  assert.deepEqual(pack.endings.map(e => e.title).sort(), ["血腥的光荣", "真相重见天日", "最后一步", "失败的英雄", "粉饰的真相"].sort());
});
test("all clues plus explicit lethal choice reaches blood ending", async () => {
  const result = await play([...full, "e063"], "end-blood");
  assert.equal(result.state.discoveredClueIds.length, pack.clues.length);
});
test("all clues plus coercing confession reaches truth ending", async () => {
  const result = await play([...full, "e061"], "end-truth");
  assert.equal(result.state.discoveredClueIds.length, pack.clues.length);
});
test("early exposure fails before collecting the records", async () => {
  const result = await play(["e002", "e004", "e011"], "end-hero");
  assert.ok(result.state.discoveredClueIds.length < pack.clues.length);
});
test("hiding then leaving avoids the confrontation", async () => {
  const result = await play(["e002", "e004", "e012", "safe-escape"], "end-cover");
  assert.ok(!result.state.eventHistory.some(e => e.storyEventId === "e057"));
});
test("office hiding also permits escape", async () => {
  await play(["e002", "e004", "e009", "safe-escape"], "end-cover");
});
test("abandoning confrontation despite complete clues reaches last step", async () => {
  await play([...full, "e066"], "end-last");
});
for (const final of ["e061", "e063"]) test("incomplete clues cannot unlock true ending: " + final, async () => {
  await play(["e004", "e012", "e014", "e025", "e027", "e031", "e055", final], "end-last");
});
test("every individual missing clue prevents either true ending", () => {
  for (const choice of ["e061", "e063"]) for (const clue of pack.clues) {
    const state = {
      currentSceneId: "s06",
      discoveredClueIds: pack.clues.filter(c => c.id !== clue.id).map(c => c.id),
      eventHistory: [choice, "final-resolution"].map((storyEventId, i) => ({
        id: "test-" + i, storyEventId, sceneId: "s06", turn: i, revealedClueIds: [],
      })),
    };
    assert.equal(eligibleEnding(pack, state)?.id, "end-last");
  }
});
