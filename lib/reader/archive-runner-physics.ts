export const width = 600;
export const ground = 107;
export const runnerX = 62;
export const birdY = 43;

const gravity = 1300;
const treeCount = 9;
const obstacleWidth = { tree: 24, bird: 26 };

type Obstacle = { kind: "tree" | "bird"; x: number };
export type Run = { height: number; velocity: number; jumps: number; obstacle: Obstacle; cleared: number };

export function startRun(): Run {
  return { height: 0, velocity: 0, jumps: 0, obstacle: { kind: "tree", x: width - 30 }, cleared: 0 };
}

export function jumpRun(run: Run) {
  if (run.jumps >= 2) return;
  run.velocity = run.jumps === 0 ? 365 : 290;
  run.jumps++;
}

export function advanceRun(run: Run, dt: number) {
  if (run.jumps && dt > 0) {
    run.height += (run.velocity - gravity * dt / 2) * dt;
    run.velocity -= gravity * dt;
    if (run.height <= 0) {
      run.height = 0;
      run.velocity = 0;
      run.jumps = 0;
    }
  }

  const { obstacle } = run;
  obstacle.x -= (230 + Math.floor(run.cleared / 3) * 36) * dt;
  const right = obstacle.x + obstacleWidth[obstacle.kind];
  if (obstacle.x + 2 < runnerX + 19 && right - 2 > runnerX + 2) {
    const feet = ground - run.height;
    const birdHit = feet > birdY && feet - 21 < birdY + 13;
    if (obstacle.kind === "bird" ? birdHit : run.height < 27) return obstacle.kind;
  }
  if (right >= 0) return;

  if (obstacle.kind === "tree") run.cleared++;
  if (run.cleared === treeCount) return "complete";

  // Birds have their own stretch of track, with room to land before they reach the runner.
  const birdNext = obstacle.kind === "tree" && (run.cleared === 6 || run.cleared === 8);
  run.obstacle = birdNext
    ? { kind: "bird", x: width - 56 }
    : { kind: "tree", x: width - 65 - Math.random() * 225 };
}
