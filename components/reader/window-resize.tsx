"use client";
import { useRef, type PointerEvent } from "react";
import { resizeWindow, type ResizeEdge, type WindowBox } from "../../lib/reader/window-geometry";

const edges = { n: "上边", s: "下边", e: "右边", w: "左边", ne: "右上角", nw: "左上角", se: "右下角", sw: "左下角" } as const;
export function WindowResize({ onResize }: { onResize: (box: WindowBox) => void }) {
  const active = useRef<{ box: WindowBox; edge: ResizeEdge; x: number; y: number; pointer: number; bounds: { width: number; height: number } } | null>(null);
  function begin(event: PointerEvent<HTMLDivElement>, edge: ResizeEdge) {
    if (event.button !== 0 || !event.isPrimary) return;
    const window = event.currentTarget.parentElement!;
    const rect = window.getBoundingClientRect();
    const parent = window.parentElement!.getBoundingClientRect();
    event.preventDefault();
    active.current = { edge, x: event.clientX, y: event.clientY, pointer: event.pointerId,
      box: { left: rect.left - parent.left, top: rect.top - parent.top, width: rect.width, height: rect.height },
      bounds: { width: parent.width, height: parent.height - 40 } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  return <>{(Object.keys(edges) as ResizeEdge[]).map(edge => <div key={edge}
    className={"window-resize window-resize-" + edge} role="separator" aria-label={"调整窗口" + edges[edge]}
    aria-orientation={edge === "e" || edge === "w" ? "vertical" : "horizontal"}
    onPointerDown={event => begin(event, edge)}
    onPointerMove={event => {
      const current = active.current;
      if (current?.pointer === event.pointerId) onResize(resizeWindow(current.box, current.edge,
        event.clientX - current.x, event.clientY - current.y, current.bounds));
    }}
    onPointerUp={() => { active.current = null; }}
    onPointerCancel={() => { active.current = null; }}
    onLostPointerCapture={() => { active.current = null; }}
  />)}</>;
}
