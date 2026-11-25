import { z } from "zod";
import { idListSchema, idSchema, textSchema, trustSchema } from "./common.ts";

export const storyCharacterSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  initialTrust: trustSchema,
  knownFactIds: idListSchema,
});

export const storyPackManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  title: textSchema,
  entrySceneId: idSchema,
  firstInterventionLine: textSchema.optional(),
  character: storyCharacterSchema,
});

export const storyFactSchema = z.strictObject({
  id: idSchema,
  description: textSchema,
});

export const storyClueSchema = z.strictObject({
  id: idSchema,
  sceneId: idSchema,
  description: textSchema,
  factIds: idListSchema,
});

export const storySceneSchema = z.strictObject({
  id: idSchema,
  title: textSchema,
  opening: textSchema,
  goal: textSchema.optional(),
  transitions: z.array(z.strictObject({
    toSceneId: idSchema,
    afterEventId: idSchema.optional(),
    requiresClueIds: idListSchema,
  })).refine(
    (transitions) => new Set(transitions.map(({ toSceneId }) => toSceneId)).size === transitions.length,
    "Transition targets must be unique within a scene",
  ),
});

const storyEventFields = {
  requiresPlayerChoice: z.boolean().optional(),
  follows: idListSchema.optional(),
  requiresEventIds: idListSchema.optional(),
  excludesEventIds: idListSchema.optional(),
  resultFactIds: idListSchema.optional(),
  id: idSchema,
  sceneId: idSchema,
  description: textSchema,
  requiresClueIds: idListSchema,
  revealsClueIds: idListSchema,
};

export const storyEventSchema = z.discriminatedUnion("trigger", [
  z.strictObject({ ...storyEventFields, trigger: z.literal("danmaku-intervention") }),
  z.strictObject({ ...storyEventFields, trigger: z.literal("autonomous"), result: textSchema,
    delayMs: z.number().int().min(1).max(60_000).optional() }),
]);

export const storyEndingSchema = z.strictObject({
  priority: z.number(),
  requiresEventIds: idListSchema.optional(),
  afterEventId: idSchema.optional(),
  epilogue: textSchema.optional(),
  id: idSchema,
  sceneId: idSchema,
  title: textSchema,
  requiresClueIds: idListSchema,
  excludesClueIds: idListSchema,
  narrativeGoal: textSchema,
});

export const storyEndingsSchema = z.array(storyEndingSchema).min(1).refine(
  (endings) => new Set(endings.map(({ priority }) => priority)).size === endings.length,
  "Ending priorities must be unique within a pack",
);

export const storyPackSchema = z.strictObject({
  manifest: storyPackManifestSchema,
  skillMarkdown: textSchema,
  characterMarkdown: textSchema,
  worldMarkdown: textSchema,
  facts: z.array(storyFactSchema),
  clues: z.array(storyClueSchema),
  scenes: z.array(storySceneSchema).min(1),
  events: z.array(storyEventSchema),
  endings: storyEndingsSchema,
});

export type StoryPackManifest = z.infer<typeof storyPackManifestSchema>;
export type StoryCharacter = z.infer<typeof storyCharacterSchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
export type StoryFact = z.infer<typeof storyFactSchema>;
export type StoryClue = z.infer<typeof storyClueSchema>;
export type StoryEvent = z.infer<typeof storyEventSchema>;
export type StoryEnding = z.infer<typeof storyEndingSchema>;
export type StoryPack = z.infer<typeof storyPackSchema>;
