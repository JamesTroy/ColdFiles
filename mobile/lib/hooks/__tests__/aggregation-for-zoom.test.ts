import { describe, expect, it } from 'vitest';
import {
  POINT_ZOOM_THRESHOLD,
  aggregationForZoom,
} from '../map-aggregation';

// aggregationForZoom is the editorial schedule that drives mode flips
// between cases_in_bbox (point mode) and cases_grid_in_bbox (grid
// mode). It's the single source of truth for "what mode am I in" on
// the home screen — worth pinning the schedule with table tests so
// future tweaks don't silently shift the threshold or cell sizes.

describe('aggregationForZoom', () => {
  it('zoom ≥ POINT_ZOOM_THRESHOLD → point mode', () => {
    expect(aggregationForZoom(POINT_ZOOM_THRESHOLD)).toEqual({
      mode: 'point',
    });
    expect(aggregationForZoom(9)).toEqual({ mode: 'point' });
    expect(aggregationForZoom(13)).toEqual({ mode: 'point' });
    expect(aggregationForZoom(20)).toEqual({ mode: 'point' });
  });

  it('zoom 7 → 0.5° grid', () => {
    expect(aggregationForZoom(7)).toEqual({
      mode: 'grid',
      cellSizeDeg: 0.5,
    });
  });

  it('zoom 6 → 1.0° grid', () => {
    expect(aggregationForZoom(6)).toEqual({
      mode: 'grid',
      cellSizeDeg: 1.0,
    });
  });

  it('zoom 5 → 2.0° grid', () => {
    expect(aggregationForZoom(5)).toEqual({
      mode: 'grid',
      cellSizeDeg: 2.0,
    });
  });

  it('zoom ≤ 4 → 4.0° grid (continental)', () => {
    expect(aggregationForZoom(4)).toEqual({
      mode: 'grid',
      cellSizeDeg: 4.0,
    });
    expect(aggregationForZoom(3)).toEqual({
      mode: 'grid',
      cellSizeDeg: 4.0,
    });
    expect(aggregationForZoom(0)).toEqual({
      mode: 'grid',
      cellSizeDeg: 4.0,
    });
  });

  it('floors fractional zoom before mode lookup', () => {
    // Pinch gestures produce fractional zoom mid-animation. Mode
    // should latch at the floor so a 7.9 zoom is still 0.5° grid,
    // not point — the user hasn't actually crossed the threshold.
    expect(aggregationForZoom(7.9)).toEqual({
      mode: 'grid',
      cellSizeDeg: 0.5,
    });
    expect(aggregationForZoom(8.0)).toEqual({ mode: 'point' });
    // 8.0001 floors to 8 → still point.
    expect(aggregationForZoom(8.0001)).toEqual({ mode: 'point' });
    // 4.9 floors to 4 → 4° grid (not 5).
    expect(aggregationForZoom(4.9)).toEqual({
      mode: 'grid',
      cellSizeDeg: 4.0,
    });
  });

  it('threshold constant matches the schedule boundary', () => {
    // If POINT_ZOOM_THRESHOLD is changed, the schedule's cell-size
    // tiers above the threshold become unreachable; this assertion
    // catches that drift.
    const atThreshold = aggregationForZoom(POINT_ZOOM_THRESHOLD);
    const justBelow = aggregationForZoom(POINT_ZOOM_THRESHOLD - 1);
    expect(atThreshold.mode).toBe('point');
    expect(justBelow.mode).toBe('grid');
  });
});
