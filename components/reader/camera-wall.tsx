import { useEffect, useRef, useState, type RefObject } from "react";
import { playFootstep } from "../../lib/reader/audio";
import {
  CAMERA_HEIGHT, CAMERA_WIDTH, drawFigure, drawFlashlight, drawInterference, drawShell,
  protagonistLook, pursuerLook, sceneProps, type Drawable,
} from "../../lib/reader/camera-scene";
import { cueFor, firstHallPursuerStop } from "../../lib/reader/camera-staging";
import "./camera-wall.css";

const channels = [
  { id: "s01", title: "一楼档案室" },
  { id: "s02", title: "一楼走廊、办公区与楼梯间" },
  { id: "s03", title: "二楼观察室与实验区" },
  { id: "s04", title: "二楼实验区走廊" },
  { id: "s05", title: "地下设备室" },
  { id: "s06", title: "地下走廊与一楼大厅" },
] as const;

type Channel = typeof channels[number]["id"];
type Surface = RefObject<HTMLCanvasElement | null>;

type Sighting = {
  scene: string;
  event: string;
  channel: Channel;
  actor: "黑针" | "曲别针";
  from: readonly [number, number];
  to: readonly [number, number];
  duration: number;
  exits?: boolean;
};
const offscreenSightings: readonly Sighting[] = [
  { scene: "s01", event: "e008", channel: "s02", actor: "黑针",
    from: [294, 129], to: firstHallPursuerStop, duration: 3000 },
  { scene: "s01", event: "step-into-hall", channel: "s02", actor: "黑针",
    from: firstHallPursuerStop, to: firstHallPursuerStop, duration: 0 },
  { scene: "s01", event: "wait-for-pursuer", channel: "s02", actor: "黑针",
    from: firstHallPursuerStop, to: [335, 130], duration: 2300, exits: true },
  { scene: "s01", event: "stairs-after-patrol", channel: "s02", actor: "曲别针",
    from: [107, 104], to: [54, 111], duration: 1200 },
  { scene: "s03", event: "e029", channel: "s04", actor: "黑针",
    from: [192, 122], to: [74, 122], duration: 2300 },
];

function WallFootage({ channel, source, sighting, beatStartedAt }: {
  channel: Channel;
  source?: Surface;
  sighting?: Sighting;
  beatStartedAt: RefObject<number>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const scene = Number(channel.slice(1));
    const room = document.createElement("canvas");
    room.width = CAMERA_WIDTH;
    room.height = CAMERA_HEIGHT;
    const background = room.getContext("2d");
    if (!background) return;
    drawShell(background, scene);
    const props = sceneProps(scene);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const openedAt = performance.now();
    let last = -Infinity;
    let previousFootfall: number | undefined;
    let frame = 0;

    function render(now: number) {
      frame = requestAnimationFrame(render);
      if (now - last < 1000 / 12 || !ctx) return;
      last = now;
      if (source?.current) {
        ctx.drawImage(source.current, 0, 0);
        return;
      }
      ctx.drawImage(room, 0, 0);
      const layers: Drawable[] = [...props];
      const progress = sighting?.duration && !reducedMotion.matches
        ? Math.max(0, Math.min(1, (now - beatStartedAt.current) / sighting.duration)) : 1;
      if (sighting && !(sighting.exits && progress === 1)) {
        const fx = sighting.from[0] + (sighting.to[0] - sighting.from[0]) * progress;
        const fy = sighting.from[1] + (sighting.to[1] - sighting.from[1]) * progress;
        const face = sighting.to[0] > sighting.from[0] ? 1 : -1;
        const look = sighting.actor === "黑针" ? pursuerLook : protagonistLook;
        const step = progress * 19;
        const footfall = Math.floor(step / Math.PI);
        if (progress < 1 && previousFootfall !== undefined && previousFootfall !== footfall && !canvas.current?.parentElement?.hidden) {
          playFootstep({ pan: fx / (CAMERA_WIDTH / 2) - 1, level: 0.14, heavy: sighting.actor === "黑针" });
        }
        previousFootfall = footfall;
        layers.push({ baseY: fy, draw: target => {
          drawFigure(target, { fx, fy, face, pose: "stand", step,
            walking: progress < 1, look, tick: Math.floor(now / 83) });
          if (look.flashlight) drawFlashlight(target, fx, fy, face, now);
        } });
      }
      layers.sort((a, b) => a.baseY - b.baseY).forEach(layer => layer.draw(ctx));
      if (!reducedMotion.matches) drawInterference(ctx, now, Math.random);
    }

    render(openedAt);
    return () => cancelAnimationFrame(frame);
  }, [channel, sighting, source, beatStartedAt]);

  return <canvas ref={canvas} className="camera-image" width={CAMERA_WIDTH} height={CAMERA_HEIGHT} aria-hidden="true" />;
}

export function CameraWall({ sceneId, eventIds, surface, beatStartedAt }: {
  sceneId: string;
  eventIds?: readonly string[];
  surface: Surface;
  beatStartedAt: RefObject<number>;
}) {
  const [focused, setFocused] = useState<Channel>();
  const cue = cueFor(sceneId, eventIds ?? []);
  const latestEvent = eventIds?.at(-1);
  const sighting = offscreenSightings.find(item => item.scene === sceneId && item.event === latestEvent);

  return <div className="camera-wall" role="group" aria-label="多路监控">
    <div className="camera-wall-viewport">
      <div className={`camera-wall-grid${focused ? " is-focused" : ""}`}>
        {channels.map(channel => {
          const selected = channel.id === focused;
          const live = channel.id === sceneId;
          const onThisChannel = sighting?.channel === channel.id ? sighting : undefined;
          const label = [channel.title, live && !cue?.qu.exit ? "曲别针" : "",
            onThisChannel?.actor ?? (live && cue?.hei ? "黑针" : "")].filter(Boolean).join("，");
          return <button type="button" key={channel.id} className="camera-wall-tile"
            hidden={!!focused && !selected}
            aria-label={selected ? `${label}，返回多路画面` : `放大${label}镜头`}
            onClick={() => setFocused(selected ? undefined : channel.id)}
            onKeyDown={event => {
              if (selected && event.key === "Escape") {
                event.preventDefault();
                setFocused(undefined);
              }
            }}>
            <WallFootage channel={channel.id} source={live ? surface : undefined} sighting={onThisChannel}
              beatStartedAt={beatStartedAt} />
            <span className="reader-crt" aria-hidden="true" />
            <span className="camera-wall-location" aria-hidden="true">{channel.title}</span>
          </button>;
        })}
      </div>
    </div>
  </div>;
}
