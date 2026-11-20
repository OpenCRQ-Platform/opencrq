import type { PointerEvent, RefObject } from 'react';
import { useRef } from 'react';

interface DragToScrollResult {
  containerRef: RefObject<HTMLDivElement | null>,
  onPointerDown: (e: PointerEvent) => void,
  onPointerMove: (e: PointerEvent) => void,
  onPointerUp: (e: PointerEvent) => void,
}

const DRAG_THRESHOLD = 5;

export const useDragToScroll = (): DragToScrollResult => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ isPointerDown: false, hasDragged: false, pointerId: 0, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

  const onPointerDown = (e: PointerEvent) => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    dragState.current = { isPointerDown: true, hasDragged: false, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
  };

  const onPointerMove = (e: PointerEvent) => {
    const state = dragState.current;
    if (!state.isPointerDown) {
      return;
    }
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.hasDragged && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return;
    }
    if (!state.hasDragged) {
      state.hasDragged = true;
      el.setPointerCapture(state.pointerId);
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
      el.dataset.dragging = '';
    }
    el.scrollLeft = state.scrollLeft - dx;
    el.scrollTop = state.scrollTop - dy;
  };

  const onPointerUp = (e: PointerEvent) => {
    const wasDragging = dragState.current.hasDragged;
    dragState.current.isPointerDown = false;
    dragState.current.hasDragged = false;
    const el = containerRef.current;
    if (el) {
      if (wasDragging) {
        el.releasePointerCapture(e.pointerId);
        delete el.dataset.dragging;
      }
      el.style.cursor = 'grab';
      el.style.userSelect = '';
    }
  };

  return { containerRef, onPointerDown, onPointerMove, onPointerUp };
};
