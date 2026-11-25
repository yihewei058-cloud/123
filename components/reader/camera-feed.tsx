"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  CAMERA_HEIGHT, CAMERA_WIDTH, drawFigure, drawFlashlight, drawInterference, drawShell, figureScale, guard,
  guardLook, protagonistLook, pursuerLook, sceneProps, type Drawable, type Pose,
} from "../../lib/reader/camera-scene";
import { cueFor, mutters, pokeLines, staging, type ActorCue, type Walkable } from "../../lib/reader/camera-staging";
import { isMuted, onMutedChange, playFootstep, setMuted, speakLine } from "../../lib/reader/audio";

type Speech = { text: string; shown: number; nextAt: number; holdUntil: number };

// A reply is long; overhead he only says its first sentence.
function firstSentence(text: string) {
  const sentence = text.match(/^[^。！？!?]*[。！？!?]?/)?.[0] ?? text;
  return sentence.length > 22 ? `${sentence.slice(0, 21)}…` : sentence;
}

type Actor = {
  x: number; y: number;
  face: 1 | -1;
  step: number;
  visible: boolean;
  target?: ActorCue;
  // A short stroll inserted when the viewer clicks the character; walked before returning to the target.
  detour?: [number, number][];
  // Idle wandering: a spot he decided to walk to, how fast, and how long he waits before moving on.
  wander?: [number, number];
  pace: number;
  restUntil: number;
  wasWalking: boolean;
  footfall: number;
};

const newActor = (): Actor => ({ x: 0, y: 0, face: 1, step: 0, visible: false, pace: 1, restUntil: 0, wasWalking: false, footfall: 0 });

const WALK_SPEED = 24; // camera pixels per second
const RUN_SPEED = 54;
const FRAME_MS = 1000 / 12; // a low frame rate reads as security footage

const inBox = (x: number, y: number, [x0, y0, x1, y1]: number[]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// Picks a nearby open spot that can be reached in a straight line without crossing furniture.
function pickWanderSpot(actor: Actor, home: [number, number], walk: Walkable): [number, number] | undefined {
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = Math.min(walk.maxX, Math.max(walk.minX, home[0] + (Math.random() - 0.5) * 150));
    const y = Math.min(walk.maxY, Math.max(walk.minY, home[1] + (Math.random() - 0.5) * 30));
    if (Math.hypot(x - actor.x, y - actor.y) < 14) continue;
    let clear = true;
    for (let t = 0; t <= 1 && clear; t += 0.05) {
      const px = actor.x + (x - actor.x) * t, py = actor.y + (y - actor.y) * t;
      if (t > 0.1 && walk.avoid.some(box => inBox(px, py, box))) clear = false;
    }
    if (clear) return [x, y];
  }
}

// He only strolls when nothing urgent is happening: no pursuer, no hiding, no weapon drawn.
function canWander(target: ActorCue | undefined, pursuerVisible: boolean) {
  if (!target || target.exit || target.run || pursuerVisible) return false;
  return target.pose === undefined || target.pose === "stand" || target.pose === "read" || target.pose === "phone";
}

function moveActor(actor: Actor, dt: number, now: number, walk?: Walkable, wanderAllowed = false) {
  const target = actor.target;
  if (!actor.visible || !target) return false;
  const stroll = actor.detour?.[0];
  const [tx, ty] = stroll ?? actor.wander ?? target.at;
  const dx = tx - actor.x, dy = ty - actor.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) {
    if (stroll) { actor.detour!.shift(); return true; }
    if (actor.wander) actor.wander = undefined;
    else if (target.exit) { actor.visible = false; return false; }
    if (actor.wasWalking) { actor.restUntil = now + 1800 + Math.random() * 4200; actor.wasWalking = false; }
    if (walk && wanderAllowed && now > actor.restUntil) {
      const roll = Math.random();
      if (roll < 0.25) {
        actor.face = actor.face === 1 ? -1 : 1; // glance the other way
        actor.restUntil = now + 1200 + Math.random() * 2000;
      } else if (roll < 0.45 && Math.hypot(actor.x - target.at[0], actor.y - target.at[1]) > 6) {
        actor.wander = [...target.at]; // drift back to where the story put him
        actor.pace = 0.8 + Math.random() * 0.25;
      } else {
        actor.wander = pickWanderSpot(actor, target.at, walk);
        actor.pace = 0.7 + Math.random() * 0.35;
        if (!actor.wander) actor.restUntil = now + 1500;
      }
    }
    return false;
  }
  actor.wasWalking = true;
  const speed = stroll ? WALK_SPEED : actor.wander ? WALK_SPEED * actor.pace : target.run ? RUN_SPEED : WALK_SPEED;
  const travel = Math.min(distance, speed * dt);
  actor.x += (dx / distance) * travel;
  actor.y += (dy / distance) * travel;
  actor.step += travel * 0.45;
  if (Math.abs(dx) > 0.5) actor.face = dx > 0 ? 1 : -1;
  return true;
}

