import { mockAgent, type NarrativeAgent } from "../agent/mock-agent.ts";
import {
  agentTurnOutputSchema,
  autonomousProposalSchema,
  danmakuSchema,
  type AgentTurnOutput,
  type Danmaku,
} from "../schemas/agent-protocol.ts";
import type { StoryEvent, StoryPack } from "../schemas/story-pack.ts";
import { storyEndingsSchema } from "../schemas/story-pack.ts";
import { gameStateSchema, type GameState } from "../state/game-state.ts";
import { availableEvents, availableInterventionEvents, requireOpenEvent } from "./event-controller.ts";
import { NarrativeTimeline, type TimelineEvent } from "./narrative-timeline.ts";
import { afterEvent, eligibleEnding, requireDiscoverableClue, requireTransition } from "./transition-validator.ts";

function freezeContext<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeContext(child);
    Object.freeze(value);
  }
  return value;
}


const MISSED_ROUNDS_BEFORE_PASSING = 3;
export function startSession(pack: StoryPack, agent: NarrativeAgent = mockAgent, timeoutMs = 30_000, clock = Date.now): NarrativeEngine {
  return new NarrativeEngine(pack, agent, timeoutMs, clock);
}

export class NarrativeEngine {
  #pack: StoryPack;
  #agent: NarrativeAgent;
  #timeoutMs: number;
  #state: GameState;
  #timeline = new NarrativeTimeline();
  #pending: Danmaku[] = [];
  #lastDanmaku = 0;
  #openEventIds: string[] = [];
  #sentFirstInterventionLine = false;
  // Intervention moments the player let pass; the protagonist then carries on by himself.
  #passedEventIds = new Set<string>();
  #missedRounds = 0;
  #processing = false;
  #queueVersion = 0;
  #receipts = new Map<string, Danmaku>();
  #clock: () => number;
  #scheduled?: { id: string; readyAt: number };

