import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const MIN_SOURCE_WIDTH = 20;
const MAX_SOURCE_WIDTH = 80;
export const DEFAULT_SOURCE_WIDTH = 40;
const MIN_SOURCE_PIXELS = 240;
const MIN_ANALYSIS_PIXELS = 320;

export function PanelDivider({
  value,
  onChange,
  onHiddenFocus,
}: {
  value: number;
  onChange: (value: number) => void;
  onHiddenFocus: () => void;
}) {
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [limits, setLimits] = useState({
    min: MIN_SOURCE_WIDTH,
    max: MAX_SOURCE_WIDTH,
  });

  const fitPanels = useEffectEvent((available: number) => {
    const min = Math.max(
      MIN_SOURCE_WIDTH,
      Math.ceil((MIN_SOURCE_PIXELS / available) * 100),
    );
    const max = Math.min(
      MAX_SOURCE_WIDTH,
      Math.floor(((available - MIN_ANALYSIS_PIXELS) / available) * 100),
    );
    if (min > max) return;
    setLimits((current) =>
      current.min === min && current.max === max ? current : { min, max },
    );
    const fitted = Math.min(max, Math.max(min, value));
    if (fitted !== value) onChange(fitted);
  });
  const preserveFocus = useEffectEvent(() => {
    if (focused.current) {
      focused.current = false;
      onHiddenFocus();
    }
  });

  useEffect(() => {
    const divider = dividerRef.current;
    const grid = divider?.parentElement;
    if (!divider || !grid) return;
    const observer = new ResizeObserver(() => {
      const handleWidth = divider.getBoundingClientRect().width;
      if (handleWidth === 0) {
        preserveFocus();
        return;
      }
      fitPanels(grid.getBoundingClientRect().width - handleWidth);
    });
    observer.observe(grid);
    observer.observe(divider);
    return () => observer.disconnect();
  }, []);

  function resize(next: number) {
    onChange(Math.min(limits.max, Math.max(limits.min, next)));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const divider = event.currentTarget;
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      offset: event.clientX - divider.getBoundingClientRect().left,
    };
    setDragging(true);
  }

  function moveDivider(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const divider = event.currentTarget;
    const grid = divider.parentElement?.getBoundingClientRect();
    if (!grid) return;
    const available = grid.width - divider.getBoundingClientRect().width;
    if (available <= 0) return;
    resize(
      ((event.clientX - grid.left - drag.current.offset) / available) * 100,
    );
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    const positions: Record<string, number> = {
      ArrowLeft: value - step,
      ArrowRight: value + step,
      Home: limits.min,
      End: limits.max,
    };
    const next = positions[event.key];
    if (next == null) return;
    event.preventDefault();
    resize(next);
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- A focusable separator is the ARIA window-splitter widget.
    <div
      ref={dividerRef}
      className="panel-divider"
      role="separator"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Window splitters support arrow-key resizing.
      tabIndex={0}
      aria-label="Resize source and analysis"
      aria-orientation="vertical"
      aria-controls="source-document-panel analysis-document-panel"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`Source ${Math.round(value)}%, analysis ${Math.round(100 - value)}%`}
      title="Drag to resize. Double-click to reset. Arrow keys also adjust the split."
      data-dragging={dragging || undefined}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(event) => {
        if (event.currentTarget.getBoundingClientRect().width > 0)
          focused.current = false;
      }}
      onPointerDown={startDrag}
      onPointerMove={moveDivider}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onDoubleClick={() => resize(DEFAULT_SOURCE_WIDTH)}
      onKeyDown={handleKeyDown}
    >
      <span className="panel-divider-grip" aria-hidden="true" />
    </div>
  );
}
