export type ImageView = { zoom: number; pan: { x: number; y: number } };
export function zoomAtPoint(
  view: ImageView,
  factor: number,
  point: { x: number; y: number },
  fit: number,
  natural: { width: number; height: number },
  viewport: { width: number; height: number },
  maxZoom: number,
): ImageView {
  const zoom = Math.max(0.25, Math.min(maxZoom, view.zoom * factor));
  const ratio = zoom / view.zoom;
  const axis = (
    position: number,
    cursor: number,
    imageSize: number,
    viewportSize: number,
  ) => {
    const previousLimit = Math.max(
      0,
      (imageSize * fit * view.zoom - viewportSize) / 2 + 12,
    );
    const current = Math.max(-previousLimit, Math.min(previousLimit, position));
    const next = cursor - (cursor - current) * ratio;
    const limit = Math.max(0, (imageSize * fit * zoom - viewportSize) / 2 + 12);
    return Math.max(-limit, Math.min(limit, next));
  };
  return {
    zoom,
    pan: {
      x: axis(view.pan.x, point.x, natural.width, viewport.width),
      y: axis(view.pan.y, point.y, natural.height, viewport.height),
    },
  };
}
