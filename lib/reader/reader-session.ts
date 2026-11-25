import { randomUUID } from "node:crypto";
import { progressMail } from "./progress-mail.ts";
import { createNarrativeAgent } from "../agent/narrative-agent.ts";
import { startSession } from "../engine/narrative-engine.ts";
import type { TimelineEntry } from "../engine/narrative-timeline.ts";
import { createDeepSeekProvider } from "../providers/deepseek-provider.ts";
import { createMockProvider } from "../providers/mock-provider.ts";
import { ProviderRegistry } from "../providers/provider-registry.ts";
import type { AgentTurnOutput, Danmaku } from "../schemas/agent-protocol.ts";
import { loadStoryPack } from "../skills/skill-loader.ts";

type ReaderMode = "advancing" | "waiting_for_player" | "no_action" | "completed";
type ReaderEntry = Extract<TimelineEntry, {
  type: "narrative_block" | "danmaku_submitted" | "autonomous_action_executed" | "session_completed";
}>;

type ReaderSession = {
  engine: ReturnType<typeof startSession>;
  title: string;
  character: string;
  hasFirstInterventionLine: boolean;
  sceneTitles: Map<string, string>;
  idle: boolean;
  busy: boolean;
  touchedAt: number;
};

const sessions = new Map<string, ReaderSession>();
const sessionLifetime = 60 * 60 * 1000;

const actionReplies: Record<string, string> = {
  e002: "我再查一下柜子，看看有没有漏掉的原始记录。",
  e004: "我先核对手机里收到的目录。",
  e007: "我去门边听一下。你帮我看着外面。",
  "leave-now": "好，我把文件收好，从档案室出去。",
  e009: "我从办公室绕过去，文件袋不会放下。",
  e011: "我现在出去找他，这样可能会被发现。",
  e014: "他已经走远了。我现在去二楼继续查。",
  "safe-escape": "我不查了，趁他走远从一楼撤出去。",
  e012: "我先躲进储物间，等手电移开。",
  e024: "我看看他们私下怎么讨论这份报告。",
  e025: "我把正式报告和眼前这份原始记录对一下。",
  e027: "好，我让屏幕回到待机，再往后退。",
  e028: "我先留在隔断后面，看看门边的动静。",
  e031: "我先留在门后，等他走远再去地下室。",
  e032: "他挡着走廊。我先等他的手电移开，再找机会撤。",
  e040: "我不想再让他拿走这些东西。",
  e041: "好，我先退开，带着资料找出口。",
  e053: "我先收好现有材料，准备离开。",
  e054: "材料先留在我手上。我不会把它们交给他。",
  e055: "我先核对补充文件，看看能不能对上。",
  e058: "好，我去值班室，请里面的人过来作证。",
  e061: "我要拿证据逼他说明白，让值班人员听见。",
  e063: "他还在逼过来。我知道这一步意味着什么。",
  e066: "我会按刚才谈的，把约定的材料交给他。",
};

const retreatAdvice = /撤离|撤退|快走|后退|退开|绕开|拉开.{0,3}距离|安全通道|别.{0,6}(?:拔刀|动手|对峙)|把刀.{0,4}(?:放下|收起来)/u;
const attackAdvice = /主动.{0,10}(?:发起攻击|出手)|^(?:直接|现在)?(?:攻击|袭击|动手)/u;

