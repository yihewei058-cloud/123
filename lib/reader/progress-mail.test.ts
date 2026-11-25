import assert from "node:assert/strict";
import { test } from "node:test";
import { progressMail } from "./progress-mail.ts";
import { gameStateSchema } from "../state/game-state.ts";
import { archiveLocations } from "./local-notes.ts";
import { resizeWindow } from "./window-geometry.ts";

const initial = () => gameStateSchema.parse({ packId: "volunteer-17", currentSceneId: "s01", turn: 0,
  trust: 45, discoveredClueIds: [], knownFactIds: [], eventHistory: [], memories: [], endingId: null });
test("mail is deterministic, contains no future-stage advice at the opening, and leaves state alone", () => {
  const state = initial(), before = structuredClone(state);
  const mail = progressMail(state);
  assert.deepEqual(mail.map(item => item.id), ["progress-archive"]);
  assert.deepEqual(progressMail(state), mail);
  assert.deepEqual(state, before);
  assert.deepEqual(progressMail({ ...state, packId: "demo-story" }), []);
});
test("milestone messages accumulate without duplicates and branch away from premature spoilers", () => {
  const state = initial();
  state.currentSceneId = "s02";
  assert.deepEqual(progressMail(state).map(item => item.id), ["progress-archive", "progress-corridor"]);
  // Escaping early must never deliver instructions for the final confrontation.
  state.endingId = "end-cover";
  assert.ok(!progressMail(state).some(item => item.id === "progress-final"));
  state.endingId = null;
  state.eventHistory.push({ id: "test-1", storyEventId: "e014", sceneId: "s02", turn: 1, revealedClueIds: [] });
  state.currentSceneId = "s03";
  state.discoveredClueIds = ["c003", "c007"];
  const middle = progressMail(state);
  state.eventHistory.push({ id: "test-2", storyEventId: "e029", sceneId: "s03", turn: 2, revealedClueIds: [] });
  state.currentSceneId = "s04";
  const later = progressMail(state);
  assert.ok(middle.every(item => later.some(next => next.id === item.id)));
  assert.equal(new Set(later.map(item => item.id)).size, later.length);
});
test("final mail checks actual clues and a new session has no old milestones", () => {
  const state = initial(); state.currentSceneId = "s06";
  assert.match(progressMail(state).at(-1)!.body, /还有缺口/);
  state.discoveredClueIds = archiveLocations.map(item => item.id);
  assert.match(progressMail(state).at(-1)!.body, /完整证据/);
  assert.equal(progressMail(initial()).length, 1);
});
test("resizing each edge changes the requested dimension without locking aspect ratio", () => {
  const box = { left: 100, top: 100, width: 400, height: 300 }, bounds = { width: 1000, height: 700 };
  assert.deepEqual(resizeWindow(box, "e", 100, 90, bounds), { ...box, width: 500 });
  assert.deepEqual(resizeWindow(box, "w", -50, 90, bounds), { ...box, left: 50, width: 450 });
  assert.deepEqual(resizeWindow(box, "n", 0, -40, bounds), { ...box, top: 60, height: 340 });
  assert.deepEqual(resizeWindow(box, "s", 80, 70, bounds), { ...box, height: 370 });
  assert.deepEqual(resizeWindow(box, "se", 2000, 2000, bounds), { ...box, width: 900, height: 600 });
  assert.equal(resizeWindow(box, "e", -1000, 0, bounds).width, 280);
  assert.equal(resizeWindow(box, "s", 0, -1000, bounds).height, 160);
});
