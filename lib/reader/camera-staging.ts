// Stage directions for the security camera: where each character stands after a story event.
// Coordinates are feet positions on the 320 x 176 camera image.
import type { Pose } from "./camera-scene.ts";

type Spot = [number, number];

export type ActorCue = {
  at: Spot;
  pose?: Pose;
  run?: boolean;
  exit?: boolean;
};

export type Cue = {
  qu: ActorCue;
  hei?: ActorCue;
};

type Box = [number, number, number, number]; // x0, y0, x1, y1

// Open floor where a character may stroll on his own, minus furniture footprints.
export type Walkable = { minX: number; maxX: number; minY: number; maxY: number; avoid: Box[] };

type SceneStaging = {
  enterFrom: Spot;
  heiExit: Spot;
  opening: Cue;
  events: Record<string, Cue>;
  walk: Walkable;
};

// Feet positions. A desk hides the lower half of whoever stands just behind its back legs.
const s1 = { desk: [138, 128], backCabinet: [94, 103], lowCabinet: [58, 130], door: [217, 103] } satisfies Record<string, Spot>;
const s2 = { office: [106, 102], storage: [146, 102], stairs: [46, 118], door: [217, 103], mid: [168, 120], hide: [84, 104] } satisfies Record<string, Spot>;
const s3 = { terminal: [120, 121], partition: [40, 133], door: [217, 103] } satisfies Record<string, Spot>;
const s4 = { lab: [146, 102], storeroom: [106, 102], quStand: [224, 122], heiStand: [120, 122] } satisfies Record<string, Spot>;
const s5 = { backCabinet: [118, 103], desk: [138, 128], door: [217, 103], heiDoor: [222, 108] } satisfies Record<string, Spot>;
const s6 = { duty: [124, 128], door: [184, 103], mid: [204, 122], heiDoor: [196, 108] } satisfies Record<string, Spot>;

const offRight: Spot = [345, 125];
const offLeft: Spot = [-25, 125];

