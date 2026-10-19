import { useEffect, useRef } from 'react';

/**
 * A box the receiver signs with a finger. Calls onChange with a PNG data URL
 * after each stroke, or '' when cleared.
 */
export function SignaturePad({ label, clearLabel, onChange }: { label: string; clearLabel: string; onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * ratio;
    c.height = h * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1f2a33';
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawn.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (drawn.current) onChange(ref.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    drawn.current = false;
    onChange('');
  };

  return (
    <div>
      <canvas
        ref={ref}
        role="img"
        aria-label={label}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-line bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <button type="button" onClick={clear} className="mt-2 min-h-11 rounded-lg px-3 text-base font-medium text-primary hover:bg-canvas">
        {clearLabel}
      </button>
    </div>
  );
}
