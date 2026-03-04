import { useRef, useEffect, useState, useCallback } from "react";

interface BubbleData {
  id: string;
  symbol: string;
  label2: string;
  label3?: string;
  radius: number;
  color: string;
}

interface BubbleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface BubblePhysicsProps {
  bubbles: BubbleData[];
  height?: number;
  onHover?: (id: string | null) => void;
  onClick?: (id: string) => void;
  hoveredId?: string | null;
}

const DAMPING = 0.998;
const BOUNCE = 0.7;
const REPULSION = 0.4;
const DRIFT_FORCE = 0.02;

export default function BubblePhysics({ bubbles, height = 450, onHover, onClick, hoveredId }: BubblePhysicsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statesRef = useRef<Map<string, BubbleState>>(new Map());
  const rafRef = useRef<number>(0);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize bubble positions
  const initBubbles = useCallback((width: number, h: number) => {
    const states = new Map<string, BubbleState>();
    bubbles.forEach((b, i) => {
      const existing = statesRef.current.get(b.id);
      if (existing) {
        states.set(b.id, existing);
      } else {
        const angle = (i / bubbles.length) * Math.PI * 2;
        const spread = Math.min(width, h) * 0.3;
        states.set(b.id, {
          x: width / 2 + Math.cos(angle) * spread * (0.5 + Math.random() * 0.5),
          y: h / 2 + Math.sin(angle) * spread * (0.5 + Math.random() * 0.5),
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
        });
      }
    });
    statesRef.current = states;
  }, [bubbles]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    initBubbles(w, height);

    const radiusMap = new Map(bubbles.map(b => [b.id, b.radius]));

    const tick = () => {
      const states = statesRef.current;
      const ids = Array.from(states.keys());

      // Physics step
      for (let i = 0; i < ids.length; i++) {
        const a = states.get(ids[i])!;
        const ra = radiusMap.get(ids[i]) || 30;

        // Random drift
        a.vx += (Math.random() - 0.5) * DRIFT_FORCE;
        a.vy += (Math.random() - 0.5) * DRIFT_FORCE;

        // Mouse repulsion
        if (mouseRef.current) {
          const dx = a.x - mouseRef.current.x;
          const dy = a.y - mouseRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < ra + 60 && dist > 0) {
            const force = (ra + 60 - dist) * 0.015;
            a.vx += (dx / dist) * force;
            a.vy += (dy / dist) * force;
          }
        }

        // Bubble-bubble collisions
        for (let j = i + 1; j < ids.length; j++) {
          const b = states.get(ids[j])!;
          const rb = radiusMap.get(ids[j]) || 30;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = ra + rb + 4;

          if (dist < minDist && dist > 0) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;

            // Separate
            a.x -= nx * overlap * REPULSION;
            a.y -= ny * overlap * REPULSION;
            b.x += nx * overlap * REPULSION;
            b.y += ny * overlap * REPULSION;

            // Bounce velocities
            const dvx = a.vx - b.vx;
            const dvy = a.vy - b.vy;
            const dot = dvx * nx + dvy * ny;
            if (dot > 0) {
              a.vx -= dot * nx * BOUNCE;
              a.vy -= dot * ny * BOUNCE;
              b.vx += dot * nx * BOUNCE;
              b.vy += dot * ny * BOUNCE;
            }
          }
        }

        // Wall collisions
        if (a.x - ra < 0) { a.x = ra; a.vx = Math.abs(a.vx) * BOUNCE; }
        if (a.x + ra > w) { a.x = w - ra; a.vx = -Math.abs(a.vx) * BOUNCE; }
        if (a.y - ra < 0) { a.y = ra; a.vy = Math.abs(a.vy) * BOUNCE; }
        if (a.y + ra > height) { a.y = height - ra; a.vy = -Math.abs(a.vy) * BOUNCE; }

        // Damping
        a.vx *= DAMPING;
        a.vy *= DAMPING;

        // Speed limit
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
        if (speed > 2.5) {
          a.vx = (a.vx / speed) * 2.5;
          a.vy = (a.vy / speed) * 2.5;
        }

        // Update position
        a.x += a.vx;
        a.y += a.vy;
      }

      // Publish positions for render
      const newPos = new Map<string, { x: number; y: number }>();
      states.forEach((s, id) => newPos.set(id, { x: s.x, y: s.y }));
      setPositions(newPos);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [bubbles, height, initBubbles]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl"
      style={{ height }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { mouseRef.current = null; onHover?.(null); }}
    >
      {bubbles.map((b) => {
        const pos = positions.get(b.id);
        if (!pos) return null;
        const isHovered = hoveredId === b.id;
        const d = b.radius * 2;

        return (
          <div
            key={b.id}
            className="absolute cursor-pointer select-none"
            style={{
              width: d,
              height: d,
              left: pos.x - b.radius,
              top: pos.y - b.radius,
              willChange: "transform",
            }}
            onMouseEnter={() => onHover?.(b.id)}
            onClick={() => onClick?.(b.id)}
          >
            {/* Glow */}
            <div
              className="absolute inset-0 rounded-full blur-xl pointer-events-none"
              style={{
                backgroundColor: b.color,
                opacity: isHovered ? 0.4 : 0.1,
                transition: "opacity 0.3s",
              }}
            />
            {/* Circle */}
            <div
              className="relative w-full h-full rounded-full flex flex-col items-center justify-center border pointer-events-none"
              style={{
                backgroundColor: b.color + "18",
                borderColor: isHovered ? b.color : b.color + "44",
                transform: isHovered ? "scale(1.1)" : "scale(1)",
                transition: "transform 0.3s, border-color 0.3s, box-shadow 0.3s",
                boxShadow: isHovered
                  ? `0 0 40px ${b.color}55, inset 0 0 25px ${b.color}15`
                  : `0 0 10px ${b.color}11`,
              }}
            >
              <span className="font-bold text-foreground leading-none" style={{ fontSize: Math.max(9, b.radius * 0.28) }}>
                {b.symbol}
              </span>
              <span className="font-mono font-medium leading-none mt-0.5" style={{ fontSize: Math.max(7, b.radius * 0.2) }}>
                {b.label2}
              </span>
              {b.label3 && b.radius > 35 && (
                <span className="text-muted-foreground font-mono leading-none mt-0.5" style={{ fontSize: Math.max(6, b.radius * 0.14) }}>
                  {b.label3}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
