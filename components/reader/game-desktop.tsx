"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Monitor, Mail, X, FolderClosed, Minus, Square, Copy, Search, Globe, Calculator, Volume2, VolumeX, Camera } from "lucide-react";
import { CameraRecording } from "./study-feed";
import { StoryPreview } from "./story-preview";
import { CameraFeed, useShiftClock } from "./camera-feed";
import { getAudioVolume, initAudio, isMuted, onMutedChange, playMailArrival, setAudioVolume, setMuted } from "../../lib/reader/audio";
import { DutyFiles, DutyNote, DutyTimeNotice, MonitorLogin, newNightMail, NightInbox, RefusalAlarm, type NightMailId } from "./night-desktop";
import { ArchiveRunner } from "./archive-runner";
import { DutyDocument, localDocumentTitle, type LocalDocumentId } from "./night-desktop";
import { WindowResize } from "./window-resize";
import type { ReaderView } from "../../lib/reader/reader-session";
import type { ProgressMail } from "../../lib/reader/progress-mail";
import "./desktop.css";
import "./desktop-glass-preview.css";

type App = "inbox" | "files" | "system" | "browser" | "monitor" | "note";
type Phase = "desktop" | "frozen" | "fault" | "online";
const frozenDuration = 780;
const faultDuration = 640;
type WindowPosition = { left: number; top: number };
type WindowId = App | "terminal" | `doc:${LocalDocumentId}`;
type DesktopWindow = { id: WindowId; minimized?: boolean; maximized?: boolean; position?: WindowPosition; size?: { width: number; height: number } };
const apps = [
  { id: "inbox", title: "收件箱", Icon: Mail },
  { id: "files", title: "我的文件", Icon: FolderClosed },
  { id: "system", title: "本机信息", Icon: Monitor },
] as const;

function SignalSnow() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const layer = canvas.current;
    const context = layer?.getContext("2d");
    if (!layer || !context) return;
    const frame = context.createImageData(layer.width, layer.height);
    function draw() {
      const band = Math.floor(Math.random() * frame.height);
      for (let y = 0; y < frame.height; y++) {
        const scan = (y % 3 === 0 ? .8 : 1) * (Math.abs(y - band) < 3 ? 1.16 : 1);
        for (let x = 0; x < frame.width; x++) {
          const index = (y * frame.width + x) * 4;
          const noise = Math.random() ** 1.55 * scan;
          frame.data[index] = 10 + noise * 110;
          frame.data[index + 1] = 27 + noise * 143;
          frame.data[index + 2] = 62 + noise * 160;
          frame.data[index + 3] = 255;
        }
      }
      context!.putImageData(frame, 0, 0);
    }
    draw();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(draw, 95);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="signal-fault" role="status" aria-label="显示信号中断">
    <canvas ref={canvas} width={256} height={160} aria-hidden="true" />
  </div>;
}