function poseOf(actor: Actor, walking: boolean): Pose {
  const pose = actor.target?.pose ?? "stand";
  if (!walking) return pose;
  return pose === "knife" ? "knife" : "stand";
}

// Converts a click on the scaled canvas into camera pixels, honouring object-fit and object-position.
function toCameraPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const box = canvas.getBoundingClientRect();
  const style = getComputedStyle(canvas);
  const fit = style.objectFit;
  let sx = box.width / CAMERA_WIDTH, sy = box.height / CAMERA_HEIGHT;
  if (fit === "cover" || fit === "contain") sx = sy = (fit === "cover" ? Math.max : Math.min)(sx, sy);
  const [px, py] = style.objectPosition.split(" ").map(v => v.endsWith("%") ? parseFloat(v) / 100 : 0.5);
  const offsetX = (box.width - CAMERA_WIDTH * sx) * px;
  const offsetY = (box.height - CAMERA_HEIGHT * sy) * py;
  return { x: (clientX - box.left - offsetX) / sx, y: (clientY - box.top - offsetY) / sy };
}

function hitsActor(actor: Actor, x: number, y: number) {
  if (!actor.visible || actor.target?.pose === "down") return false;
  const scale = figureScale(actor.y);
  return Math.abs(x - actor.x) <= 8 * scale && y <= actor.y + 3 && y >= actor.y - 36 * scale;
}

