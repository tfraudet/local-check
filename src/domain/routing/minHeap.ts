/**
 * Binary min-heap keyed by a numeric priority.
 *
 * Shared by the Theta* search (open set keyed by f-score) and the
 * reachable-zone Dijkstra (frontier keyed by g-cost). Kept as a plain
 * class with two parallel typed arrays because both callers push/pop
 * tens of thousands of entries per run.
 */

export class MinHeap {
  private nodes: number[] = []; // caller-supplied opaque id (e.g. grid index)
  private keys: number[] = []; // priority; lowest key pops first

  size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    this.siftUp(this.nodes.length - 1);
  }

  pop(): number | undefined {
    if (this.nodes.length === 0) return undefined;
    const top = this.nodes[0];
    const lastNode = this.nodes.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.keys[0] = lastKey;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  private siftDown(i: number): void {
    const n = this.nodes.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let best = i;
      if (l < n && this.keys[l] < this.keys[best]) best = l;
      if (r < n && this.keys[r] < this.keys[best]) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }

  private swap(a: number, b: number): void {
    const nt = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = nt;
    const kt = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = kt;
  }
}
