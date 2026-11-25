import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ReaderView } from "../../lib/reader/reader-session";
import type { NarrativeBlock } from "../../lib/engine/narrative-block";
import { splitSpokenLines } from "../../lib/reader/dialogue";
import { formatTime, StudyFeed } from "./study-feed";
import { SoundToggle } from "./camera-feed";
import { playRefusalAlarm, playTypeKey } from "../../lib/reader/audio";

// Right-hand control strip of the CRT: two dials, a power lamp, the sound button and a speaker grille.
function TvPanel() {
  return (
    <div className="reader-tv-panel">
      <span className="reader-tv-knob" aria-hidden="true" />
      <span className="reader-tv-knob is-small" aria-hidden="true" />
      <span className="reader-tv-led" aria-hidden="true" />
      <SoundToggle />
      <span className="reader-tv-grille" aria-hidden="true" />
    </div>
  );
}

type Entry = ReaderView["entries"][number];
type Clue = Extract<NarrativeBlock, { kind: "clue" }>;

const followThreshold = 48;
// Typewriter rhythm: a short, uneven gap per key, longer rests after punctuation.
function keyDelay(typed: string) {
  if (/[。！？…]/.test(typed)) return 380;
  if (/[，、；：]/.test(typed)) return 180;
  if (typed === "\n") return 260;
  return 50 + Math.random() * 35;
}

function isTurnReply(entry: Entry) {
  // The Timeline links scene openings to session start or scene transition.
  return entry.type === "narrative_block" && entry.content.kind === "narration" && entry.causedBy === undefined;
}

export function getReaderRecords(view?: ReaderView) {
  const entries = view?.entries ?? [];
  const story: Entry[] = [];
  const messages: Entry[] = [];
  for (const entry of entries) {
    if (entry.type === "narrative_block" &&
        (entry.content.kind === "decision" || entry.content.kind === "ai_inference")) continue;
    if (entry.type === "danmaku_submitted" || isTurnReply(entry) ||
        (entry.type === "narrative_block" && entry.content.kind === "system_event")) {
      messages.push(entry);
    } else {
      story.push(entry);
    }
  }
  return { story, messages };
}

type StoryLine = { id: number | string } & (
  | { kind: "text"; text: string }
  | { kind: "ending"; text: string }
  | { kind: "image"; src: string; alt: string }
);

const recordToken = /([“「][^”」\n]{1,48}[”」]|曲别针|白针|黑针|(?:第)?\d+(?:号|楼)|非设备相关|原始记录|设备异常)/gu;

function highlightRecord(text: string) {
  return text.split(recordToken).map((part, index) => {
    if (index % 2 === 0) return part;
    const tone = /^[“「]/u.test(part) || part === "非设备相关" ? "quote"
      : /\d/u.test(part) ? "numeric" : "keyword";
    return <span key={index} className={`reader-record-${tone}`}>{part}</span>;
  });
}

function toStoryLog(story: Entry[]) {
  const lines: StoryLine[] = [];
  const clues: { clue: Clue; afterLine: number }[] = [];
  function appendText(id: number, text: string) {
    text.split(/\r?\n/u).forEach((part, index) => lines.push({ id: `${id}:${index}`, kind: "text", text: part }));
  }
  for (const entry of story) {
    if (entry.type === "autonomous_action_executed") appendText(entry.id, entry.content.result);
    if (entry.type === "session_completed") lines.push({ id: entry.id, kind: "ending", text: `结局 · ${entry.content.title}` });
    if (entry.type !== "narrative_block") continue;
    const block = entry.content;
    if (block.kind === "clue") clues.push({ clue: block, afterLine: lines.length });
    else if (block.kind === "visual") lines.push({ id: entry.id, kind: "image", src: block.src, alt: block.alt });
    else if ("text" in block) appendText(entry.id, block.text);
  }
  return { lines, clues };
}

// Keeps a scroll container pinned to its newest content unless the reader scrolled up.
function useFollow(dependency: unknown) {
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const viewport = log.current;
    if (viewport && following.current) viewport.scrollTop = viewport.scrollHeight;
  }, [dependency]);
  const onScroll = () => {
    const viewport = log.current;
    if (!viewport) return;
    following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= followThreshold;
  };
  return { log, onScroll };
}

