"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, FolderClosed, ShieldAlert } from "lucide-react";
import type { ProgressMail } from "../../lib/reader/progress-mail";
import { archiveLocations, localNotebooks } from "../../lib/reader/local-notes";
import { playRefusalAlarm, playTypeKey } from "../../lib/reader/audio";
import "./night-desktop.css";

const dutyPassword = "060427";
const archiveReminder = "重点看监控里重要档案存放点，这个是公司最重要的机密";

const inboxMessages = [
  { id: "stranger", sender: "陌生人", address: "unknown@relay.invalid", subject: "你只有今晚", time: "21:30", body: "你现在在一周前。今晚曲别针会来拿走那份记录。你一定要协助他找出真相。" },
  { id: "doctor", sender: "张博士", address: "zhang@research.invalid", subject: "今晚值班", time: "21:29", body: "今天晚上你守夜，好好看着监控，知道你健忘，密码就在文件里，千万别放人溜进来。" },
  { id: "ad", sender: "好物精选", address: "offers@market.invalid", subject: "您的专属优惠即将到期", time: "昨天", body: "本周办公用品限时优惠。本邮件由系统自动发送。" },
  { id: "digest", sender: "实验室订阅", address: "digest@research.invalid", subject: "本周实验室简报", time: "星期一", body: "设备维护和例行检查均已完成。详细安排请查看部门公告。" },
  { id: "local-news", sender: "北城晚讯", address: "digest@beicheng.invalid", subject: "园区北门的灯昨晚又亮了", time: "上周", body: "附近居民说，园区最近几次停电，只有北门和二楼一直亮着。园区答复称是夜间巡检，无需特别处理。" },
  { id: "nda", sender: "爱生生物 · 行政部", address: "admin@research.invalid", subject: "请补签访谈保密协议", time: "两年前", body: "参加设备复核和事故访谈的员工，请于周五前补签保密协议。已交回的旧表无需再找。附件里提到的编号只用于内部归档，对外一律按最新版简报答复。" },
  { id: "spam", sender: "会员活动提醒", address: "bonus@offers.invalid", subject: "请领取您的积分奖励", time: "两年前", body: "您的活动积分即将过期。感谢您订阅会员提醒。" },
] as const;

export type NightMailId = typeof inboxMessages[number]["id"] | ProgressMail["id"];
export const newNightMail = ["stranger", "doctor"] as const;

export function NightInbox({ delivered, read, selected, accepted, progress = [], onSelect, onAccept, onRefuse }: {
  delivered: boolean;
  progress?: readonly ProgressMail[];
  read: readonly NightMailId[];
  selected?: NightMailId;
  accepted: boolean;
  onSelect: (id: NightMailId) => void;
  onAccept: () => void;
  onRefuse: () => void;
}) {
  const visible: (typeof inboxMessages[number] | ProgressMail)[] = delivered ? [...progress].reverse() : [];
  visible.push(...(delivered ? inboxMessages : inboxMessages.slice(2)));
  const message = visible.find(item => item.id === selected);
  const regular = visible.filter(item => item.id.startsWith("progress-") || item.id === "stranger" || item.id === "doctor" || item.id === "digest");
  const folded = visible.filter(item => !regular.includes(item));

  function mailRow(item: typeof inboxMessages[number] | ProgressMail) {
    const unread = (item.id.startsWith("progress-") || item.id === "stranger" || item.id === "doctor") && !read.includes(item.id);
    return <button key={item.id} type="button" className={unread ? "is-unread" : "is-read"}
      aria-current={item.id === selected ? "true" : undefined} onClick={() => onSelect(item.id)}>
      <span><strong>{item.sender}</strong><time>{item.time}</time></span>
      <span>{item.subject}</span>
      {unread && <i className="night-unread-dot"><span className="sr-only">未读</span></i>}
    </button>;
  }

  return <div className="night-inbox">
    <div className="night-inbox-list" aria-label="邮件列表">
      {regular.map(mailRow)}
      <details className="night-inbox-folded" open>
        <summary><span className="when-closed">已折叠，垃圾信息</span><span className="when-open">垃圾信息</span></summary>
        {folded.map(mailRow)}
      </details>
    </div>
    <article className="night-inbox-detail" aria-label="邮件正文">
      {message ? <>
        <h2>{message.subject}</h2>
        <div className="night-inbox-from"><strong>{message.sender}</strong> <span>&lt;{message.address}&gt;</span></div>
        <p>{message.id === "doctor"
          ? <>今天晚上你守夜，好好看着监控，知道你健忘，<strong><em>密码就在文件里</em></strong>，千万别放人溜进来。<br /><br /><strong>{archiveReminder}。</strong><br />位置清单放在“我的文件 → 实验室须知 → 重要档案存放点”中，值班时逐项核对。</>
          : message.body}{message.id === "stranger" && <strong className="night-mail-warning">否则，你会死。</strong>}</p>
        {message.id === "stranger" && !accepted && (
          <div className="assist-actions">
            <button type="button" className="assist-decline" onClick={onRefuse}>拒绝</button>
            <button type="button" className="assist" onClick={onAccept}>接受</button>
          </div>)}
      </> : <p className="night-inbox-empty">选择一封邮件查看内容。</p>}
    </article>
  </div>;
}

