"use client";

import { ArrowUp, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { advanceRun, birdY, ground, jumpRun, runnerX, startRun, width, type Run } from "../../lib/reader/archive-runner-physics";

type Result = "ready" | "running" | "tree" | "bird" | "complete";

function draw(ctx: CanvasRenderingContext2D, run: Run) {
  ctx.fillStyle = "#e6eef0";
  ctx.fillRect(0, 0, width, 125);
  ctx.fillStyle = "#b6cad0";
  ctx.fillRect(0, 83, width, 3);
  ctx.fillStyle = "#6a8792";
  ctx.fillRect(0, ground, width, 2);

  const x = Math.round(run.obstacle.x);
  if (run.obstacle.kind === "tree") {
    ctx.fillStyle = "#6d5b52";
    ctx.fillRect(x + 9, ground - 15, 6, 15);
    ctx.fillStyle = "#377359";
    ctx.fillRect(x + 7, ground - 30, 10, 18);
    ctx.fillRect(x + 3, ground - 24, 18, 11);
    ctx.fillRect(x, ground - 18, 24, 7);
  } else {
    const wingY = Math.floor(x / 22) % 2 === 0 ? birdY : birdY + 8;
    ctx.fillStyle = "#465267";
    ctx.fillRect(x + 4, birdY + 4, 18, 6);
    ctx.fillRect(x + 3, birdY + 2, 7, 6);
    ctx.fillRect(x + 19, birdY + 3, 7, 3);
    ctx.fillRect(x + 12, wingY, 7, 5);
    ctx.fillStyle = "#9b6d4d";
    ctx.fillRect(x, birdY + 5, 4, 2);
  }

  const y = Math.round(ground - run.height - 23);
  ctx.fillStyle = "#26597b";
  ctx.fillRect(runnerX, y + 4, 21, 15);
  ctx.fillRect(runnerX + 5, y, 12, 4);
  ctx.fillRect(runnerX + 2, y + 19, 5, 4);
  ctx.fillRect(runnerX + 14, y + 19, 5, 4);
  ctx.fillStyle = "#d7f9ff";
  ctx.fillRect(runnerX + 11, y + 8, 6, 4);
}

export function ArchiveRunner({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef(startRun());
  const [result, setResult] = useState<Result>("ready");
  const jump = useCallback(() => {
    if (result !== "running") {
      run.current = startRun();
      setResult("running");
    }
    jumpRun(run.current);
  }, [result]);

  useEffect(() => {
    if (!active) return;
    function press(event: KeyboardEvent) {
      if (event.code !== "Space" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest("input, textarea, [contenteditable], select, a")) return;
        if (target.closest("button") && !target.closest(".archive-runner, .taskbar-browser, .taskbar-windows")) return;
      }
      event.preventDefault();
      if (!event.repeat) jump();
    }
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [active, jump]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    draw(ctx, run.current);
    if (!active || result !== "running") return;
    let frame: number;
    let lastTime: number | undefined;
    function animate(now: number) {
      const dt = lastTime === undefined ? 0 : Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;
      const state = run.current;
      const outcome = advanceRun(state, dt);
      draw(ctx!, state);
      if (outcome) {
        setResult(outcome);
        return;
      }
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [active, result]);

  const ActionIcon = result === "ready" ? Play : result === "running" ? ArrowUp : RotateCcw;
  const action = result === "ready" ? "开始" : result === "running" ? "跳跃" : "重玩";

  return <section className="archive-runner" aria-label="夜班越野">
    <canvas ref={canvas} width={width} height={125} aria-hidden="true" />
    <button className="archive-runner-action" type="button" aria-label={action} title={action} onClick={jump}>
      <ActionIcon size={17} aria-hidden="true" />
    </button>
    <span className="sr-only" role="status">{result === "tree" ? "撞到了树，再试一次。" :
      result === "bird" ? "撞到了飞鸟，再试一次。" :
      result === "complete" ? "三关全部通过。" : ""}</span>
  </section>;
}