export const staging: Record<string, SceneStaging> = {
  // Outdoor camera at the research centre entrance, shown before the player joins the channel.
  s00: {
    enterFrom: [150, 128],
    heiExit: [345, 130],
    opening: { qu: { at: [150, 128] } },
    events: {},
    walk: { minX: 40, maxX: 285, minY: 110, maxY: 142, avoid: [[50, 118, 76, 134], [214, 112, 266, 128]] },
  },
  s01: {
    enterFrom: s1.desk,
    heiExit: s1.door,
    walk: { minX: 60, maxX: 240, minY: 101, maxY: 132, avoid: [[100, 131, 175, 146], [0, 55, 72, 128]] },
    opening: { qu: { at: s1.desk, pose: "read" } },
    events: {
      e001: { qu: { at: s1.desk, pose: "read" } },
      e002: { qu: { at: s1.lowCabinet, pose: "crouch" } },
      e003: { qu: { at: s1.desk, pose: "read" } },
      e004: { qu: { at: s1.desk, pose: "phone" } },
      e005: { qu: { at: s1.desk, pose: "phone" } },
      e006: { qu: { at: s1.backCabinet, pose: "read" } },
      e007: { qu: { at: s1.door, pose: "listen" } },
      e008: { qu: { at: s1.door, exit: true } },
      "leave-now": { qu: { at: s1.door, exit: true } },
    },
  },
  s02: {
    enterFrom: s2.door,
    heiExit: offLeft,
    walk: { minX: 30, maxX: 300, minY: 101, maxY: 130, avoid: [[0, 108, 78, 152]] },
    opening: { qu: { at: [196, 108] }, hei: { at: [24, 122] } },
    events: {
      e009: { qu: { at: s2.office, exit: true }, hei: { at: [56, 122] } },
      e010: { qu: { at: s2.hide, pose: "crouch" }, hei: { at: [146, 124] } },
      e011: { qu: { at: s2.stairs, run: true }, hei: { at: [116, 124] } },
      e012: { qu: { at: s2.storage, exit: true }, hei: { at: [90, 122] } },
      e013: { qu: { at: s2.hide, pose: "crouch" }, hei: { at: s2.mid } },
      "patrol-1-moving": { qu: { at: s2.hide, pose: "crouch" }, hei: { at: offRight, exit: true } },
      "patrol-1-clear": { qu: { at: s2.hide, pose: "crouch" }, hei: { at: offRight, exit: true } },
      "safe-escape": { qu: { at: offLeft, exit: true } },
      e014: { qu: { at: s2.hide, pose: "crouch" }, hei: { at: offRight, exit: true } },
      e015: { qu: { at: s2.hide, pose: "read" } },
      e016: { qu: { at: s2.stairs, run: true }, hei: { at: [146, 122], run: true } },
      e017: { qu: { at: s2.stairs, pose: "phone" } },
      e018: { qu: { at: s2.stairs, pose: "listen" } },
      e019: { qu: { at: offLeft, run: true, exit: true } },
      e020: { qu: { at: offLeft, exit: true } },
    },
  },
  s03: {
    enterFrom: s3.door,
    heiExit: s3.door,
    walk: { minX: 80, maxX: 300, minY: 117, maxY: 135, avoid: [[68, 92, 142, 118], [0, 118, 82, 150]] },
    opening: { qu: { at: s3.terminal } },
    events: {
      e021: { qu: { at: s3.terminal, pose: "read" } },
      e022: { qu: { at: s3.terminal, pose: "read" } },
      e023: { qu: { at: s3.terminal, pose: "read" } },
      e024: { qu: { at: s3.terminal, pose: "read" } },
      e025: { qu: { at: s3.terminal, pose: "read" } },
      "compare-after-memo": { qu: { at: s3.terminal, pose: "read" } },
      e026: { qu: { at: s3.partition, pose: "crouch", run: true }, hei: { at: [222, 106] } },
      e027: { qu: { at: s3.partition, pose: "crouch" }, hei: { at: [222, 106] } },
      e028: { qu: { at: s3.partition, pose: "crouch" }, hei: { at: [204, 110] } },
      "patrol-observation-clear": { qu: { at: s3.partition, pose: "crouch" }, hei: { at: s3.door, exit: true } },
      e029: { qu: { at: offLeft, exit: true } },
    },
  },
  s04: {
    enterFrom: offRight,
    heiExit: offLeft,
    walk: { minX: 40, maxX: 300, minY: 101, maxY: 130, avoid: [] },
    opening: { qu: { at: s4.quStand }, hei: { at: s4.heiStand } },
    events: {
      e030: { qu: { at: s4.lab, exit: true }, hei: { at: s4.heiStand } },
      e031: { qu: { at: s4.lab, exit: true }, hei: { at: s4.heiStand } },
      e032: { qu: { at: s4.lab, exit: true }, hei: { at: s4.heiStand } },
      "patrol-2-moving": { qu: { at: s4.lab, exit: true }, hei: { at: offLeft, exit: true } },
      e033: { qu: { at: [208, 122] }, hei: { at: offLeft, exit: true } },
      e034: { qu: { at: [270, 126], pose: "knife" }, hei: { at: [140, 122] } },
      e035: { qu: { at: s4.lab, pose: "crouch" }, hei: { at: [90, 124] } },
      e036: { qu: { at: s4.storeroom, exit: true }, hei: { at: [188, 124] } },
      e037: { qu: { at: [120, 106] }, hei: { at: [258, 128] } },
      e038: { qu: { at: [275, 124], run: true }, hei: { at: [253, 117], run: true } },
      e039: { qu: { at: [176, 122], pose: "knife" }, hei: { at: s4.heiStand } },
      e040: { qu: { at: [142, 122], pose: "knife", run: true }, hei: { at: [126, 121] } },
      e041: { qu: { at: [258, 125] }, hei: { at: s4.heiStand } },
      e042: { qu: { at: offRight, exit: true }, hei: { at: [180, 123] } },
    },
  },
  s05: {
    enterFrom: s5.door,
    heiExit: s5.door,
    walk: { minX: 60, maxX: 240, minY: 101, maxY: 132, avoid: [[100, 131, 175, 146], [0, 55, 72, 128], [174, 99, 224, 142]] },
    opening: { qu: { at: s5.backCabinet } },
    events: {
      e043: { qu: { at: s5.backCabinet, pose: "read" } },
      e044: { qu: { at: s5.desk, pose: "read" } },
      e045: { qu: { at: s5.desk, pose: "read" } },
      e046: { qu: { at: s5.desk, pose: "read" } },
      e047: { qu: { at: s5.desk, pose: "read" } },
      e048: { qu: { at: s5.desk, pose: "phone" } },
      e049: { qu: { at: [200, 112], pose: "listen" } },
      e050: { qu: { at: [164, 122] }, hei: { at: s5.heiDoor } },
      e051: { qu: { at: [164, 122] }, hei: { at: s5.heiDoor } },
      e052: { qu: { at: [164, 122] }, hei: { at: s5.heiDoor } },
      e053: { qu: { at: [180, 118] }, hei: { at: s5.heiDoor } },
      e054: { qu: { at: [134, 124] }, hei: { at: [206, 112] } },
      e055: { qu: { at: [192, 115], pose: "read" }, hei: { at: s5.heiDoor } },
      e056: { qu: { at: s5.door, exit: true } },
    },
  },
  s06: {
    enterFrom: offRight,
    heiExit: s6.door,
    walk: { minX: 120, maxX: 300, minY: 101, maxY: 132, avoid: [[68, 92, 142, 118], [28, 110, 126, 146]] },
    opening: { qu: { at: s6.mid } },
    events: {
      e057: { qu: { at: [172, 122] } },
      e058: { qu: { at: s6.duty } },
      "request-witness": { qu: { at: s6.duty } },
      e059: { qu: { at: s6.duty, pose: "read" } },
      e060: { qu: { at: s6.duty, pose: "phone" } },
      e061: { qu: { at: s6.duty }, hei: { at: s6.heiDoor } },
      e062: { qu: { at: [154, 124] }, hei: { at: s6.heiDoor } },
      e063: { qu: { at: [184, 114], pose: "knife", run: true }, hei: { at: [198, 111] } },
      e064: { qu: { at: [154, 124] }, hei: { at: s6.heiDoor } },
      e065: { qu: { at: s6.duty, pose: "read" }, hei: { at: s6.heiDoor } },
      e066: { qu: { at: [184, 114] }, hei: { at: s6.heiDoor } },
      e067: { qu: { at: offRight, exit: true } },
      e068: { qu: { at: [170, 124] }, hei: { at: [198, 112], pose: "down" } },
      e069: { qu: { at: [170, 124] }, hei: { at: [198, 112], pose: "crouch" } },
    },
  },
};

