export type WindowBox = { left: number; top: number; width: number; height: number };
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export function resizeWindow(box: WindowBox, edge: ResizeEdge, dx: number, dy: number, bounds: { width: number; height: number }): WindowBox {
  const minWidth = Math.min(280, bounds.width);
  const minHeight = Math.min(160, bounds.height);
  let left = box.left, top = box.top, right = box.left + box.width, bottom = box.top + box.height;
  if (edge.includes("w")) left = Math.max(0, Math.min(right - minWidth, left + dx));
  if (edge.includes("e")) right = Math.min(bounds.width, Math.max(left + minWidth, right + dx));
  if (edge.includes("n")) top = Math.max(0, Math.min(bottom - minHeight, top + dy));
  if (edge.includes("s")) bottom = Math.min(bounds.height, Math.max(top + minHeight, bottom + dy));
  return { left, top, width: right - left, height: bottom - top };
}
