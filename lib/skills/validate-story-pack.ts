import type { StoryPack } from "../schemas/story-pack.ts";

export function validateStoryPackReferences(pack: StoryPack): void {
  const { manifest, facts, clues, scenes, events, endings } = pack;
  const errors: string[] = [];
  const idOwners = new Map<string, string>();
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const clueById = new Map(clues.map((clue) => [clue.id, clue]));
  const factIds = new Set(facts.map((fact) => fact.id));

  function register(id: string, field: string) {
    const owner = idOwners.get(id);
    if (owner) errors.push(`${field}: duplicate ID "${id}" (already used by ${owner})`);
    else idOwners.set(id, field);
  }

  function checkReferences(ids: string[], index: { has(id: string): boolean }, field: string) {
    for (const id of ids) {
      if (!index.has(id)) errors.push(`${field}: unknown ID "${id}"`);
    }
  }

  register(manifest.id, "manifest.json.id");
  register(manifest.character.id, "manifest.json.character.id");
  const collections = { facts, clues, scenes, events, endings };
  for (const [file, records] of Object.entries(collections)) {
    records.forEach(({ id }, index) => register(id, `${file}.json[${index}].id`));
  }

  checkReferences([manifest.entrySceneId], sceneById, "manifest.json.entrySceneId");
  checkReferences(manifest.character.knownFactIds, factIds, "manifest.json.character.knownFactIds");

  const eventIds = new Set(events.map(event => event.id));
  for (const clue of clues) {
    const field = `clues.json (${clue.id})`;
    checkReferences([clue.sceneId], sceneById, `${field}.sceneId`);
    checkReferences(clue.factIds, factIds, `${field}.factIds`);
  }

  for (const scene of scenes) {
    scene.transitions.forEach((transition, index) => {
      const field = `scenes.json (${scene.id}).transitions[${index}]`;
      checkReferences([transition.toSceneId], sceneById, `${field}.toSceneId`);
      if (transition.afterEventId) checkReferences([transition.afterEventId], eventIds, field);
      checkReferences(transition.requiresClueIds, clueById, `${field}.requiresClueIds`);
    });
  }

  for (const event of events) {
    const field = `events.json (${event.id})`;
    checkReferences([event.sceneId], sceneById, `${field}.sceneId`);
    checkReferences([...(event.follows ?? []), ...(event.requiresEventIds ?? []), ...(event.excludesEventIds ?? [])], eventIds, field);
    checkReferences(event.resultFactIds ?? [], factIds, field);
    checkReferences(event.requiresClueIds, clueById, `${field}.requiresClueIds`);
    checkReferences(event.revealsClueIds, clueById, `${field}.revealsClueIds`);
    for (const id of event.revealsClueIds) {
      const clue = clueById.get(id);
      if (clue && clue.sceneId !== event.sceneId) {
        errors.push(`${field}.revealsClueIds: "${id}" belongs to scene "${clue.sceneId}"`);
      }
      if (event.requiresClueIds.includes(id)) {
        errors.push(`${field}: "${id}" is both required and revealed`);
      }
    }
  }

  for (const ending of endings) {
    const field = `endings.json (${ending.id})`;
    checkReferences(ending.requiresEventIds ?? [], eventIds, `${field}.requiresEventIds`);
    checkReferences([ending.sceneId], sceneById, `${field}.sceneId`);
    if (ending.afterEventId) checkReferences([ending.afterEventId], eventIds, field);
    checkReferences(ending.requiresClueIds, clueById, `${field}.requiresClueIds`);
    checkReferences(ending.excludesClueIds, clueById, `${field}.excludesClueIds`);
    for (const id of ending.excludesClueIds) {
      if (ending.requiresClueIds.includes(id)) {
        errors.push(`${field}: "${id}" is both required and excluded`);
      }
    }
  }

  const reachable = new Set([manifest.entrySceneId]);
  for (const id of reachable) {
    for (const transition of sceneById.get(id)?.transitions ?? []) {
      reachable.add(transition.toSceneId);
    }
  }
  for (const { id } of scenes) {
    if (!reachable.has(id)) errors.push(`scenes.json: "${id}" is unreachable from the entry scene`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid story pack references:\n- ${errors.join("\n- ")}`);
  }
}
