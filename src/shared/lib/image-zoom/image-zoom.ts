export type ImageView = { zoom: number; pan: { x: number; y: number } };
export function zoomAtPoint(
  view: ImageView,
  factor: number,
  point: { x: number; y: number },
  maxZoom: number,
): ImageView {
  const zoom = Math.max(0.25, Math.min(maxZoom, view.zoom * factor));
  const ratio = zoom / view.zoom;
  // Do not clamp pan to the image bounds: even a fitted image must retain
  // the image coordinate beneath the pointer as its scale changes.
  return {
    zoom,
    pan: {
      x: point.x - (point.x - view.pan.x) * ratio,
      y: point.y - (point.y - view.pan.y) * ratio,
    },
  };
}
