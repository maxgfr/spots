/**
 * The sheet that holds every screen. On a phone it is a bottom sheet with three
 * resting heights (peek, half, full), dragged by its eyelet; on a wide screen
 * it is a column beside the map. It tells the map how much it covers.
 */
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { l, tr } from "../i18n";
import { sheetInset } from "../map/MapView";

export type Snap = "peek" | "half" | "full";

/** Asks the sheet to rest at a height (screens set it when they open). */
/** Where the sheet rests now. */
export const currentSnap = signal<Snap>("peek");

export const snapRequest = signal<{ snap: Snap; n: number }>({ snap: "peek", n: 0 });
let requestSeq = 0;
export function requestSnap(snap: Snap): void {
  snapRequest.value = { snap, n: ++requestSeq };
}

const PEEK = 188;

function wide(): boolean {
  return matchMedia("(min-width: 900px)").matches;
}

function heights(): Record<Snap, number> {
  const vh = window.innerHeight;
  // Full leaves the top bar and a strip of map visible, so the sheet still reads as over the map.
  return { peek: PEEK, half: Math.round(vh * 0.52), full: vh - 118 };
}

export function Sheet({ children }: { children: ComponentChildren }) {
  const [snap, setSnap] = useState<Snap>(snapRequest.value.snap);
  const [isWide, setWide] = useState(wide());
  const [drag, setDrag] = useState<number | null>(null);
  const [, setSize] = useState(0);
  const start = useRef<{ y: number; h: number; t: number } | null>(null);
  const dragged = useRef(false);
  const el = useRef<HTMLElement>(null);

  useEffect(() => {
    setSnap(snapRequest.value.snap);
  }, [snapRequest.value.n]);

  useEffect(() => {
    const onResize = () => {
      setWide(wide());
      setSize(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const h = heights();
  const height = drag ?? h[snap];

  useEffect(() => {
    currentSnap.value = snap;
  }, [snap]);

  useEffect(() => {
    sheetInset.value = isWide ? { bottom: 0, left: 424 } : { bottom: drag ?? h[snap], left: 0 };
  }, [isWide, snap, drag, h.half, h.full]);

  const onDown = (e: PointerEvent) => {
    if (isWide) return;
    start.current = { y: e.clientY, h: height, t: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const next = Math.min(h.full, Math.max(96, s.h + (s.y - e.clientY)));
    if (Math.abs(next - s.h) > 4) setDrag(next);
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || drag === null) return;
    dragged.current = true;
    const v = (s.y - e.clientY) / Math.max(1, performance.now() - s.t); // px per ms, up is positive
    const target = drag + v * 220;
    const order: Snap[] = ["peek", "half", "full"];
    let best: Snap = "peek";
    for (const k of order) if (Math.abs(h[k] - target) < Math.abs(h[best] - target)) best = k;
    setSnap(best);
    setDrag(null);
  };

  const nextLabel =
    snap === "peek"
      ? tr(l("Open the panel", "Ouvrir le panneau"))
      : tr(l("Lower the panel", "Baisser le panneau"));

  return (
    <section
      ref={el}
      class={drag !== null ? "sheet dragging" : "sheet"}
      style={isWide ? {} : { height: `${height}px` }}
      aria-label={tr(l("Panel", "Panneau"))}
      data-snap={snap}
    >
      <div class="sheet-paper">
        <button
          type="button"
          class="sheet-grip"
          aria-label={nextLabel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onClick={() => {
            // A tap (or Enter) on the eyelet toggles between peek and half; a drag already moved it.
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            if (!isWide) setSnap(snap === "peek" ? "half" : "peek");
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") setSnap(snap === "peek" ? "half" : "full");
            if (e.key === "ArrowDown") setSnap(snap === "full" ? "half" : "peek");
          }}
        >
          <span class="eyelet" />
        </button>
        <div class="sheet-body">{children}</div>
      </div>
    </section>
  );
}