export function CameraFeed({ sceneId, eventIds = [], reply, whitePinAtEntrance = false, surfaceRef }: {
  sceneId: string;
  whitePinAtEntrance?: boolean;
  eventIds?: readonly string[];
  reply?: { id: number; text: string };
  surfaceRef?: RefObject<HTMLCanvasElement | null>;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const speech = useRef<Speech | null>(null);
  const nextMutterAt = useRef(0);
  const lastReply = useRef(reply?.id);

  // When he answers the player, he says the reply out loud over his head.
  useEffect(() => {
    if (!reply || reply.id === lastReply.current) return;
    lastReply.current = reply.id;
    speech.current = { text: firstSentence(reply.text), shown: 0, nextAt: performance.now() + 300, holdUntil: 0 };
  }, [reply]);

  const localCanvas = useRef<HTMLCanvasElement>(null);
  const canvas = surfaceRef ?? localCanvas;
  const room = useRef<{ scene: string; image: HTMLCanvasElement } | null>(null);
  const qu = useRef<Actor>(newActor());
  const hei = useRef<Actor>(newActor());
  const shownScene = useRef<string | null>(null);

  const scene = staging[sceneId];
  const cue = cueFor(sceneId, eventIds);
  const cueKey = JSON.stringify(cue);

  // Apply the newest stage directions whenever the story moves on.
  useEffect(() => {
    if (!scene || !cue) return;
    const firstShot = shownScene.current === null;
    if (shownScene.current !== sceneId) {
      shownScene.current = sceneId;
      const [x, y] = firstShot ? cue.qu.at : scene.enterFrom;
      Object.assign(qu.current, { x, y, step: 0, visible: true });
      hei.current.visible = false;
    }
    qu.current.target = cue.qu;
    qu.current.wander = undefined;
    qu.current.restUntil = 0;
    qu.current.visible ||= !cue.qu.exit;

    const pursuer = hei.current;
    if (cue.hei) {
      if (!pursuer.visible) {
        const [x, y] = firstShot ? cue.hei.at : scene.heiEnter ?? scene.heiExit;
        Object.assign(pursuer, { x, y, step: 0, visible: true, face: x < cue.qu.at[0] ? 1 : -1 });
      }
      pursuer.target = cue.hei;
    } else if (pursuer.visible) {
      pursuer.target = { at: scene.heiExit, exit: true };
    }
    // cueKey captures every field of the cue, so the effect reruns only when the directions change.
  }, [sceneId, cueKey]);

  useEffect(() => {
    const target = canvas.current;
    const ctx = target?.getContext("2d");
    if (!target || !ctx || !scene) return;
    const sceneNumber = Number(sceneId.slice(1));
    if (room.current?.scene !== sceneId) {
      const image = document.createElement("canvas");
      image.width = CAMERA_WIDTH;
      image.height = CAMERA_HEIGHT;
      drawShell(image.getContext("2d")!, sceneNumber);
      room.current = { scene: sceneId, image };
    }
    const props = sceneProps(sceneNumber);
    nextMutterAt.current = performance.now() + 3000 + Math.random() * 3000;
    let lastMutter = "";

    // Speech bubble: he says the line aloud while it types out, then it lingers and disappears.
    const updateSpeech = (now: number) => {
      const el = bubble.current;
      const actor = qu.current;
      const pool = whitePinAtEntrance ? undefined : mutters[sceneId];
      if (!speech.current && pool && actor.visible && now > nextMutterAt.current
          && canWander(actor.target, hei.current.visible)) {
        // Never the same line twice in a row.
        const options = pool.filter(text => text !== lastMutter);
        lastMutter = options[Math.floor(Math.random() * options.length)];
        speech.current = { text: lastMutter, shown: 0, nextAt: now, holdUntil: 0 };
      }
      const line = speech.current;
      if (!el) return;
      if (!line || !actor.visible) { el.hidden = true; return; }
      if (line.shown === 0 && now >= line.nextAt) speakLine(line.text.replace(/…$/, ""));
      if (line.shown < line.text.length && now >= line.nextAt) {
        const char = line.text[line.shown];
        line.shown++;
        line.nextAt = now + (/[，。！？…]/.test(char) ? 260 : 95);
        if (line.shown === line.text.length) line.holdUntil = now + 3200;
      }
      if (line.holdUntil && now > line.holdUntil) {
        speech.current = null;
        nextMutterAt.current = now + 6000 + Math.random() * 7000;
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.textContent = line.text.slice(0, line.shown);
      // Place the bubble above his head, mapping camera pixels onto the scaled canvas.
      const view = target;
      const style = getComputedStyle(view);
      const k = (style.objectFit === "cover" ? Math.max : Math.min)(view.clientWidth / CAMERA_WIDTH, view.clientHeight / CAMERA_HEIGHT);
      const [px, py] = style.objectPosition.split(" ").map(v => v.endsWith("%") ? parseFloat(v) / 100 : 0.5);
      const left = view.offsetLeft + (view.clientWidth - CAMERA_WIDTH * k) * px + actor.x * k;
      const top = view.offsetTop + (view.clientHeight - CAMERA_HEIGHT * k) * py + (actor.y - 40 * figureScale(actor.y)) * k;
      el.style.left = `${Math.min(view.offsetLeft + view.clientWidth - 70, Math.max(view.offsetLeft + 70, left))}px`;
      el.style.top = `${Math.max(view.offsetTop + 30, top)}px`;
    };
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();
    let sinceDraw = FRAME_MS;
    let tick = 0;

    const render = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const walkingQu = moveActor(qu.current, dt, now, scene.walk, canWander(qu.current.target, hei.current.visible));
      const walkingHei = moveActor(hei.current, dt, now);
      // A footfall lands twice per stride; louder when close to the camera, panned by position.
      for (const [actor, walking, heavy] of [[qu.current, walkingQu, false], [hei.current, walkingHei, true]] as const) {
        const footfall = Math.floor(actor.step / Math.PI);
        if (footfall !== actor.footfall) {
          actor.footfall = footfall;
          if (walking && actor.visible) {
            playFootstep({ pan: actor.x / (CAMERA_WIDTH / 2) - 1, level: 0.08 + 0.16 * (figureScale(actor.y) / 2.4), heavy });
          }
        }
      }
      sinceDraw += dt * 1000;
      if (sinceDraw >= FRAME_MS) {
        sinceDraw = 0;
        tick++;
        ctx.drawImage(room.current!.image, 0, 0);

        const cast = [
          { actor: qu.current, walking: walkingQu, look: whitePinAtEntrance ? { ...protagonistLook, wire: 9 } : protagonistLook },
          { actor: hei.current, walking: walkingHei, look: pursuerLook },
        ].filter(({ actor }) => actor.visible).sort((a, b) => a.actor.y - b.actor.y);
        // Idle characters turn toward each other.
        if (cast.length === 2) {
          for (const [me, other] of [[cast[0], cast[1]], [cast[1], cast[0]]]) {
            if (!me.walking) me.actor.face = other.actor.x > me.actor.x ? 1 : -1;
          }
        }
        // Furniture and characters are painted back to front, so anyone can stand behind a desk.
        const layers: Drawable[] = [...props];
        if (sceneNumber === 6) {
          layers.push({ baseY: guard.fy, draw: c => drawFigure(c, {
            ...guard, face: 1, pose: "stand", step: 0, walking: false, look: guardLook, tick: Math.floor(tick / 6),
          }) });
        }
        for (const { actor, walking, look } of cast) {
          const pose = poseOf(actor, walking);
          // A slight bob on each step keeps the walk from looking like a glide.
          const bob = walking ? Math.abs(Math.sin(actor.step)) * 1.2 * figureScale(actor.y) : 0;
          layers.push({ baseY: actor.y, draw: c => {
            drawFigure(c, {
              fx: Math.round(actor.x), fy: Math.round(actor.y - bob), face: actor.face,
              pose, step: actor.step, walking, look, tick,
            });
            if (look.flashlight && pose !== "down" && pose !== "crouch") drawFlashlight(c, actor.x, actor.y, actor.face, now);
          } });
        }
        layers.sort((a, b) => a.baseY - b.baseY).forEach(item => item.draw(ctx));
        updateSpeech(now);
        if (!reduceMotion) drawInterference(ctx, now, Math.random);
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [canvas, scene, sceneId, whitePinAtEntrance]);

  // Clicking the protagonist makes him take a few steps away and come back.
  const stroll = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCameraPoint(event.currentTarget, event.clientX, event.clientY);
    const actor = qu.current;
    if (!hitsActor(actor, x, y)) return;
    // Poking him also makes him say something: half reactions to being watched, half scene thoughts.
    if (!speech.current) {
      const pool = Math.random() < 0.5 ? pokeLines : (mutters[sceneId] ?? pokeLines);
      speech.current = { text: pool[Math.floor(Math.random() * pool.length)], shown: 0, nextAt: performance.now(), holdUntil: 0 };
    }
    if (actor.detour?.length) return;
    const home: [number, number] = [actor.x, actor.y];
    const side = actor.x > CAMERA_WIDTH - 40 ? -1 : actor.x < 40 ? 1 : (Math.random() < 0.5 ? -1 : 1);
    const depth = actor.y > 150 ? -6 : 6;
    actor.detour = [[actor.x + side * 18, actor.y + depth], [actor.x + side * 10, actor.y], home];
  };
  const hover = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCameraPoint(event.currentTarget, event.clientX, event.clientY);
    event.currentTarget.style.cursor = hitsActor(qu.current, x, y) ? "pointer" : "";
  };

  return <>
    <canvas ref={canvas} className="camera-image" width={CAMERA_WIDTH} height={CAMERA_HEIGHT}
      role="img" aria-label={whitePinAtEntrance ? "白针在研究中心正门的监控画面" : "研究中心监控实时画面"}
      onPointerDown={whitePinAtEntrance ? undefined : stroll} onPointerMove={whitePinAtEntrance ? undefined : hover} />
    <div ref={bubble} className="camera-bubble" role="status" aria-live="polite" hidden />
  </>;
}

// Push button on the TV panel that mutes the score and footsteps.
export function SoundToggle() {
  const [muted, setState] = useState(false);
  useEffect(() => {
    setState(isMuted());
    return onMutedChange(setState);
  }, []);
  return (
    <button type="button" className="reader-tv-button" aria-pressed={!muted} onClick={() => setMuted(!muted)}
      aria-label={muted ? "打开声音" : "关闭声音"} title={muted ? "打开声音" : "关闭声音"}>
      {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
    </button>
  );
}

// In-fiction clock: the night shift starts at 21:30 when the page opens.
const shiftStart = typeof performance === "undefined" ? 0 : performance.now();
export function useShiftClock(withSeconds = true) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(performance.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const total = 21 * 3600 + 30 * 60 + Math.floor(((now ?? shiftStart) - shiftStart) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = pad(Math.floor(total / 3600) % 24), mm = pad(Math.floor(total / 60) % 60), ss = pad(total % 60);
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}