export function MonitorLogin({ accepted, onUnlock }: {
  accepted: boolean;
  onUnlock: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return <form className="monitor-login" onSubmit={event => {
    event.preventDefault();
    if (password !== dutyPassword) {
      setError("密码错误，请核对后重试。");
      return;
    }
    if (!accepted) {
      setError("请先处理收件箱中的协助请求。");
      return;
    }
    onUnlock();
  }}>
    <label htmlFor="monitor-password">输入密码</label>
    <input id="monitor-password" type="password" inputMode="numeric" autoComplete="off" required maxLength={6}
      value={password} aria-invalid={!!error}
      aria-describedby={error ? "monitor-login-error" : accepted ? undefined : "monitor-login-mail"}
      onChange={event => {
        playTypeKey();
        setPassword(event.currentTarget.value);
        setError("");
      }} />
    {error && <p id="monitor-login-error" role="alert">{error}</p>}
    {!accepted && <p id="monitor-login-mail">请先查看收件箱里的值班邮件。</p>}
    <button type="submit" className="assist">确定</button>
  </form>;
}

export type LocalDocumentId = "archives" | typeof localNotebooks[number]["id"];
export function localDocumentTitle(id: LocalDocumentId) {
  return id === "archives" ? "重要档案存放点.txt" : localNotebooks.find(note => note.id === id)!.title;
}

export function DutyDocument({ id, discoveredClueIds }: { id: LocalDocumentId; discoveredClueIds: readonly string[] }) {
  const notebook = localNotebooks.find(note => note.id === id);
  return <article className="duty-files duty-document" aria-label={localDocumentTitle(id)}>
    {id === "archives" ? <div className="duty-checklist">
      {archiveLocations.map(item => <label key={item.id}>
        <input type="checkbox" checked={discoveredClueIds.includes(item.id)} disabled />
        <span><strong>{item.title}</strong><small>{item.place}</small></span>
      </label>)}
    </div> : <div className="duty-document-text">{notebook?.body}</div>}
  </article>;
}

export function DutyFiles({ onOpenNote, onOpenDocument }: {
  onOpenNote: () => void; onOpenDocument: (id: LocalDocumentId) => void;
}) {
  const [folder, setFolder] = useState(false);
  return <div className="duty-files">
    <small>本地{folder ? " / 实验室须知" : ""}</small>
    {folder ? <>
      <button type="button" onClick={() => setFolder(false)}>← 返回本地文件</button>
      <button type="button" onClick={() => onOpenDocument("archives")}><FileText size={20} aria-hidden="true" /><span>重要档案存放点.txt</span></button>
      {localNotebooks.filter(note => note.id !== "trust").map(note => <button key={note.id} type="button" onClick={() => onOpenDocument(note.id)}>
        <FileText size={20} aria-hidden="true" /><span>{note.title}</span>
      </button>)}
    </> : <>
      <button type="button" onClick={onOpenNote}><FileText size={20} aria-hidden="true" /><span>值班备忘.txt</span></button>
      <button type="button" onClick={() => setFolder(true)}><FolderClosed size={20} aria-hidden="true" /><span>实验室须知</span></button>
      <button type="button" onClick={() => onOpenDocument("trust")}><FileText size={20} aria-hidden="true" /><span>信任值.txt</span></button>
    </>}
  </div>;
}

export function DutyNote() {
  return <div className="duty-note"><pre><strong><em>{dutyPassword}</em></strong></pre></div>;
}

export function RefusalAlarm({ onAccept }: { onAccept: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const layer = dialog.current;
    layer?.showModal();
    const stop = playRefusalAlarm();
    return () => { stop?.(); layer?.close(); };
  }, []);
  return <dialog ref={dialog} className="duty-alarm" aria-labelledby="duty-alarm-title"
    onCancel={event => event.preventDefault()}>
    <ShieldAlert size={32} aria-hidden="true" />
    <h2 id="duty-alarm-title">协助请求已拒绝</h2>
    <p>连接中断。接受协助请求以解除警报。</p>
    <button type="button" onClick={onAccept}>接受</button>
  </dialog>;
}

export function DutyTimeNotice({ onDismiss }: { onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const layer = dialog.current;
    layer?.showModal();
    return () => layer?.close();
  }, []);
  return <dialog ref={dialog} className="duty-time-notice" aria-labelledby="duty-time-notice-message"
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <p id="duty-time-notice-message">你只有三个小时的时间，请好好留意和利用时间</p>
    <button type="button" className="assist" autoFocus onClick={onDismiss}>确定</button>
  </dialog>;
}
