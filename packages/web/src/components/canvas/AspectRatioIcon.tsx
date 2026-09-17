import { cn } from "@/lib/utils";

const VIEW = 32;
const MAX = 22;

/** Wireframe aspect-ratio icon — full shape always visible inside a square frame. */
export function AspectRatioIcon({
  ratioId,
  className,
}: {
  ratioId: string;
  className?: string;
}) {
  const id = (ratioId || "").toLowerCase().trim();

  if (id === "auto") {
    return (
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className={cn("size-8 shrink-0", className)}
        aria-hidden
      >
        <rect
          x={(VIEW - MAX) / 2}
          y={(VIEW - MAX * 0.62) / 2}
          width={MAX}
          height={MAX * 0.62}
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="3.5 2.5"
          opacity="0.9"
        />
      </svg>
    );
  }

  let aspect = 1;
  if (id.includes(":")) {
    const [rw, rh] = id.split(":").map(Number);
    if (rw > 0 && rh > 0) aspect = rw / rh;
  } else if (id === "1x1") {
    aspect = 1;
  }

  let w: number;
  let h: number;
  if (aspect >= 1) {
    w = MAX;
    h = Math.max(8, Math.round(MAX / aspect));
  } else {
    h = MAX;
    w = Math.max(8, Math.round(MAX * aspect));
  }

  const x = (VIEW - w) / 2;
  const y = (VIEW - h) / 2;

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={cn("size-8 shrink-0", className)}
      aria-hidden
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.95"
      />
    </svg>
  );
}