// Things he mutters to himself when nothing is happening.
export const mutters: Record<string, string[]> = {
  s00: ["就是这里了。", "灯怎么一直在闪……", "进去吧，别再犹豫了。", "白针，我来了。", "门禁卡应该还能用。", "这么晚了，楼里还亮着灯。"],
  s01: ["原始记录一定还在。", "白针……", "这份报告不对劲。", "楼上有人吗？", "非设备相关？怎么可能。", "再找找，一定漏了什么。", "页码对不上……"],
  s02: ["别出声……", "走廊太亮了。", "他会从哪边过来？", "楼梯间应该没锁。", "那支手电好重。"],
  s03: ["日志应该就在这台终端里。", "快一点，再快一点。", "原来他们早就知道。", "先存下来再说。", "门外是不是有人？"],
  s04: ["他到底想干什么……", "不能停在这里。", "安全通道在哪？", "刀还在口袋里。"],
  s05: ["这里比楼上冷多了。", "备份文件会放在哪？", "这些箱子很久没人动过了。", "黑针的账号……"],
  s06: ["快到出口了。", "值班的人会信我吗？", "证据还在，没丢。", "再坚持一下。"],
};

// What he says when the viewer clicks him, as if he could feel the camera watching.
export const pokeLines = [
  "谁？", "总觉得有人在看我。", "……别催我。", "我知道，我知道。", "嘘。", "你还在吗？",
  "是监控吗？", "我没时间了。", "别跟着我。", "我听见了。",
];

// The latest cue for a scene: the most recent event with stage directions, or the scene opening.
export function cueFor(sceneId: string, eventIds: readonly string[]): Cue | undefined {
  const scene = staging[sceneId];
  if (!scene) return;
  for (let i = eventIds.length - 1; i >= 0; i--) {
    const cue = scene.events[eventIds[i]];
    if (cue) {
      if (sceneId === "s02" && ["patrol-1-moving", "patrol-1-clear", "e014"].includes(eventIds[i])) {
        return { ...cue, qu: eventIds.includes("e012")
          ? { at: s2.storage, exit: true } : { at: s2.hide, pose: "crouch" } };
      }
      return cue;
    }
  }
  return scene.opening;
}
