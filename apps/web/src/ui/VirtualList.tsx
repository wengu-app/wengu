/**
 * Fixed-row-height virtual list: only the rows in view (plus a margin) are in the DOM, so 50,000 rows scroll like 50.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface VirtualListHandle {
  scrollToIndex(i: number): void;
  element(): HTMLDivElement | null;
}

export const VirtualList = forwardRef<
  VirtualListHandle,
  {
    count: number;
    rowHeight: number;
    renderRow(index: number): ReactNode;
    onRange?(start: number, end: number): void;
    overscan?: number;
    className?: string;
    label: string;
    activeId?: string;
    onKeyDown?(e: React.KeyboardEvent<HTMLDivElement>): void;
  }
>(function VirtualList(props, ref) {
  const { count, rowHeight, overscan = 8, onRange } = props;
  const el = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    setHeight(node.clientHeight);
    const ro = new ResizeObserver(() => setHeight(node.clientHeight));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);

  useEffect(() => {
    onRange?.(start, end);
  }, [start, end, onRange]);

  const scrollToIndex = useCallback(
    (i: number) => {
      const node = el.current;
      if (!node) return;
      const top = i * rowHeight;
      if (top < node.scrollTop) node.scrollTop = top;
      else if (top + rowHeight > node.scrollTop + node.clientHeight) node.scrollTop = top + rowHeight - node.clientHeight;
    },
    [rowHeight],
  );
  useImperativeHandle(ref, () => ({ scrollToIndex, element: () => el.current }), [scrollToIndex]);

  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <div key={i} className="vrow" style={{ transform: `translateY(${i * rowHeight}px)`, height: rowHeight }}>
        {props.renderRow(i)}
      </div>,
    );
  }
  return (
    <div
      ref={el}
      className={`vlist ${props.className ?? ""}`}
      role="listbox"
      aria-label={props.label}
      aria-activedescendant={props.activeId}
      tabIndex={0}
      onKeyDown={props.onKeyDown}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="vlist-inner" style={{ height: count * rowHeight }}>
        {rows}
      </div>
    </div>
  );
});
