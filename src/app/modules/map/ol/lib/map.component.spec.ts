import { describe, it, expect } from 'vitest';
import { fromLonLat } from 'ol/proj';
import { MapComponent } from './map.component';

/**
 * The cursor lat/lon readout must stay correct when the view moves WITHOUT a
 * pointer event (touch pan, programmatic pan/zoom, keyboard). MapComponent
 * records the last pointer pixel on pointer-move and, on move-end, recomputes
 * the geographic point under that (unchanged) pixel from the live view via
 * `getCoordinateFromPixel`. `pointerLonLatAfterMove()` is the pure recompute
 * step; it only reads `this.map` and `this.lastPointerPixel`, so exercise it on
 * a bare prototype instance with a stub map — no Angular DI needed (same
 * approach as the ais-base spec).
 */
type PointerRecompute = {
  lastPointerPixel: number[] | null;
  map: unknown;
  pointerLonLatAfterMove: () => {
    pixel: number[] | null;
    coord: number[] | null;
    lonlat: number[] | null;
  };
};

// Stub map whose pixel->coordinate mapping is supplied per-call, so a "move" is
// modelled by returning a different projected coordinate for the same pixel.
function component(
  lastPointerPixel: number[] | null,
  coordForPixel: (pixel: number[]) => number[] | null
): PointerRecompute {
  const c = Object.create(MapComponent.prototype) as PointerRecompute;
  c.lastPointerPixel = lastPointerPixel;
  c.map = {
    getCoordinateFromPixel: (pixel: number[]) => coordForPixel(pixel),
    getView: () => ({ getProjection: () => 'EPSG:3857' })
  };
  return c;
}

describe('MapComponent.pointerLonLatAfterMove — cursor readout on move', () => {
  it('returns nulls when no pointer pixel has been recorded', () => {
    const c = component(null, () => [0, 0]);
    expect(c.pointerLonLatAfterMove()).toEqual({
      pixel: null,
      coord: null,
      lonlat: null
    });
  });

  it('returns nulls when the pixel maps to no coordinate', () => {
    const c = component([10, 20], () => null);
    expect(c.pointerLonLatAfterMove()).toEqual({
      pixel: null,
      coord: null,
      lonlat: null
    });
  });

  it('recomputes the geographic coordinate under the last pointer pixel', () => {
    const projected = fromLonLat([151.2, -33.85]); // Sydney, EPSG:3857
    const c = component([100, 200], () => projected);
    const res = c.pointerLonLatAfterMove();
    expect(res.pixel).toEqual([100, 200]);
    expect(res.coord).toEqual(projected);
    expect(res.lonlat[0]).toBeCloseTo(151.2, 6);
    expect(res.lonlat[1]).toBeCloseTo(-33.85, 6);
  });

  it('yields a different coordinate for the same pixel after the view moves', () => {
    const before = fromLonLat([0, 0]);
    const after = fromLonLat([10, 5]);
    let moved = false;
    const c = component([100, 200], () => (moved ? after : before));

    const first = c.pointerLonLatAfterMove();
    expect(first.lonlat[0]).toBeCloseTo(0, 6);
    expect(first.lonlat[1]).toBeCloseTo(0, 6);

    moved = true; // simulate a pan with the cursor held at the same pixel
    const second = c.pointerLonLatAfterMove();
    expect(second.pixel).toEqual([100, 200]);
    expect(second.lonlat[0]).toBeCloseTo(10, 6);
    expect(second.lonlat[1]).toBeCloseTo(5, 6);
  });
});