  constructor(pack: StoryPack, agent: NarrativeAgent, timeoutMs = 30_000, clock = Date.now) {
    this.#clock = clock;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error("Invalid agent timeout");
    this.#timeoutMs = timeoutMs;
    this.#pack = structuredClone(pack);
    storyEndingsSchema.parse(this.#pack.endings);
    this.#agent = agent;
    const { manifest, scenes } = this.#pack;
    const entry = scenes.find(({ id }) => id === manifest.entrySceneId);
    if (!entry) throw new Error(`Entry scene "${manifest.entrySceneId}" is missing`);

    this.#state = gameStateSchema.parse({
      packId: manifest.id,
      currentSceneId: entry.id,
      turn: 0,
      trust: manifest.character.initialTrust,
      discoveredClueIds: [],
      knownFactIds: manifest.character.knownFactIds,
      eventHistory: [],
      memories: [],
      endingId: null,
    });
    this.#timeline.append({ type: "session_started", source: "ai_system", sceneId: entry.id, content: { sceneId: entry.id } });
    this.#timeline.append({
      type: "narrative_block", source: "protagonist",
      content: { kind: "narration", text: entry.opening },
    });
  }

  getSnapshot() {
    return {
      status: this.#state.endingId === null ? "active" as const : "completed" as const,
      state: structuredClone(this.#state),
      pendingDanmaku: structuredClone(this.#pending),
      openEventIds: [...this.#openEventIds],
      timeline: this.#timeline.snapshot(),
    };
  }

  advanceNarrative() {
    this.#requireActive();
    if (this.#openWindow()) return this.getSnapshot();
    if (!this.#pending.length || !this.#openEventIds.length) {
      const scene = this.#pack.scenes.find(({ id }) => id === this.#state.currentSceneId)!;
      const exit = scene.transitions.find(({ requiresClueIds, afterEventId }) => afterEvent(this.#state, afterEventId) &&
        requiresClueIds.every((id) => this.#state.discoveredClueIds.includes(id)),
      );
      if (exit) return this.transitionScene(exit.toSceneId);
      this.evaluateEnding();
    }
    return this.getSnapshot();
  }

  #openWindow(): boolean {
    if (this.#openEventIds.length) return false;
    this.#openEventIds = availableInterventionEvents(this.#pack, this.#state)
      .map(({ id }) => id).filter(id => !this.#passedEventIds.has(id));
    if (!this.#openEventIds.length) return false;
    this.#timeline.append({
      type: "intervention_opened", source: "ai_system", content: { eventIds: this.#openEventIds },
    });
    const line = this.#pack.manifest.firstInterventionLine;
    if (line && !this.#sentFirstInterventionLine) {
      this.#sentFirstInterventionLine = true;
      this.#timeline.append({
        type: "narrative_block", source: "protagonist", sceneId: this.#state.currentSceneId,
        content: { kind: "narration", text: line },
      });
    }
    return true;
  }

  // Authored world events keep time without asking the character's model to act.
  // The same deadline survives chat messages and repeated/stale polling.
  getAutonomousDelayMs() {
    const action = this.#openEventIds.length ? undefined
      : availableEvents(this.#pack, this.#state, "autonomous").find(event => event.delayMs);
    if (!action) { this.#scheduled = undefined; return 0; }
    if (this.#scheduled?.id !== action.id) {
      this.#scheduled = { id: action.id, readyAt: this.#clock() + action.delayMs! };
    }
    return Math.max(0, this.#scheduled.readyAt - this.#clock());
  }

  async advanceAutonomousStep() {
    if (this.#state.endingId !== null) return { status: "completed" as const };
    this.#requireActive();
    this.#openWindow();
    if (this.#openEventIds.length) return { status: "waiting_for_player" as const };

    const state = this.#state;
    // Intervention moments the player let pass become things he may now decide to do himself.
    const passed = availableInterventionEvents(this.#pack, state)
      .filter(({ id }) => this.#passedEventIds.has(id))
      .map(event => ({ ...event, trigger: "autonomous" as const, result: event.description }));
    const candidates: Extract<StoryEvent, { trigger: "autonomous" }>[] =
      [...availableEvents(this.#pack, state, "autonomous"), ...passed];
    const scene = this.#pack.scenes.find(({ id }) => id === state.currentSceneId)!;
    if (!candidates.length) {
      const exit = scene.transitions.find(({ requiresClueIds, afterEventId }) => afterEvent(this.#state, afterEventId) &&
        requiresClueIds.every(id => state.discoveredClueIds.includes(id)));
      if (exit) {
        this.transitionScene(exit.toSceneId);
        return { status: "transitioned" as const, sceneId: exit.toSceneId };
      }
      return this.evaluateEnding()
        ? { status: "completed" as const }
        : { status: "no_action" as const };
    }

    const scheduled = candidates.find(action => action.delayMs);
    if (scheduled) {
      if (this.getAutonomousDelayMs() > 0) return { status: "waiting_for_time" as const };
      return this.#executeAutonomousAction(scheduled);
    }

    const choose = this.#agent.chooseAutonomousAction;
    if (!choose) throw new Error("Agent does not support autonomous actions");
    return this.#runAgent(signal => choose(freezeContext(structuredClone({
      characterName: this.#pack.manifest.character.name, state, scene, availableEvents: candidates,
    })), signal), "autonomous step", choice => {
      const { actionId } = autonomousProposalSchema.parse(choice);
      const action = candidates.find(({ id }) => id === actionId);
      if (!action) throw new Error(`Autonomous action "${actionId}" is not eligible`);
      return this.#executeAutonomousAction(action);
    });
  }

  #executeAutonomousAction(action: Extract<StoryEvent, { trigger: "autonomous" }>) {
    const state = this.#state;
    const actionId = action.id;
    const clues = action.revealsClueIds
      .map(id => requireDiscoverableClue(this.#pack, state, id, action))
      .filter(({ id }) => !state.discoveredClueIds.includes(id));
    const revealedClueIds = clues.map(({ id }) => id);
    const turn = state.turn + 1;
    this.#state = gameStateSchema.parse({
      ...state, turn,
      discoveredClueIds: [...state.discoveredClueIds, ...revealedClueIds],
      knownFactIds: [...new Set([...state.knownFactIds, ...(action.resultFactIds ?? []), ...clues.flatMap(clue => clue.factIds)])],
      eventHistory: [...state.eventHistory, {
        id: `game-event-${state.eventHistory.length + 1}`, storyEventId: actionId, sceneId: action.sceneId, turn, revealedClueIds,
      }],
    });
    const proposalId = this.#timeline.nextId;
    this.#timeline.append({
      type: "autonomous_action_proposed", source: "protagonist", content: { actionId },
    });
    const executionId = this.#timeline.nextId;
    this.#timeline.append({
      type: "autonomous_action_executed", source: "protagonist", causedBy: proposalId,
      content: { actionId, result: action.result },
    });
    for (const clue of clues) this.#timeline.append({
      type: "narrative_block", source: "protagonist", causedBy: executionId, relatedClueIds: [clue.id],
      content: { kind: "clue", clueId: clue.id, text: clue.description },
    });
    this.#timeline.append({
      type: "turn_committed", source: "ai_system", causedBy: executionId,
      content: { turn, trust: state.trust, memoriesAdded: 0 },
    });
    this.#openWindow();
    return { status: "executed" as const, actionId };
  }

  #requireActive() {
    if (this.#state.endingId !== null) throw new Error("The session has ended");
    if (this.#processing) throw new Error("An intervention is already being processed");
  }

  transitionScene(sceneId: string) {
    this.#requireActive();
    this.#commitStep({ kind: "transition", sceneId });
    return this.getSnapshot();
  }

  evaluateEnding(): string | null {
    this.#requireActive();
    const ending = eligibleEnding(this.#pack, this.#state);
    if (ending) this.#commitStep({ kind: "end", endingId: ending.id });
    return ending?.id ?? null;
  }

  #commitStep(step: AgentTurnOutput["nextStep"]) {
    const draft = structuredClone(this.#state);
    const entries = this.#stageStep(draft, step);
    this.#state = draft;
    this.#closeWindow();
    this.#finishStep(entries);
  }

  #stageStep(draft: Pick<GameState, "endingId" | "currentSceneId" | "discoveredClueIds"> & Partial<Pick<GameState, "eventHistory">>, step: AgentTurnOutput["nextStep"]): TimelineEvent[] {
    if (step.kind === "stay") return [];
    if (step.kind === "end") {
      const ending = eligibleEnding(this.#pack, draft);
      if (!ending || ending.id !== step.endingId) throw new Error(`Invalid ending "${step.endingId}"`);
      draft.endingId = ending.id;
      const prose: TimelineEvent[] = ending.epilogue ? [{ type: "narrative_block", source: "protagonist", content: { kind: "character_action", text: ending.epilogue } }] : [];
      return [...prose, {
        type: "session_completed", source: "ai_system", sceneId: draft.currentSceneId,
        relatedClueIds: ending.requiresClueIds, content: { endingId: ending.id, title: ending.title },
      }];
    }
    const { scene, exit } = requireTransition(this.#pack, draft, step.sceneId);
    const fromSceneId = draft.currentSceneId;
    draft.currentSceneId = scene.id;
    return [
      { type: "scene_transition", source: "ai_system", sceneId: scene.id, relatedClueIds: exit.requiresClueIds,
        content: { fromSceneId, toSceneId: scene.id } },
      { type: "narrative_block", source: "protagonist", sceneId: scene.id,
        content: { kind: "narration", text: scene.opening } },
    ];
  }

  #closeWindow() {
    if (this.#openEventIds.length) this.#timeline.append({
      type: "intervention_closed", source: "ai_system", content: { eventIds: this.#openEventIds },
    });
    this.#openEventIds = [];
  }

  #finishStep(entries: TimelineEvent[]) {
    if (!entries.length) return;
    for (const message of this.#pending) this.#timeline.append({
      type: "danmaku_expired", source: "ai_system", sceneId: message.sceneId,
      relatedDanmakuId: message.id, content: { danmakuId: message.id },
    });
    this.#pending = [];
    for (const entry of entries) this.#timeline.append(entry);
  }

  submitDanmaku(input: Pick<Danmaku, "kind" | "text">, requestId?: string): Danmaku {
    if (requestId !== undefined) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error("Invalid request ID");
      const previous = this.#receipts.get(requestId);
      if (previous) {
        if (previous.kind !== input.kind || previous.text !== input.text.trim()) throw new Error("Request ID conflict");
        return structuredClone(previous);
      }
    }
    if (this.#state.endingId !== null) throw new Error("The session has ended");
    const message = danmakuSchema.parse({
      ...input,
      id: `danmaku-${this.#lastDanmaku + 1}`,
      sceneId: this.#state.currentSceneId,
      submittedAtTurn: this.#state.turn,
    });
    this.#lastDanmaku++;
    this.#pending.push(message);
    if (requestId) this.#receipts.set(requestId, message);
    this.#queueVersion++;
    this.#timeline.append({ type: "danmaku_submitted", source: "player", relatedDanmakuId: message.id, content: message });
    return structuredClone(message);
  }

  async processIntervention() {
    this.#requireActive();
    if (this.#openEventIds.length === 0) throw new Error("No intervention is open");
    const batch = this.#pending.filter(({ sceneId }) => sceneId === this.#state.currentSceneId);
    if (batch.length === 0) return this.getSnapshot();

    const scene = this.#pack.scenes.find(({ id }) => id === this.#state.currentSceneId);
    if (!scene) throw new Error(`Unknown current scene "${this.#state.currentSceneId}"`);

    return this.#runAgent(signal => this.#agent(freezeContext(structuredClone({
      characterName: this.#pack.manifest.character.name,
      state: this.#state,
      scene,
      danmaku: batch,
      availableEvents: availableInterventionEvents(this.#pack, this.#state)
        .filter(({ id }) => this.#openEventIds.includes(id)),
    })), signal), "intervention batch", result => {
      this.#applyAgentDecision(batch, agentTurnOutputSchema.parse(result));
      return this.getSnapshot();
    });
  }

  async #runAgent<Result, Committed>(
    invoke: (signal: AbortSignal) => Promise<Result>,
    operation: string,
    commit: (result: Result) => Committed,
  ): Promise<Committed> {
    this.#processing = true;
    const version = this.#queueVersion;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Agent timed out")), this.#timeoutMs);
    try {
      const deadline = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      });
      const result = await Promise.race([invoke(controller.signal), deadline]);
      if (version !== this.#queueVersion) throw new Error(`Stale ${operation}`);
      return commit(result);
    } finally {
      clearTimeout(timer);
      this.#processing = false;
    }
  }

  #applyAgentDecision(batch: Danmaku[], output: AgentTurnOutput): void {
    const decisions = new Map(output.danmakuDecisions.map((decision) => [decision.danmakuId, decision]));
    const messages = new Map(batch.map((message) => [message.id, message]));
    if (decisions.size !== messages.size || batch.some(({ id }) => !decisions.has(id))) {
      throw new Error("Agent must decide on each message in the submitted batch");
    }
    const proposals = Map.groupBy(output.proposedEvents, ({ danmakuId }) => danmakuId);
    for (const id of proposals.keys()) {
      if (messages.get(id)?.kind !== "intervention" || decisions.get(id)?.decision !== "accept") {
        throw new Error(`Event proposals require an accepted intervention message: "${id}"`);
      }
    }

    const state = this.#state;
    const discovered = new Set(state.discoveredClueIds);
    const known = new Set(state.knownFactIds);
    const validatedEvents: GameState["eventHistory"] = [];
    const proposedIds = new Set<string>();
    const entries: TimelineEvent[] = [];

    for (const message of batch) {
      const decision = decisions.get(message.id)!;
      const decisionId = this.#timeline.nextId + entries.length;
      entries.push({ type: "narrative_block", source: "protagonist", relatedDanmakuId: message.id, content: { kind: "decision", ...decision } });
      if (decision.decision === "infer" ||
          (message.kind === "information" && decision.decision === "reject")) {
        entries.push({
          type: "narrative_block", source: "protagonist",
          causedBy: decisionId, relatedDanmakuId: message.id, content: { kind: "ai_inference", text: decision.reason },
        });
      }
      for (const proposal of proposals.get(message.id) ?? []) {
        const event = requireOpenEvent(this.#pack, { ...state, eventHistory: [...state.eventHistory, ...validatedEvents] }, this.#openEventIds, proposal.storyEventId);
        if (proposedIds.has(event.id)) throw new Error(`Duplicate proposed event "${event.id}"`);
        proposedIds.add(event.id);
        const revealedClueIds: string[] = [];
        entries.push({
          type: "intervention_triggered", source: "ai_system", causedBy: decisionId,
          relatedDanmakuId: message.id, relatedClueIds: event.revealsClueIds,
          content: { storyEventId: event.id, danmakuId: message.id },
        });
        const actionId = this.#timeline.nextId + entries.length;
        entries.push({
          type: "narrative_block", source: "protagonist", causedBy: decisionId, relatedDanmakuId: message.id,
          content: { kind: "character_action", text: event.description },
        });
        for (const clueId of event.revealsClueIds) {
          const clue = requireDiscoverableClue(this.#pack, state, clueId, event);
          if (discovered.has(clueId)) continue;
          discovered.add(clueId);
          for (const factId of clue.factIds) known.add(factId);
          revealedClueIds.push(clueId);
          entries.push({
            type: "narrative_block", source: "protagonist",
            causedBy: actionId, relatedDanmakuId: message.id, relatedClueIds: [clueId], content: { kind: "clue", clueId, text: clue.description },
          });
        }
        for (const fact of event.resultFactIds ?? []) known.add(fact);
        validatedEvents.push({
          id: `game-event-${state.eventHistory.length + validatedEvents.length + 1}`,
          storyEventId: event.id,
          sceneId: state.currentSceneId,
          turn: state.turn + 1,
          danmakuId: message.id,
          revealedClueIds,
        });
      }
    }

    const evidence = { eventHistory: [...state.eventHistory, ...validatedEvents], currentSceneId: state.currentSceneId, endingId: state.endingId, discoveredClueIds: [...discovered] };
    const stepEntries = this.#stageStep(evidence, output.nextStep);
    const draft = gameStateSchema.parse({
      ...state, ...evidence, turn: state.turn + 1,
      trust: Math.max(0, Math.min(100, state.trust + output.trustDelta)),
      knownFactIds: [...known], memories: [...state.memories, ...output.memories],
      eventHistory: [...state.eventHistory, ...validatedEvents],
    });
    this.#state = draft;
    this.#pending = this.#pending.filter(({ id }) => !messages.has(id));
    if (output.narration) {
      entries.push({
        type: "narrative_block", source: "protagonist",
        content: {
          kind: "narration", text: output.narration,
          ...(output.delivery && { delivery: output.delivery }),
        },
      });
    }
    entries.push({
      type: "turn_committed", source: "ai_system",
      content: { turn: draft.turn, trust: draft.trust, memoriesAdded: output.memories.length },
    });
    for (const entry of entries) this.#timeline.append(entry);
    // After three rounds in which none of the player's suggestions led to an action, the moment
    // passes: the window stops reopening and the protagonist chooses one of those actions himself.
    this.#missedRounds = validatedEvents.length ? 0 : this.#missedRounds + 1;
    if (this.#missedRounds >= MISSED_ROUNDS_BEFORE_PASSING) {
      for (const id of this.#openEventIds) {
        // Irreversible choices must not become autonomous just because clarification took time.
        if (!this.#pack.events.find(event => event.id === id)?.requiresPlayerChoice) this.#passedEventIds.add(id);
      }
      this.#missedRounds = 0;
    }
    this.#closeWindow();
    this.#finishStep(stepEntries);
  }
}