// Scripted model output for this pack. Engine validation still governs every action and clue.
const registry = new ProviderRegistry();
registry.register(createMockProvider("reader-mock", true, ({ messages }) => {
  const { availableActions, playerInput, scene } = JSON.parse(messages[1].content) as {
    scene: { id: string };
    availableActions: { id: string; description: string }[];
    playerInput: Pick<Danmaku, "id" | "text">[];
  };
  const action = availableActions[0];
  if (!playerInput.length) return JSON.stringify({ actionId: action.id });

  if (availableActions.some(option => !option.id.startsWith("event-"))) {
    const proposedEvents: AgentTurnOutput["proposedEvents"] = [];
    // Script the archive-room exchange in the offline preview.
    function reaction(text: string): string | undefined {
      if (scene.id !== "s01") return;
      if (/(白针|弟弟).*(死|去世)|(?:死|去世).*(白针|弟弟)/u.test(text) && /设备|操作失误/u.test(text)) return "";
      if (/真相/u.test(text) && /知道|告诉/u.test(text)) return "你是从谁那儿听来的？";
    }
    const reply = reaction(playerInput.at(-1)?.text ?? "");
    const danmakuDecisions = playerInput.map(({ id: danmakuId, text }): AgentTurnOutput["danmakuDecisions"][number] => {
      if (reaction(text) !== undefined) {
        return { danmakuId, decision: "defer", reason: "这句话触及白针，但没有提出现场调查。" };
      }
      if (proposedEvents.length) return { danmakuId, decision: "defer", reason: "等我先处理眼前这件事。" };
      // Players naturally ask to leave before the exit opens. Acknowledge the request
      // through the currently legal action that gets the character closer to leaving.
      const retreat = scene.id === "s04" && retreatAdvice.test(text) && !attackAdvice.test(text)
        ? availableActions.find(option => option.id === "e041" || option.id === "e032")
        : undefined;
      const terms = Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2));
      const ranked = availableActions.map(option => ({
        option, score: terms.filter(term => option.description.includes(term)).length,
      })).sort((left, right) => right.score - left.score);
      const match = retreat ?? (ranked[0]?.score ? ranked[0].option : undefined);
      if (!match) return { danmakuId, decision: "question", reason: "你建议我具体做什么？" };
      proposedEvents.push({ storyEventId: match.id, danmakuId });
      return { danmakuId, decision: "accept", reason: "这个建议对应当前可做的行动。" };
    });
    const accepted = proposedEvents[0]?.storyEventId;
    const clarification = scene.id === "s04"
      ? "他还在走廊上。你是要我跟他谈，还是帮我找撤离的机会？"
      : "你说的是哪条线索？再告诉我一点。";
    return JSON.stringify({
      narration: accepted ? actionReplies[accepted] ?? "好，我按你说的试一下。" : reply ?? clarification,
      ...(!proposedEvents.length && reply && { delivery: "hesitant" as const }),
      danmakuDecisions, proposedEvents, nextStep: { kind: "stay" }, memories: [], trustDelta: 0,
    } satisfies AgentTurnOutput);
  }

  const proposedEvents: AgentTurnOutput["proposedEvents"] = [];
  const danmakuDecisions = playerInput.map(({ id: danmakuId, text }): AgentTurnOutput["danmakuDecisions"][number] => {
    if (/(?:一定|肯定|断定)/u.test(text)) {
      return { danmakuId, decision: "reject", reason: "我还没找到能证实这个说法的东西。" };
    }
    if (action && /(?:翻面|翻过|翻看|反面|背面|翻.{0,4}便[签条]|便[签条].{0,4}翻)/u.test(text)) {
      if (proposedEvents.length) {
        return { danmakuId, decision: "accept", reason: "我会一并核对这条建议。" };
      }
      proposedEvents.push({ storyEventId: action.id, danmakuId });
      return { danmakuId, decision: "accept", reason: "我可以翻过便签确认。" };
    }
    if (/(?:可能|也许|会不会)/u.test(text)) {
      return { danmakuId, decision: "infer", reason: "便签上的「旧锁」可能和卡住的锁舌有关，我还要核实。" };
    }
    return { danmakuId, decision: "question", reason: "我该检查便签的哪一面？" };
  });
  return JSON.stringify({
    narration: proposedEvents.length ? "我看完了便签，接下来按上面的步骤试试。" : "我把便签留在手边，等一个具体的建议。",
    danmakuDecisions,
    proposedEvents,
    nextStep: { kind: "stay" },
    memories: [],
    trustDelta: 0,
  } satisfies AgentTurnOutput);
}));

