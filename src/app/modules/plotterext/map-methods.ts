import {
  RPC_ERRORS,
  RpcError,
  type MethodHandler
} from 'signalk-plotterext-bus/host';
import { Extent } from 'ol/extent';
import { Position } from 'src/app/types';

/**
 * Host method handlers for the `map` capability — query and control the chart
 * VIEW: read the current center/zoom/bounds, recenter, fit a bounding box, and
 * the relative controls a hardware knob needs (`map.zoomBy`, `map.panBy`).
 *
 * A pure factory over injected accessors so the handlers are unit-testable
 * without the Angular host service, matching the {@link createChartMethods}
 * pattern; the service spreads the result into each extension context's method
 * table.
 *
 * **Moves route through the host, not the OpenLayers view.** Every mutator hands
 * an absolute target to {@link MapMethodsDeps.moveTo}, which drives Freeboard's
 * own centering path (`mapMoveRequest` → the app effect → `centerAndZoom`).
 * Driving the OL view directly would bypass Freeboard's `mapCenter`/`mapZoom`
 * signal flow, so chart and resource layers would not refresh after the move —
 * hence the relative methods resolve to an absolute center/zoom here and defer
 * the actual view change to the host.
 */
export interface MapViewState {
  /** Current map center as `[lon, lat]`. */
  center: Position;
  /** Current zoom level. */
  zoom: number;
  /** Current geographic viewport extent `[minLon, minLat, maxLon, maxLat]`. */
  bounds: Extent;
}

export interface MapMethodsDeps {
  /** Read the current view: center (`[lon, lat]`), zoom and geographic bounds. */
  getView: () => MapViewState;
  /** The host's zoom clamp range, applied to `setZoom`/`zoomBy` targets. */
  zoomRange: () => { min: number; max: number };
  /**
   * Apply an absolute view change through the host's centering path (so chart
   * and resource layers refresh). Zoom is optional — omit to keep the current
   * zoom.
   */
  moveTo: (center: Position, zoom?: number) => void | Promise<void>;
  /** Compute a zoom level that frames a lon/lat bbox in the current viewport. */
  zoomForBounds: (bounds: number[]) => number;
  /**
   * The new center (`[lon, lat]`) after shifting the viewport by `(dx, dy)`
   * screen pixels (dx right, dy down) at the current resolution, or `null` when
   * the map is not yet ready.
   */
  centerAfterPan: (dx: number, dy: number) => Position | null;
}

export function createMapMethods(
  deps: MapMethodsDeps
): Record<string, MethodHandler> {
  const invalid = (message: string, reason: string) =>
    new RpcError(message, { code: RPC_ERRORS.INVALID_PARAMS, reason });

  const finiteNum = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);

  const clampZoom = (zoom: number): number => {
    const { min, max } = deps.zoomRange();
    return Math.min(max, Math.max(min, zoom));
  };

  return {
    'map.getView': async () => {
      const v = deps.getView();
      return { center: v.center, zoom: v.zoom, bounds: v.bounds };
    },

    'map.center': async (params) => {
      const { position, zoom } = (params ?? {}) as {
        position?: number[];
        zoom?: number;
      };
      if (
        !Array.isArray(position) ||
        position.length !== 2 ||
        !position.every(finiteNum)
      ) {
        throw invalid(
          'map.center requires position [lon, lat]',
          'INVALID_POSITION'
        );
      }
      await deps.moveTo(
        position as Position,
        finiteNum(zoom) ? zoom : undefined
      );
      return {};
    },

    'map.fitBounds': async (params) => {
      const { bounds } = (params ?? {}) as { bounds?: number[] };
      if (
        !Array.isArray(bounds) ||
        bounds.length !== 4 ||
        !bounds.every(finiteNum)
      ) {
        throw invalid(
          'map.fitBounds requires bounds [minLon, minLat, maxLon, maxLat]',
          'INVALID_BOUNDS'
        );
      }
      const [minLon, minLat, maxLon, maxLat] = bounds;
      const center: Position = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
      await deps.moveTo(center, deps.zoomForBounds(bounds));
      return {};
    },

    'map.setZoom': async (params) => {
      const { zoom } = (params ?? {}) as { zoom?: number };
      if (!finiteNum(zoom)) {
        throw invalid('map.setZoom requires a finite zoom', 'INVALID_ZOOM');
      }
      await deps.moveTo(deps.getView().center, clampZoom(zoom));
      return {};
    },

    'map.zoomBy': async (params) => {
      const { delta } = (params ?? {}) as { delta?: number };
      if (!finiteNum(delta)) {
        throw invalid('map.zoomBy requires a finite delta', 'INVALID_DELTA');
      }
      const v = deps.getView();
      await deps.moveTo(v.center, clampZoom(v.zoom + delta));
      return {};
    },

    'map.panBy': async (params) => {
      const { dx, dy } = (params ?? {}) as { dx?: number; dy?: number };
      if (!finiteNum(dx) || !finiteNum(dy)) {
        throw invalid(
          'map.panBy requires finite dx and dy (pixels)',
          'INVALID_PAN'
        );
      }
      if (dx === 0 && dy === 0) {
        return {};
      }
      const center = deps.centerAfterPan(dx, dy);
      if (!center) {
        throw new RpcError('map is not ready', { reason: 'map.notReady' });
      }
      await deps.moveTo(center);
      return {};
    }
  };
}