function WindowControls({ maximized, onMinimize, onMaximize, onClose }: {
  maximized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  const expandLabel = maximized ? "还原窗口" : "全屏窗口";
  return <div className="window-controls">
    <button type="button" aria-label="最小化窗口" title="最小化" onClick={onMinimize}><Minus /></button>
    <button type="button" aria-label={expandLabel} title={expandLabel} onClick={onMaximize}>
      {maximized ? <Copy /> : <Square />}
    </button>
    <button type="button" aria-label="关闭窗口" title="关闭" onClick={onClose}><X /></button>
  </div>;
}

const desktopTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const countdownDurationMs = 3 * 60 * 60 * 1000;

function DesktopClock({ shiftTime, shiftDate }: { shiftTime?: string; shiftDate?: string }) {
  const [now, setNow] = useState<number>();
  const [countdownOpen, setCountdownOpen] = useState(false);
  const [deadline, setDeadline] = useState<number>();
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const time = shiftTime ?? (now === undefined ? undefined : desktopTimeFormat.format(now));
  const seconds = now === undefined || deadline === undefined ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
  const countdown = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, "0")).join(":");
  function closeCountdown() {
    setCountdownOpen(false);
    toggle.current?.focus();
  }
  return <div className="desktop-clock-wrap" onKeyDown={event => {
    if (event.key === "Escape" && countdownOpen) {
      event.preventDefault();
      closeCountdown();
    }
  }}>
    <button type="button" ref={toggle} className="desktop-clock-button taskbar-action" aria-label="倒计时"
      aria-expanded={countdownOpen} aria-controls={countdownOpen ? "desktop-countdown" : undefined}
      onClick={() => {
        const current = Date.now();
        setNow(current);
        setDeadline(saved => saved ?? current + countdownDurationMs);
        setCountdownOpen(open => !open);
      }}>
      {shiftDate && <span className="desktop-shift-date">{shiftDate}</span>}
      <time className="desktop-clock" dateTime={time}>{time ?? "--:--:--"}</time>
    </button>
    {countdownOpen && <section id="desktop-countdown" className="os-window desktop-countdown"
      role="dialog" aria-label="倒计时">
      <header className="window-bar">
        <span>倒计时</span>
        <div className="window-controls"><button type="button" onClick={closeCountdown} aria-label="关闭倒计时"><X /></button></div>
      </header>
      <div role="timer" aria-label="剩余时间" className="desktop-countdown-time">{countdown}</div>
    </section>}
  </div>;
}

function DesktopVolume() {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(100);
  const [silenced, setSilenced] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const slider = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLevel(getAudioVolume());
    return onMutedChange(setSilenced);
  }, []);

  useEffect(() => {
    if (open) slider.current?.focus();
  }, [open]);

  return <div className="desktop-volume-wrap" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      toggle.current?.focus();
    }
  }}>
    <button type="button" ref={toggle} className="desktop-volume-button taskbar-action" title="网站音量"
      aria-label="网站音量" aria-expanded={open} aria-controls={open ? "desktop-volume" : undefined}
      onClick={() => setOpen(value => !value)}>
      {level === 0 || silenced ? <VolumeX size={16} /> : <Volume2 size={16} />}
    </button>
    {open && <div className="desktop-volume" id="desktop-volume">
      <label htmlFor="desktop-volume-slider">音量</label>
      <input id="desktop-volume-slider" type="range" ref={slider}
        min={0} max={100} value={silenced ? 0 : level}
        aria-valuetext={(silenced ? 0 : level) + "%"}
        onChange={event => {
          const next = event.currentTarget.valueAsNumber;
          setAudioVolume(next);
          if (next > 0 && isMuted()) setMuted(false);
          setLevel(next);
        }} />
      <output htmlFor="desktop-volume-slider">{silenced ? 0 : level}%</output>
    </div>}
  </div>;
}

const newsDateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric",
});

function previousWeek(date: Date) {
  const result = new Date(date);
  result.setDate(result.getDate() - 7);
  return result;
}

function BrowserPage({ openingNews, openedOn, active }: { openingNews: boolean; openedOn?: Date; active: boolean }) {
  const receivedOn = openedOn && previousWeek(openedOn);
  return <div className="desktop-browser-body">
    <div className="desktop-browser-toolbar">
      <Globe size={15} aria-hidden="true" />
      <span className="desktop-browser-address">
        {openingNews ? "https://beicheng-daily.invalid/investigations/17" : "http://archive.research.invalid/"}
      </span>
    </div>
    {openingNews ? <div className="opening-news-page">
      <div className="opening-news-masthead">
        <strong>北城日报</strong>
        <span>调查报道</span>
      </div>
      <article className="opening-news-article" aria-labelledby="opening-news-title">
        <p className="opening-news-byline">{openedOn && <>{newsDateFormat.format(openedOn)} · </>}记者 林岑</p>
        <h1 id="opening-news-title">有人找到了17号实验室事故的原始记录</h1>
        <p className="opening-news-lead">一份匿名送达的设备日志，让一桩以【非实验室责任】结案的死亡事故重新受到关注。</p>
        <p>两年前，17号志愿者在一次神经康复设备试验中死亡。研究中心终止了当期试验，随后发布简报，认定这起死亡事故属于「非实验室责任」。</p>
        <p>{receivedOn ? newsDateFormat.format(receivedOn) : "七天前"}，一名未具名的调查者向本报递交了事故当晚的部分日志。日志显示，试验中断前设备曾发出告警。消息传出后，不少人认为是现场人员调错了参数，研究中心为了避免追责才把告警从报告里删去。</p>
        <p>记者看到的日志只有两页，其中一页缺了页尾。现有材料无法确认谁动过参数，也无法判断值班人员在事发前知道多少。研究中心未回应询问，递交日志的人也未再与本报联系。</p>
      </article>
    </div> : <article className="desktop-browser-error">
      <h2>404 Not Found</h2>
      <p>页面未找到。请求的地址可能已被移除或更改。</p>
      <hr />
      <code>HTTP/1.1 404</code>
      <ArchiveRunner active={active} />
    </article>}
  </div>;
}