export async function startReaderSession(clock = Date.now) {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (!session.busy && now - session.touchedAt >= sessionLifetime) sessions.delete(id);
  }
  const pack = await loadStoryPack(process.env.READER_STORY_PACK || "volunteer-17");
  if (sessions.size >= 256) return null;
  const id = randomUUID();
  const providerId = process.env.READER_LLM_PROVIDER?.trim() || "mock";
  let sessionRegistry = registry;
  if (providerId === "deepseek") {
    sessionRegistry = new ProviderRegistry();
    sessionRegistry.register(createDeepSeekProvider());
  }
  const session: ReaderSession = {
    engine: startSession(pack, createNarrativeAgent(pack, sessionRegistry, providerId), 30_000, clock),
    title: pack.manifest.title,
    character: pack.manifest.character.name,
    hasFirstInterventionLine: Boolean(pack.manifest.firstInterventionLine),
    sceneTitles: new Map(pack.scenes.map(({ id, title }) => [id, title])),
    idle: false,
    busy: false,
    touchedAt: Date.now(),
  };
  sessions.set(id, session);
  return readerView(id, session);
}

export function getReaderSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  if (!session.busy && Date.now() - session.touchedAt >= sessionLifetime) {
    sessions.delete(id);
    return;
  }
  session.touchedAt = Date.now();
  return session;
}

export function readerView(id: string, session: ReaderSession) {
  const { state, status, timeline, openEventIds, pendingDanmaku } = session.engine.getSnapshot();
  let mode: ReaderMode = "advancing";
  if (status === "completed") mode = "completed";
  else if (openEventIds.length) mode = pendingDanmaku.length ? "advancing" : "waiting_for_player";
  else if (session.idle) mode = "no_action";

  const entries = timeline.filter((entry): entry is ReaderEntry =>
    entry.type === "narrative_block" || entry.type === "danmaku_submitted" ||
    entry.type === "autonomous_action_executed" || entry.type === "session_completed",
  );
  // Story events in the order they happened, so the camera can stage the characters.
  const eventIds = timeline.flatMap(entry =>
    entry.type === "autonomous_action_executed" ? [entry.content.actionId]
      : entry.type === "intervention_triggered" ? [entry.content.storyEventId] : []);
  return {
    id,
    title: session.title,
    character: session.character,
    sceneId: state.currentSceneId,
    scene: session.sceneTitles.get(state.currentSceneId),
    revision: timeline.at(-1)?.sequence ?? 0,
    mode,
    nextStepDelayMs: session.engine.getAutonomousDelayMs(),
    chatReady: !session.hasFirstInterventionLine || timeline.some(entry => entry.type === "intervention_opened"),
    entries,
    eventIds,
    discoveredClueIds: state.discoveredClueIds,
    guidanceMail: progressMail(state),
  };
}

export type ReaderView = ReturnType<typeof readerView>;

export async function stepReader(session: ReaderSession, revision: number) {
  const snapshot = session.engine.getSnapshot();
  if (snapshot.status === "completed" || snapshot.timeline.at(-1)?.sequence !== revision) return;
  if (snapshot.openEventIds.length && snapshot.pendingDanmaku.length) {
    await session.engine.processIntervention();
    return;
  }
  if (session.idle || snapshot.openEventIds.length) return;
  const result = await session.engine.advanceAutonomousStep();
  session.idle = result.status === "no_action";
}

export async function submitReaderDanmaku(session: ReaderSession, text: string, requestId: string) {
  const { status, openEventIds } = session.engine.getSnapshot();
  if (status === "completed" || session.idle) return;
  session.engine.submitDanmaku({ kind: "intervention", text }, requestId);
  if (openEventIds.length) await session.engine.processIntervention();
}
