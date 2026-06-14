/**
 * Uniform spatial hash grid for fast neighbor queries.
 *
 * Rebuilt each tick from agent positions; turns O(n²) proximity checks into roughly
 * O(n) by only comparing agents in nearby cells. Stores integer payloads (we store the
 * agent's index into the live `agents` array, which is stable during a single tick's
 * update pass). The caller still does the exact distance test on returned candidates.
 */
export class SpatialGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly buckets: number[][];

  constructor(width: number, height: number, cell: number) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  clear(): void {
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
  }

  private cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cell);
    let cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  insert(payload: number, x: number, y: number): void {
    this.buckets[this.cellIndex(x, y)].push(payload);
  }

  /**
   * Collect payloads in cells overlapping the (x, y, r) query box into `out` (reused to
   * avoid allocations). Candidates may lie just outside r — the caller filters by exact
   * distance. Returns `out`.
   */
  queryRadius(x: number, y: number, r: number, out: number[]): number[] {
    out.length = 0;
    const minCx = Math.max(0, Math.floor((x - r) / this.cell));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + r) / this.cell));
    const minCy = Math.max(0, Math.floor((y - r) / this.cell));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + r) / this.cell));
    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowBase = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[rowBase + cx];
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}