export function GameDesktop() {
  const [phase, setPhase] = useState<Phase>("desktop");
  const [openedOn, setOpenedOn] = useState<Date>();
  const [windows, setWindows] = useState<DesktopWindow[]>([{ id: "browser" }]);
  const [intro, setIntro] = useState<"locked" | "mail" | "accepted" | "unlocked">("locked");
  const [selectedMail, setSelectedMail] = useState<NightMailId>();
  const [readNightMail, setReadNightMail] = useState<NightMailId[]>([]);
  const [alarming, setAlarming] = useState(false);
  const [showTimeNotice, setShowTimeNotice] = useState(false);
  const stopMailChime = useRef<(() => void) | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState<ReaderView>();
  const [mailNotice, setMailNotice] = useState<ProgressMail>();
  const progressSession = useRef<string | undefined>(undefined);
  const deliveredMail = useRef(new Set<string>());
  const onProgress = useCallback((view: ReaderView) => {
    if (progressSession.current !== view.id) {
      progressSession.current = view.id;
      deliveredMail.current.clear();
      setReadNightMail(read => read.filter(id => !id.startsWith("progress-")));
      setSelectedMail(selected => selected?.startsWith("progress-") ? undefined : selected);
      setMailNotice(undefined);
    }
    setProgress(view);
  }, []);
  useEffect(() => {
    const fresh = (progress?.guidanceMail ?? []).filter(mail => !deliveredMail.current.has(mail.id));
    if (!fresh.length) return;
    fresh.forEach(mail => deliveredMail.current.add(mail.id));
    setMailNotice(fresh.at(-1));
    const stop = playMailArrival(0);
    const timer = window.setTimeout(() => stop?.(), 1800);
    return () => { window.clearTimeout(timer); stop?.(); };
  }, [progress]);
  const finishStory = useCallback(() => setFinished(true), []);
  const drag = useRef<{
    dx: number; dy: number; pointerId: number; target: HTMLElement;
    update: (position: WindowPosition) => void;
  } | null>(null);
  const clock = useShiftClock();
  const nightDesktop = phase === "online";
  const monitorReady = nightDesktop && intro === "unlocked";
  const unreadCount = nightDesktop && intro !== "locked"
    ? [...newNightMail, ...(progress?.guidanceMail ?? []).map(mail => mail.id)].filter(id => !readNightMail.includes(id)).length : 0;
  const shiftDate = nightDesktop && openedOn ? newsDateFormat.format(previousWeek(openedOn)) : undefined;
  const openingNews = phase === "desktop";
  const terminal = windows.find(window => window.id === "terminal");
  const foreground = windows.findLast(window => !window.minimized)?.id;
  const waitingForAnswer = intro === "mail" && readNightMail.includes("stranger");
  const windowTitle = (id: WindowId) => {
    if (id.startsWith("doc:")) return localDocumentTitle(id.slice(4) as LocalDocumentId) + " · 记事本";
    if (id === "browser") return openingNews ? "北城日报 · 浏览器" : "浏览器";
    if (id === "terminal") return "监控终端";
    if (id === "monitor") return "监控";
    if (id === "note") return "值班备忘.txt · 记事本";
    return apps.find(item => item.id === id)?.title;
  };
  const windowStyle = (id: WindowId, window: DesktopWindow): CSSProperties => ({
    ...(!window.maximized && window.position),
    ...(!window.maximized && window.size),
    ...(!window.maximized && window.size ? { maxHeight: "none", maxWidth: "none" } : {}),
    zIndex: 2 + windows.findIndex(item => item.id === id),
  });
  const desktopStatus = phase === "frozen" ? "程序未响应"
    : phase === "fault" ? "信号中断" : undefined;

  useEffect(() => {
    setOpenedOn(new Date());
  }, []);

  useEffect(() => () => stopMailChime.current?.(), []);

  const focusWindow = useCallback((id: WindowId) => {
    setWindows(current => {
      const existing = current.find(window => window.id === id);
      if (current.at(-1) === existing && existing && !existing.minimized) return current;
      return [...current.filter(window => window.id !== id), { ...existing, id, minimized: false }];
    });
  }, []);

  const requestNightMail = useCallback(() => {
    if (intro !== "locked") return;
    setIntro("mail");
    stopMailChime.current = playMailArrival(0);
  }, [intro]);

  function updateWindow(id: WindowId, changes: Partial<Omit<DesktopWindow, "id">>) {
    setWindows(current => current.map(window => window.id === id ? { ...window, ...changes } : window));
  }

  const dismissWindow = useCallback((id: WindowId, minimize = false) => {
    if (id === "inbox" && waitingForAnswer) {
      setSelectedMail("stranger");
      focusWindow(id);
      return;
    }
    setWindows(current => minimize
      ? current.map(window => window.id === id ? { ...window, minimized: true } : window)
      : current.filter(window => window.id !== id));
  }, [waitingForAnswer, focusWindow]);

  useEffect(() => {
    if (!foreground || alarming || showTimeNotice) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || !foreground) return;
      event.preventDefault();
      dismissWindow(foreground);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [foreground, alarming, showTimeNotice, dismissWindow]);

  useEffect(() => {
    if (phase !== "frozen" && phase !== "fault") return;
    const timer = setTimeout(() => setPhase(phase === "frozen" ? "fault" : "online"),
      phase === "frozen" ? frozenDuration : faultDuration);
    return () => clearTimeout(timer);
  }, [phase]);

  // Sound starts with the first click anywhere, as browsers require.
  useEffect(initAudio, []);

  useEffect(() => {
    const reset = () => setWindows(current => current.map(window => ({ ...window, position: undefined, size: undefined })));
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);

  function launch(id: App) {
    if (openingNews) {
      dismissWindow("browser");
      setPhase("frozen");
      return;
    }
    if (!nightDesktop) return;
    if (id === "monitor") requestNightMail();
    focusWindow(id === "monitor" && monitorReady ? "terminal" : id);
  }
  function selectNightMail(id: NightMailId) {
    setSelectedMail(id);
    setMailNotice(notice => notice?.id === id ? undefined : notice);
    if (readNightMail.includes(id)) return;
    const next = [...readNightMail, id];
    setReadNightMail(next);
    if (newNightMail.every(mail => next.includes(mail))) {
      stopMailChime.current?.();
      stopMailChime.current = undefined;
    }
  }
  function acceptNightMail() {
    setAlarming(false);
    setIntro("accepted");
    setShowTimeNotice(true);
  }
  function unlockMonitor() {
    setIntro("unlocked");
    dismissWindow("monitor");
    focusWindow("terminal");
  }
  function connectMonitor() {
    setPlaying(true);
    focusWindow("terminal");
  }
  function startDrag(e: PointerEvent<HTMLElement>, id: WindowId) {
    const target = e.currentTarget.parentElement;
    if (e.button !== 0 || !e.isPrimary || !target || (e.target as Element).closest("button")) return;
    const box = target.getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, pointerId: e.pointerId, target, update: position => updateWindow(id, { position }) };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== e.pointerId) return;
    const { width, height } = active.target.getBoundingClientRect();
    active.update({
      left: Math.max(0, Math.min(innerWidth - width, e.clientX - active.dx)),
      top: Math.max(0, Math.min(innerHeight - height - 34, e.clientY - active.dy)),
    });
  }
  function endDrag(e: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }
  return <div className={`os phase-${phase} os-glass-preview`}>
    <div className="os-wall" aria-hidden="true">
      <div className="desktop-ribbons" />
      {nightDesktop && <div className="night-wall-label">爱生生物有限公司内部电脑</div>}
    </div>
    <nav className="shortcuts" aria-label="桌面软件">{apps.map(({id,title,Icon}) => {
      const unread = id === "inbox" && unreadCount > 0;
      return <button key={id} onClick={() => launch(id)} disabled={phase === "frozen" || phase === "fault"}
        aria-label={unread ? "收件箱，" + unreadCount + " 封未读" : undefined}>
        <span className="icon-frame">
          <Icon />
          {unread && <span className="inbox-unread-badge" aria-hidden="true">{unreadCount}</span>}
        </span>{title}
      </button>;
    })}</nav>
    {phase === "fault" && <SignalSnow />}
    {nightDesktop && <button type="button" className="night-monitor-shortcut" onClick={() => launch("monitor")}>
      <span className="icon-frame"><Camera aria-hidden="true" /></span>监控
    </button>}
    {monitorReady && <section className={"os-monitor os-window" + (terminal?.maximized ? " is-maximized" : "")}
      aria-label="监控终端" hidden={!terminal || terminal.minimized}
      style={terminal && windowStyle("terminal", terminal)}
      onPointerDown={() => focusWindow("terminal")} onFocus={() => focusWindow("terminal")}>
      <header className={terminal?.maximized ? "window-bar" : "window-bar draggable"}
        onPointerDown={terminal?.maximized ? undefined : e => startDrag(e, "terminal")}
        onPointerMove={move} onLostPointerCapture={endDrag}>
        <span>监控终端</span>
        <div className="window-actions">
          <WindowControls maximized={!!terminal?.maximized}
            onMinimize={() => dismissWindow("terminal", true)}
            onMaximize={() => updateWindow("terminal", { maximized: !terminal?.maximized })}
            onClose={() => dismissWindow("terminal")} />
        </div>
      </header>
      {playing ? <StoryPreview onComplete={finishStory} onProgress={onProgress} onExit={() => dismissWindow("terminal")}/> : <div className="intercept">
        <CameraFeed sceneId="s00" whitePinAtEntrance/>
        <div className="reader-feed-top reader-meta">
          <div className="reader-feed-identity"><span>CAM / 00</span><CameraRecording /></div>
        </div>
        <div className="cam-location">研究中心正门</div>
        <button type="button" className="assist night-enter-story" onClick={connectMonitor}>进入中控</button>
      </div>}
      {!terminal?.maximized && <WindowResize onResize={({ left, top, width, height }) =>
        updateWindow("terminal", { position: { left, top }, size: { width, height } })} />}
    </section>}
    {windows.filter(item => item.id !== "terminal").map(window => {
      const app = window.id;
      const documentId = app.startsWith("doc:") ? app.slice(4) as LocalDocumentId : undefined;
      return <section key={app} data-night-app={nightDesktop ? documentId ? "document" : app : undefined}
        className={'utility os-window' + (app === "browser" ? " desktop-browser" : "") +
          (app === "browser" && openingNews ? " has-opening-news" : "") + (window.maximized ? " is-maximized" : "")}
        aria-label={windowTitle(app)} hidden={window.minimized} style={windowStyle(app, window)}
        onPointerDown={() => focusWindow(app)} onFocus={() => focusWindow(app)}>
      <header className={window.maximized ? "window-bar" : "window-bar draggable"}
        onPointerDown={window.maximized ? undefined : e => startDrag(e, app)}
        onPointerMove={move} onLostPointerCapture={endDrag}>
        <span>{windowTitle(app)}</span>
        <WindowControls maximized={!!window.maximized}
          onMinimize={() => dismissWindow(app, true)}
          onMaximize={() => updateWindow(app, { maximized: !window.maximized })}
          onClose={() => dismissWindow(app)} />
      </header>
      {app === "browser" ? <BrowserPage openingNews={openingNews} openedOn={openedOn} active={foreground === "browser" && !alarming && !showTimeNotice} />
      : nightDesktop && app === "monitor" ? <MonitorLogin accepted={intro === "accepted"} onUnlock={unlockMonitor} />
      : nightDesktop && app === "inbox" ? <NightInbox delivered={intro !== "locked"}
        read={readNightMail} selected={selectedMail} progress={progress?.guidanceMail} accepted={intro === "accepted" || intro === "unlocked"}
        onSelect={selectNightMail} onAccept={acceptNightMail} onRefuse={() => setAlarming(true)} />
      : nightDesktop && app === "note" ? <DutyNote />
      : nightDesktop && documentId ? <DutyDocument id={documentId} discoveredClueIds={progress?.discoveredClueIds ?? []} />
      : nightDesktop && app === "files" && !finished ? <DutyFiles onOpenNote={() => launch("note")}
        onOpenDocument={id => focusWindow(`doc:${id}`)} />
      : <div className="utility-body">{app === "files" ? <><small>本地磁盘　/　工作目录</small><h2>我的文件</h2>{finished ? <ul>{["完整叙事文本", "人物与世界设定", "故事分析", "弹幕交互设计"].map(name =>
          <li key={name}><a href={`/story-archive/${name}.txt`} download>{name} ↓</a></li>)}</ul> : <p>调查结束后，本次任务的剧本档案将在这里开放。</p>}</> :
        <><small>终端系统　/　设备状态</small><h2>本机信息</h2><p>工作模式　夜班值守</p><p>监控通道　已连接</p><p>关闭权限　由系统管理</p></>}</div>}
      {!window.maximized && <WindowResize onResize={({ left, top, width, height }) =>
        updateWindow(app, { position: { left, top }, size: { width, height } })} />}
      </section>;
    })}
    <footer className="os-taskbar">
      <div className="taskbar-launchers">
        <span aria-hidden="true" className="taskbar-static taskbar-computer" title="电脑"><Monitor size={17}/></span>
        <span aria-hidden="true" className="taskbar-static"><Search size={14}/></span>
        <span aria-hidden="true" className="taskbar-static" title="文件资源管理器"><FolderClosed size={16}/></span>
        <button type="button" className="taskbar-static taskbar-browser taskbar-action" aria-label="打开浏览器" title="浏览器"
          disabled={phase === "frozen" || phase === "fault"} onClick={() => launch("browser")}><Globe size={16}/></button>
        <span aria-hidden="true" className="taskbar-static" title="计算器"><Calculator size={16}/></span>
      </div>
      <div className="taskbar-windows">
        {windows.map(window => <button type="button" key={window.id}
          aria-pressed={foreground === window.id} onClick={() => focusWindow(window.id)}>
          {windowTitle(window.id)}
        </button>)}
      </div>
      <div className="taskbar-tray">
        <DesktopVolume />
        {phase === "online" && <button className="taskbar-action" onClick={() => launch("inbox")}><Mail size={15}/> {unreadCount ? unreadCount + " 封未读" : "收件箱"}</button>}
        {desktopStatus && <span>{desktopStatus}</span>}
        <DesktopClock shiftTime={nightDesktop ? clock : undefined} shiftDate={shiftDate} />
      </div>
    </footer>
    {mailNotice && <div className="progress-mail-notice" role="status">
      <button type="button" onClick={() => { selectNightMail(mailNotice.id); focusWindow("inbox"); }}>
        <Mail size={18} aria-hidden="true" /><span>陌生人发来新邮件<br /><strong>{mailNotice.subject}</strong></span>
      </button>
      <button type="button" aria-label="关闭新邮件提醒" onClick={() => setMailNotice(undefined)}><X size={16} /></button>
    </div>}
    {alarming && <RefusalAlarm onAccept={acceptNightMail} />}
    {showTimeNotice && <DutyTimeNotice onDismiss={() => setShowTimeNotice(false)} />}
  </div>;
}
