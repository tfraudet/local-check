/**
 * Theta* — any-angle A* on a 2D grid.
 *
 * Standard A* on an 8-connected grid produces jagged 45°-stepped routes.
 * Theta* keeps the same open/closed set machinery but during expansion
 * checks whether the *parent* of the current node has line-of-sight to the
 * successor; if so, the successor's parent is set to the grandparent
 * instead of the current node. The resulting path hugs obstacles at
 * arbitrary angles — critical here because each extra metre of routed
 * distance costs altitude at rate 1/workingLD.
 *
 * The algorithm is pure: it takes a `lineOfSight` predicate and a `cost`
 * function as inputs, so the same code can be reused for other any-angle
 * routing problems.
 */

import { MinHeap } from './minHeap';

export interface GridPoint {
  r: number;
  c: number;
}

export interface ThetaStarOptions {
  rows: number;
  cols: number;
  start: GridPoint;
  goal: GridPoint;
  /** Returns true iff the straight segment from `a` to `b` is traversable
   * given the current accumulated cost at `a`. Must be monotone-consistent
   * with `cost` for optimality guarantees, but Theta* stays correct in
   * practice even when LOS depends on `gAtA` (as it does here — the glide
   * plane's start altitude shifts as the pilot flies further). */
  lineOfSight(a: GridPoint, b: GridPoint, gAtA: number): boolean;
  /** Metric distance between two grid points, in the same unit as `g` and
   * `heuristic` — meters here. */
  cost(a: GridPoint, b: GridPoint): number;
  /** Admissible heuristic (never overestimates true remaining cost). */
  heuristic(a: GridPoint): number;
  /** Cap on nodes expanded; guards against runaway searches. */
  maxExpanded?: number;
}

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/** Returns the sequence of grid points from `start` to `goal`, inclusive,
 * or `null` if no path was found within `maxExpanded`. */
export function thetaStar(opts: ThetaStarOptions): GridPoint[] | null {
  const {
    rows,
    cols,
    start,
    goal,
    lineOfSight,
    cost,
    heuristic,
    maxExpanded = 50_000,
  } = opts;

  const idx = (r: number, c: number) => r * cols + c;
  const startIdx = idx(start.r, start.c);
  const goalIdx = idx(goal.r, goal.c);
  if (startIdx === goalIdx) return [start];

  const g = new Float64Array(rows * cols).fill(Infinity);
  const parent = new Int32Array(rows * cols).fill(-1);
  const closed = new Uint8Array(rows * cols);

  g[startIdx] = 0;
  parent[startIdx] = startIdx;

  const open = new MinHeap();
  open.push(startIdx, heuristic(start));

  let expanded = 0;
  while (open.size() > 0) {
    const currentIdx = open.pop()!;
    if (closed[currentIdx]) continue;
    closed[currentIdx] = 1;
    expanded++;
    if (expanded > maxExpanded) return null;

    if (currentIdx === goalIdx) {
      return reconstruct(parent, currentIdx, cols);
    }

    const cr = Math.floor(currentIdx / cols);
    const cc = currentIdx - cr * cols;
    const current: GridPoint = { r: cr, c: cc };
    const parentIdx = parent[currentIdx];
    const pr = Math.floor(parentIdx / cols);
    const pc = parentIdx - pr * cols;
    const parentPt: GridPoint = { r: pr, c: pc };

    for (const [dr, dc] of NEIGHBOR_OFFSETS) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = idx(nr, nc);
      if (closed[nIdx]) continue;
      const succ: GridPoint = { r: nr, c: nc };

      // Path 2 (Theta*): try straight line from parent(current) to
      // successor. If LOS holds, adopt the grandparent as the successor's
      // parent — this smooths out grid-axis kinks.
      let newParentIdx: number;
      let newG: number;
      if (
        parentIdx !== currentIdx &&
        lineOfSight(parentPt, succ, g[parentIdx])
      ) {
        newParentIdx = parentIdx;
        newG = g[parentIdx] + cost(parentPt, succ);
      } else if (lineOfSight(current, succ, g[currentIdx])) {
        newParentIdx = currentIdx;
        newG = g[currentIdx] + cost(current, succ);
      } else {
        continue;
      }

      if (newG < g[nIdx]) {
        g[nIdx] = newG;
        parent[nIdx] = newParentIdx;
        open.push(nIdx, newG + heuristic(succ));
      }
    }
  }

  return null;
}

function reconstruct(
  parent: Int32Array,
  goalIdx: number,
  cols: number,
): GridPoint[] {
  const rev: GridPoint[] = [];
  let cur = goalIdx;
  const seen = new Set<number>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const r = Math.floor(cur / cols);
    const c = cur - r * cols;
    rev.push({ r, c });
    const next = parent[cur];
    if (next === cur || next < 0) break;
    cur = next;
  }
  return rev.reverse();
}

