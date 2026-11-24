export function fitCanvasView(rect, view) {
  const width = Math.max(1, Number(rect?.width) || 1);
  const height = Math.max(1, Number(rect?.height) || 1);
  const viewWidth = Math.max(1, Number(view?.xMax) - Number(view?.xMin));
  const viewHeight = Math.max(1, Number(view?.yMax) - Number(view?.yMin));
  const scale = Math.min(width / viewWidth, height / viewHeight);
  return {
    scale,
    offsetX: (width - viewWidth * scale) / 2,
    offsetY: (height - viewHeight * scale) / 2
  };
}

export function screenToWorld(clientX, clientY, rect, view) {
  const { scale, offsetX, offsetY } = fitCanvasView(rect, view);
  const x = (clientX - rect.left - offsetX) / scale + view.xMin;
  const y = view.yMax - (clientY - rect.top - offsetY) / scale;
  return {
    x: Math.max(view.xMin, Math.min(view.xMax, x)),
    y: Math.max(view.yMin, Math.min(view.yMax, y))
  };
}
