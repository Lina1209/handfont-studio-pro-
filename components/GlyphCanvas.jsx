import { useEffect, useRef, useState } from 'react';
import { METRICS } from '../lib/project.js';

const VIEW = { xMin: -60, xMax: 940, yMin: -260, yMax: 840 };
const VIEW_H = VIEW.yMax - VIEW.yMin;

export default function GlyphCanvas({ glyph, penWidth, showGuides, onCommit }) {
  const canvasRef = useRef(null);
  const activeStroke = useRef(null);
  const [redraw, setRedraw] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, rect.width, rect.height);
    const scale = rect.height / VIEW_H;
    const X = x => (x - VIEW.xMin) * scale;
    const Y = y => (VIEW.yMax - y) * scale;

    if (showGuides) {
      const guides = [
        [METRICS.ascender, '#3b82f6', 'верхняя линия'],
        [METRICS.capHeight, '#6366f1', 'высота прописных'],
        [METRICS.xHeight, '#8b5cf6', 'строчная'],
        [0, '#22c55e', 'базовая линия'],
        [METRICS.descender, '#ef4444', 'нижняя линия']
      ];
      for (const [y, color, label] of guides) {
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(rect.width, Y(y)); ctx.stroke();
        ctx.fillStyle = color; ctx.font = '10px sans-serif'; ctx.fillText(label, 8, Y(y) - 4);
      }
    }
    const paint = stroke => {
      const pts = stroke?.points || [];
      if (!pts.length) return;
      ctx.strokeStyle = '#f2eee7'; ctx.fillStyle = '#f2eee7';
      ctx.lineWidth = Math.max(1, (stroke.width || 70) * scale);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (pts.length === 1) {
        ctx.beginPath(); ctx.arc(X(pts[0].x), Y(pts[0].y), ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(X(pts[0].x), Y(pts[0].y));
        for (const point of pts.slice(1)) ctx.lineTo(X(point.x), Y(point.y));
        ctx.stroke();
      }
    };
    (glyph.strokes || []).forEach(paint);
    if (activeStroke.current) paint(activeStroke.current);
  }, [glyph, showGuides, redraw]);

  const pointFrom = event => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = rect.height / VIEW_H;
    return { x: (event.clientX - rect.left) / scale + VIEW.xMin, y: VIEW.yMax - (event.clientY - rect.top) / scale };
  };
  const down = event => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeStroke.current = { width: penWidth, points: [pointFrom(event)] };
    setRedraw(value => value + 1);
  };
  const move = event => {
    if (!activeStroke.current) return;
    const point = pointFrom(event), points = activeStroke.current.points, last = points[points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) > 2) points.push(point);
    setRedraw(value => value + 1);
  };
  const finish = () => {
    if (!activeStroke.current) return;
    const stroke = activeStroke.current;
    activeStroke.current = null;
    onCommit([...(glyph.strokes || []), stroke]);
    setRedraw(value => value + 1);
  };

  return <div className="canvas-wrap">
    <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={finish} style={{ touchAction: 'none' }} aria-label="Поле рисования символа" />
  </div>;
}
