"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ReaderView } from "../../lib/reader/reader-session";
import { splitSpokenLines } from "../../lib/reader/dialogue";
import { DanmakuPanel, getReaderRecords, ScenePanel } from "./reader-panels";
import "./reader.css";
import "./reader-log-terminal.css";

const readerStatus = {
  advancing: "自主推进中",
  waiting_for_player: "",
  no_action: "当前没有可推进的行动",
  completed: "故事已结束",
};

type Command =
  | { action: "start" }
  | { action: "step"; id: string; revision: number }
  | { action: "danmaku"; id: string; requestId: string; text: string };

function useTypedHint(message: string, idle: string, active: boolean) {
  const [shown, setShown] = useState(0);
  const [caret, setCaret] = useState(true);
  useEffect(() => { setShown(0); }, [active, message]);
  useEffect(() => {
    if (!active) return;
    const timer = shown < message.length
      ? window.setTimeout(() => setShown(n => n + 1), 110)
      : window.setTimeout(() => setCaret(on => !on), 530);
    return () => window.clearTimeout(timer);
  }, [active, shown, caret, message]);
  if (!active) return idle;
  return message.slice(0, shown) + (caret || shown < message.length ? "▍" : "");
}

export function StoryPreview({ onComplete, onExit, onProgress }: {
  onComplete?: () => void; onExit?: () => void; onProgress?: (view: ReaderView) => void;
}) {
  const [frame, setFrame] = useState<{ view: ReaderView; previous?: ReaderView }>();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ command: Command; message: string; expired: boolean }>();
  const [outgoing, setOutgoing] = useState<string>();
  const [finishedLog, setFinishedLog] = useState<string>();
  const [deliveredThrough, setDeliveredThrough] = useState(0);
  const [spokenThrough, setSpokenThrough] = useState(0);
  const started = useRef(false);
  const busy = useRef(false);

  const send = useCallback(async (command: Command) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    if (command.action === "danmaku") {
      setOutgoing(command.text);
      setText(draft => draft.trim() === command.text ? "" : draft);
    }
    let expired = false;
    try {
      const response = await fetch("/api/reader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) {
        expired = response.status === 404;
        const { error } = await response.json().catch(() => ({}));
        throw new Error(error || "阅读器暂时无法连接，请重试。");
      }
      const next: ReaderView = await response.json();
      if (command.action === "start") {
        setDeliveredThrough(0);
        setSpokenThrough(0);
      }
      setFrame(current => ({ view: next, previous: current?.view.id === next.id ? current.view : undefined }));
    } catch (error) {
      if (command.action === "danmaku") setText(draft => draft || command.text);
      setFailure({
        command,
        message: error instanceof TypeError ? "阅读器暂时无法连接，请重试。" : (error as Error).message,
        expired,
      });
    } finally {
      busy.current = false;
      setPending(false);
      setOutgoing(undefined);
    }
  }, []);

  const view = frame?.view;
  const { story, messages } = getReaderRecords(view);
  const character = view?.character ?? "曲别针";
  const replies = messages.flatMap(entry => {
    if (entry.type !== "narrative_block" || entry.content.kind !== "narration") return [];
    const text = splitSpokenLines(entry.content.text, character)[0];
    return text ? [{ id: entry.id, sequence: entry.sequence, text }] : [];
  });
  const firstReply = replies[0];
  const latestReply = replies.at(-1);
  const pendingReply = !!latestReply && latestReply.sequence > deliveredThrough;
  const previous = frame?.previous;
  const holdAction = pendingReply && previous && latestReply.sequence > previous.revision &&
    latestReply.sequence !== firstReply.sequence;
  const visibleView = holdAction ? previous : view;
  const visibleStory = holdAction ? story.filter(entry => entry.sequence <= previous.revision) : story;
  const logKey = `${view?.id ?? ""}:${visibleStory.at(-1)?.sequence ?? 0}`;
  const logComplete = visibleStory.length === 0 || finishedLog === logKey;
  const holdOpening = firstReply && firstReply.sequence > deliveredThrough && !logComplete;
  const visibleMessages = holdOpening ? messages.filter(entry => entry.sequence < firstReply.sequence) : messages;

  useEffect(() => {
    if (view && logComplete && !pendingReply) onProgress?.(view);
  }, [view, logComplete, pendingReply, onProgress]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send({ action: "start" });
  }, [send]);

  useEffect(() => {
    if (!view || view.mode !== "advancing" || pending || failure || !logComplete || pendingReply) return;
    const timer = window.setTimeout(() => {
      void send({ action: "step", id: view.id, revision: view.revision });
    }, Math.max(1400, view.nextStepDelayMs ?? 0));
    return () => window.clearTimeout(timer);
  }, [view, pending, failure, logComplete, pendingReply, send]);

  useEffect(() => {
    if (view?.mode === "completed") onComplete?.();
  }, [view?.mode, onComplete]);

  const inputReady = view?.chatReady === true && logComplete && !pendingReply;
  const canSend = inputReady && (view?.mode === "advancing" || view?.mode === "waiting_for_player") && !pending && !failure;
  const channelOpen = canSend && view.mode === "waiting_for_player";
  const status = visibleView ? (visibleView.mode === "waiting_for_player" ? "" : readerStatus[visibleView.mode])
    : failure ? "会话启动失败" : "正在开启故事…";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || !canSend || !text.trim()) return;
    void send({ action: "danmaku", id: view.id, text: text.trim(), requestId: crypto.randomUUID() });
  }

  // When it is the player's turn, the hint types itself out like a message being written.
  const typedHint = useTypedHint(`现在告诉${character}你的想法`,
    view?.chatReady ? `给${character}发一条弹幕` : "等待曲别针接通…", channelOpen);
  return (
    <main className="reader" aria-label={view?.title ?? "叙事记录"}>
      <div className="reader-layout">
        <ScenePanel
          key={view?.id}
          scene={visibleView?.scene}
          sceneId={visibleView?.sceneId}
          eventIds={visibleView?.eventIds}
          reply={replies.findLast(reply => reply.sequence <= spokenThrough)}
          story={visibleStory}
          logKey={logKey}
          status={status}
          onLogComplete={setFinishedLog}
          onExit={onExit}
          onRestart={visibleView?.mode === "completed" && logComplete ? () => window.location.reload() : undefined}
          error={failure && (
            <div className="mt-4">
              <p className="reader-fault" role="alert">{failure.message}</p>
              <button type="button" onClick={() => void send(failure.expired ? { action: "start" } : failure.command)}>
                {failure.expired ? "重新开始" : "重试"}
              </button>
            </div>
          )}
        />
        <aside className="reader-side" aria-label="弹幕">
          <DanmakuPanel
            key={view?.id}
            messages={visibleMessages}
            onRepliesDelivered={setDeliveredThrough}
            onReplyStarted={setSpokenThrough}
            character={view?.character}
            outgoing={outgoing}
            channelOpen={channelOpen}
            input={
              <form className={`reader-form${channelOpen ? " is-open" : ""}`} onSubmit={submit}>
                <input
                  aria-label="弹幕"
                  disabled={view?.mode === "completed" || view?.mode === "no_action"}
                  maxLength={500}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={typedHint}
                  value={text}
                />
                <button type="submit" disabled={!canSend || !text.trim()}>发送</button>
              </form>
            }
          />
        </aside>
      </div>
    </main>
  );
}
