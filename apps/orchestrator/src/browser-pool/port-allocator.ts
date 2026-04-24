/**
 * Slot allocator for the browser pool.
 *
 * A "slot" is a zero-indexed offset (0 … maxInstances-1). Slot i
 * always maps to:
 *   display  = displayStart  + i
 *   cdpPort  = cdpPortStart  + i
 *   vncPort  = vncPortStart  + i
 *   wsPort   = wsPortStart   + i
 *
 * The allocator tracks which slots are in use. It has no opinion on
 * user-data-dir or process lifecycle — that's the BrowserPool's job.
 *
 * Slot indices are kept stable across the orchestrator's lifetime so
 * that a user coming back after a release can be re-placed on the
 * same slot (if free), re-using the already-open file descriptors
 * and the per-display Xvfb fontcache. Not required for correctness
 * but cheap to preserve.
 */

import type { BrowserSlot, PoolConfig } from './types.js';

export class SlotAllocator {
  private readonly inUse: Set<number> = new Set();
  private readonly capacity: number;

  constructor(private readonly config: PoolConfig) {
    this.capacity = config.maxInstances;
  }

  /**
   * Claim the lowest free slot index. Throws when the pool is at
   * capacity — callers should surface a clear "too many users" error
   * to the end user rather than blocking.
   */
  claim(): BrowserSlot {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.inUse.has(i)) {
        this.inUse.add(i);
        return this.slotAt(i);
      }
    }
    throw new Error(
      `SlotAllocator: all ${this.capacity} slots in use`,
    );
  }

  /**
   * Attempt to reclaim a specific slot index — used when reviving a
   * previously released instance for the same user. Returns null if
   * the slot is currently occupied; caller should fall back to claim().
   */
  tryClaim(index: number): BrowserSlot | null {
    if (index < 0 || index >= this.capacity) return null;
    if (this.inUse.has(index)) return null;
    this.inUse.add(index);
    return this.slotAt(index);
  }

  release(slot: BrowserSlot): void {
    this.inUse.delete(slot.index);
  }

  /** For stats / health checks. */
  usedCount(): number {
    return this.inUse.size;
  }

  availableCount(): number {
    return this.capacity - this.inUse.size;
  }

  isFull(): boolean {
    return this.inUse.size >= this.capacity;
  }

  /** Map an index to the deterministic port quartet. */
  slotAt(index: number): BrowserSlot {
    return {
      index,
      display: this.config.displayStart + index,
      cdpPort: this.config.cdpPortStart + index,
      vncPort: this.config.vncPortStart + index,
      wsPort: this.config.wsPortStart + index,
    };
  }
}
