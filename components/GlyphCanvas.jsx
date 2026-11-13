
import { useEffect, useRef, useState } from 'react';
import {
  METRICS,
  applyEraserToStrokes,
  applySelectionToStrokes
} from '../lib/project.js';

const VIEW = {
  xMin: -60,
  xMax: 940,
  yMin: -260,
  yMax: 840
};

const VIEW_H = VIEW.yMax - VIEW.yMin;

export default function GlyphCanvas({
  glyph,
  penWidth,
  penColor = '#f2eee7',
  eraserSize = 54,
  eraserMode = 'hard',
  toolMode = 'pen',
  showGuides,
  onCommit
}) {
  const canvasRef = useRef(null);
  const activeStroke = useRef(null);
  const selection = useRef(null);
  const [redraw, setRedraw] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
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

      // Направляющие типографики
      if (showGuides) {
        const guides = [
          [METRICS.ascender, '#3b82f6', 'верхняя линия'],
          [METRICS.capHeight, '#6366f1', 'высота прописных'],
          [METRICS.xHeight, '#8b5cf6', 'строчная'],
          [0, '#22c55e', 'базовая линия'],
          [METRICS.descender, '#ef4444', 'нижняя линия']
        ];

        for (const [y, color, label] of guides) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, Y(y));
          ctx.lineTo(rect.width, Y(y));
          ctx.stroke();

          ctx.fillStyle = color;
          ctx.font = '10px sans-serif';
          ctx.fillText(label, 8, Y(y) - 4);
        }
      }

      // Отрисовка обычных штрихов
      const paint = stroke => {
        const points = stroke?.points || [];
        if (!points.length) return;

        ctx.strokeStyle = stroke.color || penColor;
        ctx.fillStyle = stroke.color || penColor;

        ctx.lineWidth = Math.max(
          1,
          (stroke.width || penWidth || 70) * scale
        );

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (points.length === 1) {
          ctx.beginPath();
          ctx.arc(
            X(points[0].x),
            Y(points[0].y),
            ctx.lineWidth / 2,
            0,
            Math.PI * 2
          );
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(X(points[0].x), Y(points[0].y));

          for (const point of points.slice(1)) {
            ctx.lineTo(X(point.x), Y(point.y));
          }

          ctx.stroke();
        }
      };

      // Отображение импортированных контуров
      const outlines = Array.isArray(glyph?.outlines)
        ? glyph.outlines
        : [];

      if (outlines.length) {
        ctx.save();
        ctx.fillStyle = penColor;
        ctx.beginPath();

        for (const contour of outlines) {
          if (!Array.isArray(contour) || contour.length < 3) {
            continue;
          }

          const valid = contour.every(point =>
            Number.isFinite(point?.x) &&
            Number.isFinite(point?.y)
          );

          if (!valid) continue;

          ctx.moveTo(
            X(contour[0].x),
            Y(contour[0].y)
          );

          for (const point of contour.slice(1)) {
            ctx.lineTo(
              X(point.x),
              Y(point.y)
            );
          }

          ctx.closePath();
        }

        ctx.fill('evenodd');
        ctx.restore();
      }

      // Отображение ранее нарисованных штрихов
      (glyph?.strokes || []).forEach(paint);

      // Отображение активного инструмента
      if (activeStroke.current) {
        const stroke = activeStroke.current;

        if (stroke.tool === 'eraser') {
          ctx.save();

          ctx.globalAlpha =
            stroke.mode === 'soft' ? 0.34 : 0.78;

          ctx.strokeStyle =
            stroke.mode === 'soft' ? '#9ec5ff' : '#ff8585';

          ctx.fillStyle = ctx.strokeStyle;
          ctx.lineWidth = Math.max(1, stroke.width * scale);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (stroke.points.length === 1) {
            ctx.beginPath();
            ctx.arc(
              X(stroke.points[0].x),
              Y(stroke.points[0].y),
              ctx.lineWidth / 2,
              0,
              Math.PI * 2
            );
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.moveTo(
              X(stroke.points[0].x),
              Y(stroke.points[0].y)
            );

            stroke.points.slice(1).forEach(point => {
              ctx.lineTo(X(point.x), Y(point.y));
            });

            ctx.stroke();
          }

          ctx.restore();
        } else {
          paint(stroke);
        }
      }

      // Отображение выделенной области
      if (selection.current) {
        const { start, end } = selection.current;

        const left = Math.min(X(start.x), X(end.x));
        const top = Math.min(Y(start.y), Y(end.y));

        const width = Math.abs(X(end.x) - X(start.x));
        const height = Math.abs(Y(end.y) - Y(start.y));

        ctx.save();

        ctx.fillStyle = 'rgba(95,165,255,.16)';
        ctx.strokeStyle = '#7cb8ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 4]);

        ctx.fillRect(left, top, width, height);
        ctx.strokeRect(left, top, width, height);

        ctx.setLineDash([]);
        ctx.fillStyle = '#cfe4ff';
        ctx.font = '12px sans-serif';

        ctx.fillText(
          `${Math.round(width / scale)} × ${Math.round(height / scale)}`,
          left + 6,
          Math.max(16, top - 7)
        );

        ctx.restore();
      }
    };

    draw();

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);

    return () => observer.disconnect();

  }, [glyph, penColor, penWidth, showGuides, redraw]);

  // Преобразование координат указателя
  const pointFrom = event => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = rect.height / VIEW_H;

    return {
      x: (event.clientX - rect.left) / scale + VIEW.xMin,
      y: VIEW.yMax - (event.clientY - rect.top) / scale
    };
  };

  // Начало рисования
  const down = event => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const point = pointFrom(event);

    if (toolMode === 'selection') {
      selection.current = {
        start: point,
        end: point
      };
    } else if (toolMode === 'eraser') {
      activeStroke.current = {
        tool: 'eraser',
        mode: eraserMode,
        width: eraserSize,
        points: [point]
      };
    } else {
      activeStroke.current = {
        tool: 'pen',
        width: penWidth,
        color: penColor,
        points: [point]
      };
    }

    setRedraw(value => value + 1);
  };

  // Продолжение рисования
  const move = event => {
    const point = pointFrom(event);

    if (selection.current) {
      selection.current.end = point;
      setRedraw(value => value + 1);
      return;
    }

    if (!activeStroke.current) return;

    const points = activeStroke.current.points;
    const last = points[points.length - 1];

    if (Math.hypot(
      point.x - last.x,
      point.y - last.y
    ) > 2) {
      points.push(point);
    }

    setRedraw(value => value + 1);
  };

  // Завершение рисования
  const finish = () => {
    if (selection.current) {
      const area = selection.current;
      selection.current = null;

      if (
        Math.abs(area.end.x - area.start.x) > 3 &&
        Math.abs(area.end.y - area.start.y) > 3
      ) {
        onCommit(
          applySelectionToStrokes(
            glyph?.strokes || [],
            area
          )
        );
      }

      setRedraw(value => value + 1);
      return;
    }

    if (!activeStroke.current) return;

    const stroke = activeStroke.current;
    activeStroke.current = null;

    onCommit(
      stroke.tool === 'eraser'
        ? applyEraserToStrokes(
            glyph?.strokes || [],
            stroke,
            stroke.mode
          )
        : [...(glyph?.strokes || []), stroke]
    );

    setRedraw(value => value + 1);
  };

  return (
    <div
      className={`canvas-wrap ${
        toolMode === 'selection'
          ? 'selection-mode'
          : toolMode === 'eraser'
            ? 'eraser-mode'
            : 'pen-mode'
      }`}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{ touchAction: 'none' }}
        aria-label="Поле рисования символа"
      />
    </div>
  );
}
