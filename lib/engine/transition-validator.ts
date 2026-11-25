import type { StoryClue, StoryEvent, StoryPack } from "../schemas/story-pack.ts";
import type { GameState } from "../state/game-state.ts";

type SceneEvidence = Pick<GameState, "currentSceneId" | "discoveredClueIds"> & Partial<Pick<GameState, "eventHistory">>;

export function afterEvent(state: SceneEvidence, id?: string) {
  return !id || !!state.eventHistory?.some(entry => entry.storyEventId === id);
}

export function requireTransition(pack: StoryPack, state: SceneEvidence, target: string) {
  const scene = pack.scenes.find(({ id }) => id === target);
  if (!scene) throw new Error(`Unknown scene "${target}"`);
  const current = pack.scenes.find(({ id }) => id === state.currentSceneId);
  const exit = current?.transitions.find(({ toSceneId }) => toSceneId === target);
  if (!exit) throw new Error(`No exit to "${target}"`);
  if (!afterEvent(state, exit.afterEventId) || !exit.requiresClueIds.every((id) => state.discoveredClueIds.includes(id))) {
    throw new Error(`Missing exit clues for "${target}"`);
  }
  return { scene, exit };
}

export function eligibleEnding(pack: StoryPack, state: SceneEvidence) {
  return pack.endings.filter((ending) =>
    ending.sceneId === state.currentSceneId && afterEvent(state, ending.afterEventId) &&
    (ending.requiresEventIds ?? []).every(id => afterEvent(state, id)) &&
    ending.requiresClueIds.every((id) => state.discoveredClueIds.includes(id)) &&
    ending.excludesClueIds.every((id) => !state.discoveredClueIds.includes(id)),
  ).sort((a, b) => b.priority - a.priority)[0];
}

export function requireDiscoverableClue(
  pack: StoryPack,
  state: GameState,
  clueId: string,
  event: StoryEvent,
): StoryClue {
  const clue = pack.clues.find(({ id }) => id === clueId);
  if (!clue) throw new Error(`Unknown clue "${clueId}"`);
  if (clue.sceneId !== state.currentSceneId || !event.revealsClueIds.includes(clueId)) {
    throw new Error(`Clue "${clueId}" cannot be discovered by event "${event.id}" here`);
  }
  return clue;
}
