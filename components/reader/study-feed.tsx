import { useRef, useState } from "react";
import { Grid2X2 } from "lucide-react";
import studyCamera from "../../design/reader-crt-study/study-camera.png";
import { CameraFeed, useShiftClock } from "./camera-feed";
import { CameraWall } from "./camera-wall";

export function CameraRecording() {
  return <span className="reader-rec" aria-label="录制中"><span aria-hidden="true">●</span> REC</span>;
}

export function StudyFeed({ scene, sceneId, eventIds, reply, onExit }: {
  scene?: string;
  sceneId?: string;
  eventIds?: readonly string[];
  reply?: { id: number; text: string };
  onExit?: () => void;
}) {
  const clock = useShiftClock();
  const live = sceneId && /^s0[1-6]$/.test(sceneId);
  const [wallOpen, setWallOpen] = useState(false);
  const surface = useRef<HTMLCanvasElement>(null);
  const showWall = !!(wallOpen && onExit && live);
  return (
    <div className={`reader-feed${showWall ? " has-camera-wall" : ""}`} id="reader-feed">
      {live && <CameraFeed sceneId={sceneId} eventIds={eventIds} reply={reply} surfaceRef={surface} />}
      {scene === "书房" && <img src={studyCamera.src} width={studyCamera.width} height={studyCamera.height} alt="书房示意图，旧门旁的桌面上摆着一张便签。" />}
      <div className="reader-crt" aria-hidden="true" />
      {showWall && <CameraWall sceneId={sceneId} eventIds={eventIds} surface={surface} />}
      <div className="reader-feed-top reader-meta">
        {onExit && live && <button type="button" className="camera-exit camera-wall-toggle"
          aria-label={showWall ? "关闭多路监控" : "打开多路监控"} aria-pressed={showWall}
          onClick={() => setWallOpen(open => !open)}><Grid2X2 size={15} aria-hidden="true" /></button>}
        <div className="reader-feed-identity">
          {scene && <span className="reader-camera-location">{scene}</span>}
          <CameraRecording />
        </div>
      </div>
      <div className="reader-feed-label reader-meta">
        <span>{scene === "书房" ? "场景示意" : sceneId ? "监控中" : "正在连接"}</span>
        <time>{clock}</time>
      </div>
    </div>
  );
}

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export function formatTime(timestamp: string) {
  return clock.format(new Date(timestamp));
}