export function ScenePanel({ scene, sceneId, eventIds, reply, story, logKey, status, onLogComplete, error, onExit, onRestart }: {
  reply?: { id: number; text: string };
  scene?: string;
  sceneId?: string;
  eventIds?: readonly string[];
  story: Entry[];
  logKey: string;
  status: string;
  onLogComplete: (key: string) => void;
  onExit?: () => void;
  onRestart?: () => void;
  error?: ReactNode;
}) {
  const { lines, clues: clueMarkers } = toStoryLog(story);
  // Lines before `shown` are complete; line `shown` is being typed up to `chars`.
  const [shown, setShown] = useState(0);
  const [chars, setChars] = useState(0);
  const [tab, setTab] = useState<"story" | "clues">("story");
  const clues = clueMarkers.filter(({ afterLine }) => afterLine <= shown).map(({ clue }) => clue);
  // A clue found while the clue tab is closed lights up its button until it is opened.
  const [seenClues, setSeenClues] = useState(0);
  useEffect(() => { if (tab === "clues") setSeenClues(clues.length); }, [tab, clues.length]);
  const unreadClues = tab === "story" ? Math.max(0, clues.length - seenClues) : 0;
  const typing = shown < lines.length;
  const current = lines[shown];

  useEffect(() => {
    if (current?.kind !== "text" || !current.text.startsWith("研究中心广播突然响起")) return;
    const stop = playRefusalAlarm();
    let stopped = false;
    const finish = () => { if (!stopped) { stopped = true; stop?.(); } };
    const timer = window.setTimeout(finish, 4000);
    return () => { window.clearTimeout(timer); finish(); };
  }, [current?.id]);

  useEffect(() => {
    if (!typing) onLogComplete(logKey);
  }, [typing, logKey, onLogComplete]);

  const currentLength = current ? (current.kind === "text" ? current.text.length : -1) : undefined;
  useEffect(() => {
    if (currentLength === undefined) return;
    if (chars >= currentLength) {
      const timer = window.setTimeout(() => { setShown(n => n + 1); setChars(0); }, currentLength > 0 ? 320 : 0);
      return () => window.clearTimeout(timer);
    }
    const text = current?.kind === "text" ? current.text : "";
    const timer = window.setTimeout(() => {
      const next = text[chars];
      if (next && next.trim()) playTypeKey();
      setChars(n => n + 1);
    }, chars === 0 ? 120 : keyDelay(text[chars - 1] ?? ""));
    return () => window.clearTimeout(timer);
    // `current` is rebuilt each render; its identity is captured by `shown` and its length.
  }, [shown, currentLength, chars]);

  const { log, onScroll } = useFollow(`${shown}:${chars}:${lines.length}:${!!error}`);
  const skip = () => { setShown(lines.length); setChars(0); };

  const renderLine = (line: StoryLine, index: number, partial?: number) => {
    const active = partial !== undefined;
    const suffix = line.kind === "ending" ? "}"
      : line.kind === "text" && line.text && index % 3 === 0 ? ";" : "";
    return (
      <div key={line.id} className={`reader-record-row${active ? " is-current" : ""}`}>
        <span className="reader-record-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <div className="reader-record-content">
          {line.kind === "image" ? <img src={line.src} alt={line.alt} /> : (
            <p className={line.kind === "ending" ? "reader-ending" : undefined}>
              {highlightRecord(active ? line.text.slice(0, Math.max(0, partial - 1)) : line.text)}
              {active && partial > 0 && <span key={partial} className="reader-ink">{line.text[partial - 1]}</span>}
              {active ? <span className="reader-caret" aria-hidden="true" /> : suffix && (
                <span className="reader-record-suffix" aria-hidden="true">{suffix}</span>
              )}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="reader-panel reader-scene-panel" aria-label="监控与现场记录">
      <div className="reader-device reader-camera-device reader-tv">
        <div className="reader-tv-body">
          <div className="reader-tv-screen">
            <StudyFeed sceneId={sceneId} scene={scene} eventIds={eventIds} reply={reply} onExit={onExit} />
            <div className="reader-tv-glass" aria-hidden="true" />
          </div>
          <TvPanel />
        </div>
      </div>
      <article className="reader-paper reader-story reader-log-terminal" aria-label="现场记录与线索">
        <div className="reader-tabs" role="tablist" aria-label="切换记录">
          <button type="button" role="tab" id="tab-story" aria-selected={tab === "story"} aria-controls="panel-story"
            onClick={() => setTab("story")}>现场记录</button>
          <button type="button" role="tab" id="tab-clues" aria-selected={tab === "clues"} aria-controls="panel-clues"
            className={unreadClues ? "has-new" : undefined} onClick={() => setTab("clues")}>
            <span className="reader-clue-tab-content" key={clues.length}>
              已发现线索{unreadClues > 0 && <span className="reader-tab-count" role="status">{unreadClues} 未读</span>}
            </span>
          </button>
        </div>
        {tab === "clues" && (clues.length === 0 ? <p id="panel-clues" role="tabpanel" aria-labelledby="tab-clues" className="reader-scroll reader-empty">暂无线索。</p> : (
          <ol id="panel-clues" role="tabpanel" aria-labelledby="tab-clues" className="reader-list reader-scroll reader-clue-list" tabIndex={0}>
            {clues.map((clue, index) => (
              <li key={clue.clueId}>
                <span className="reader-clue-no">线索 {String(index + 1).padStart(2, "0")}</span>
                <p>{clue.text}</p>
              </li>
            ))}
          </ol>
        ))}
        <div ref={log} onScroll={onScroll} onClick={typing ? skip : undefined} hidden={tab !== "story"}
          id="panel-story" aria-labelledby="tab-story"
          className="reader-scroll reader-story-log" role="log" tabIndex={0} aria-label="曲别针的剧情"
          title={typing ? "点击显示全部" : undefined}>
          {lines.slice(0, shown).map((line, index) => renderLine(line, index))}
          {current && current.kind === "text" && renderLine(current, shown, chars)}
          {!typing && !error && <div className="reader-record-row is-current" aria-hidden="true">
            <span className="reader-record-number">{String(lines.length + 1).padStart(2, "0")}</span>
            <div className="reader-record-content reader-log-prompt"><span>&gt;</span><span className="reader-caret" /></div>
          </div>}
          {error}
        </div>
        {((tab === "story" && (status || typing)) || onRestart) && <footer className="reader-paper-footer">
          <span className="reader-status" role="status">{status}</span>
          {tab === "story" && typing && <button type="button" className="reader-skip" onClick={skip}>显示全部</button>}
          {onRestart && <button type="button" className="reader-skip" onClick={onRestart}>重新开始</button>}
        </footer>}
      </article>
    </section>
  );
}

export function DanmakuPanel({ messages, character, input, outgoing, channelOpen, onRepliesDelivered, onReplyStarted }: {
  messages: Entry[];
  character?: string;
  input: ReactNode;
  outgoing?: string;
  channelOpen: boolean;
  onRepliesDelivered: (sequence: number) => void;
  onReplyStarted?: (sequence: number) => void;
}) {
  const [released, setReleased] = useState(0);
  let total = 0;
  let nextDelay = 0;
  let latestStarted = 0;
  let latestDelivered = 0;
  const visible = toChatLines(messages, character).flatMap<ChatLine>(line => {
    if (line.kind !== "them") return [line];
    const count = released - total;
    total += line.lines.length;
    if (count > 0) latestStarted = line.sequence;
    if (released >= total) latestDelivered = line.sequence;
    if (count >= 0 && count < line.lines.length) {
      nextDelay = count > 0 ? 450 : line.delivery === "hesitant" ? 1100 : 0;
    }
    return count > 0 ? [{ ...line, lines: line.lines.slice(0, count) }] : [];
  });
  const delivering = released < total;
  useEffect(() => {
    if (!delivering) return;
    const timer = window.setTimeout(() => setReleased(count => count + 1), nextDelay);
    return () => window.clearTimeout(timer);
  }, [delivering, nextDelay, released]);
  useEffect(() => {
    onReplyStarted?.(latestStarted);
  }, [latestStarted, onReplyStarted]);
  useEffect(() => {
    onRepliesDelivered(latestDelivered);
  }, [latestDelivered, onRepliesDelivered]);
  const { log, onScroll } = useFollow(`${messages.at(-1)?.sequence}:${outgoing}:${released}`);

  return (
    <section className={`reader-panel reader-device reader-terminal${channelOpen ? " is-open" : ""}`} aria-label="弹幕记录">
      <div
        ref={log}
        id="reader-danmaku-log"
        className="reader-scroll reader-danmaku-log"
        role="log"
        aria-label="实时弹幕"
        tabIndex={0}
        onScroll={onScroll}
      >
        {visible.length === 0 && !outgoing ? <p className="reader-empty">暂无弹幕。</p> : (
          <ol className="reader-chat">
            {visible.map(line => <ChatRecord key={line.id} line={line} character={character} />)}
            {outgoing && <li className="is-me is-sending"><div className="reader-meta">你 · 发送中</div><p>{outgoing}</p></li>}
          </ol>
        )}
      </div>
      <footer className="reader-danmaku-footer">
        {input}
      </footer>
    </section>
  );
}

type ChatLine =
  | { kind: "me"; id: number; time: string; text: string }
  | { kind: "them"; id: number; sequence: number; time: string; lines: string[]; delivery?: "direct" | "hesitant" }
  | { kind: "system"; id: number; text: string };

function toChatLines(entries: Entry[], character?: string): ChatLine[] {
  const lines: ChatLine[] = [];
  for (const entry of entries) {
    if (entry.type === "danmaku_submitted") {
      lines.push({ kind: "me", id: entry.id, time: entry.timestamp, text: entry.content.text });
      continue;
    }
    if (entry.type !== "narrative_block") continue;
    const block = entry.content;
    if (block.kind === "system_event") lines.push({ kind: "system", id: entry.id, text: block.text });
    else if (block.kind === "narration") {
      const spoken = splitSpokenLines(block.text, character);
      if (spoken.length) lines.push({ kind: "them", id: entry.id, sequence: entry.sequence, time: entry.timestamp, lines: spoken, delivery: block.delivery });
    }
  }
  return lines;
}

function ChatRecord({ line, character }: { line: ChatLine; character?: string }) {
  if (line.kind === "system") return <li className="is-system"><p>{line.text}</p></li>;
  const time = <time dateTime={line.time}>{formatTime(line.time)}</time>;
  if (line.kind === "me") return <li className="is-me"><div className="reader-meta">你 · {time}</div><p>{line.text}</p></li>;
  return (
    <li className="is-them">
      <div className="reader-meta">{character} · {time}</div>
      {line.lines.map((text, index) => <p key={index}>{text}</p>)}
    </li>
  );
}
