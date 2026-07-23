import { describe, it, expect, vi } from 'vitest';
import { createMapMethods, MapMethodsDeps, MapViewState } from './map-methods';
import { Position } from 'src/app/types';

const VIEW: MapViewState = {
  center: [-80, 25],
  zoom: 12,
  bounds: [-80.5, 24.5, -79.5, 25.5]
};

function setup(overrides: Partial<MapMethodsDeps> = {}) {
  const deps = {
    getView: vi.fn<() => MapViewState>(() => VIEW),
    zoomRange: vi.fn(() => ({ min: 2, max: 28 })),
    moveTo: vi.fn(),
    zoomForBounds: vi.fn(() => 9),
    centerAfterPan: vi.fn<(dx: number, dy: number) => Position | null>(() => [
      -79, 24
    ]),
    ...overrides
  };
  const methods = createMapMethods(deps);
  // The bus dispatches handlers as (params, ctx); ctx is unused here.
  const call = async (name: string, params?: unknown) =>
    methods[name](params, {} as never);
  return { deps, methods, call };
}

describe('map.getView', () => {
  it('returns the current center, zoom and bounds', async () => {
    const { call } = setup();
    expect(await call('map.getView')).toEqual({
      center: [-80, 25],
      zoom: 12,
      bounds: [-80.5, 24.5, -79.5, 25.5]
    });
  });
});

describe('map.center', () => {
  it('moves to a position with an explicit zoom', async () => {
    const { call, deps } = setup();
    expect(await call('map.center', { position: [10, 50], zoom: 8 })).toEqual(
      {}
    );
    expect(deps.moveTo).toHaveBeenCalledWith([10, 50], 8);
  });

  it('keeps the current zoom when none is given', async () => {
    const { call, deps } = setup();
    await call('map.center', { position: [10, 50] });
    expect(deps.moveTo).toHaveBeenCalledWith([10, 50], undefined);
  });

  it('rejects a malformed position with INVALID_POSITION', async () => {
    const { call } = setup();
    await expect(call('map.center', { position: [10] })).rejects.toHaveProperty(
      'reason',
      'INVALID_POSITION'
    );
    await expect(
      call('map.center', { position: [10, 'x'] })
    ).rejects.toHaveProperty('reason', 'INVALID_POSITION');
  });
});

describe('map.fitBounds', () => {
  it('centers on the bbox midpoint at the framing zoom', async () => {
    const { call, deps } = setup();
    await call('map.fitBounds', { bounds: [-10, -20, 10, 20] });
    expect(deps.zoomForBounds).toHaveBeenCalledWith([-10, -20, 10, 20]);
    expect(deps.moveTo).toHaveBeenCalledWith([0, 0], 9);
  });

  it('rejects malformed bounds with INVALID_BOUNDS', async () => {
    const { call } = setup();
    await expect(
      call('map.fitBounds', { bounds: [1, 2, 3] })
    ).rejects.toHaveProperty('reason', 'INVALID_BOUNDS');
  });
});

describe('map.setZoom', () => {
  it('sets an absolute zoom, keeping the current center', async () => {
    const { call, deps } = setup();
    await call('map.setZoom', { zoom: 6 });
    expect(deps.moveTo).toHaveBeenCalledWith([-80, 25], 6);
  });

  it('clamps to the host zoom range', async () => {
    const { call, deps } = setup();
    await call('map.setZoom', { zoom: 99 });
    expect(deps.moveTo).toHaveBeenCalledWith([-80, 25], 28);
  });

  it('rejects a non-number zoom with INVALID_ZOOM', async () => {
    const { call } = setup();
    await expect(call('map.setZoom', { zoom: 'x' })).rejects.toHaveProperty(
      'reason',
      'INVALID_ZOOM'
    );
  });
});

describe('map.zoomBy', () => {
  it('applies a relative zoom delta from the current zoom', async () => {
    const { call, deps } = setup();
    await call('map.zoomBy', { delta: 2 });
    expect(deps.moveTo).toHaveBeenCalledWith([-80, 25], 14);
  });

  it('clamps the resulting zoom to the host range', async () => {
    const { call, deps } = setup();
    await call('map.zoomBy', { delta: -100 });
    expect(deps.moveTo).toHaveBeenCalledWith([-80, 25], 2);
  });

  it('rejects a non-number delta with INVALID_DELTA', async () => {
    const { call } = setup();
    await expect(call('map.zoomBy', {})).rejects.toHaveProperty(
      'reason',
      'INVALID_DELTA'
    );
  });
});

describe('map.panBy', () => {
  it('pans by a pixel delta and moves to the resolved center', async () => {
    const { call, deps } = setup();
    await call('map.panBy', { dx: 100, dy: -40 });
    expect(deps.centerAfterPan).toHaveBeenCalledWith(100, -40);
    expect(deps.moveTo).toHaveBeenCalledWith([-79, 24]);
  });

  it('is a no-op for a zero delta', async () => {
    const { call, deps } = setup();
    expect(await call('map.panBy', { dx: 0, dy: 0 })).toEqual({});
    expect(deps.centerAfterPan).not.toHaveBeenCalled();
    expect(deps.moveTo).not.toHaveBeenCalled();
  });

  it('rejects a non-number delta with INVALID_PAN', async () => {
    const { call } = setup();
    await expect(call('map.panBy', { dx: 10, dy: 'x' })).rejects.toHaveProperty(
      'reason',
      'INVALID_PAN'
    );
  });

  it('reports map.notReady when the view is unavailable', async () => {
    const { call } = setup({ centerAfterPan: vi.fn(() => null) });
    await expect(call('map.panBy', { dx: 10, dy: 10 })).rejects.toHaveProperty(
      'reason',
      'map.notReady'
    );
  });
});
