// Преобразует линию переменной длины в замкнутый контур для шрифта.
function circle(cx, cy, r, count = 20) {
  return Array.from({ length: count }, (_, i) => {
    const a = -2 * Math.PI * i / count;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}
function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
function arc(cx, cy, r, from, to, steps = 8) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + delta * i / steps;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}
export function strokeToContours(raw, radius) {
  if (!raw?.length) return [];
  const r = Math.max(1, radius);
  const points = [raw[0]];
  for (const p of raw.slice(1)) {
    const last = points[points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= Math.max(1, r * 0.45)) points.push(p);
  }
  if (points.length === 1) return [circle(points[0].x, points[0].y, r)];
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * r, ny = dx / len * r;
    left.push({ x: points[i].x + nx, y: points[i].y + ny });
    right.push({ x: points[i].x - nx, y: points[i].y - ny });
  }
  const firstAngle = Math.atan2(left[0].y - points[0].y, left[0].x - points[0].x);
  const lastAngle = Math.atan2(right.at(-1).y - points.at(-1).y, right.at(-1).x - points.at(-1).x);
  const endCap = arc(points.at(-1).x, points.at(-1).y, r, lastAngle, lastAngle + Math.PI, 10);
  const startCap = arc(points[0].x, points[0].y, r, firstAngle + Math.PI, firstAngle + Math.PI * 2, 10);
  let contour = [...left, ...endCap, ...right.reverse(), ...startCap];
  if (area(contour) > 0) contour = contour.reverse();
  return [contour];
}