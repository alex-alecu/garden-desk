import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

export const DRAWER_MIN_WIDTH = 320;
export const DRAWER_MAX_WIDTH = 720;
export const DRAWER_DEFAULT_WIDTH = 440;
export const CHAT_MIN_WIDTH = 440;

export function maximumDrawerWidth(availableWidth: number): number {
  return Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, availableWidth - CHAT_MIN_WIDTH));
}

function availableDrawerSpace(handle: HTMLHRElement): number | undefined {
  const drawer = handle.parentElement;
  const workspace = drawer?.previousElementSibling;
  if (!(workspace instanceof HTMLElement) || drawer === null) return undefined;
  return workspace.getBoundingClientRect().width + drawer.getBoundingClientRect().width;
}

function clampDrawerWidth(width: number, availableWidth?: number): number {
  const maximum =
    availableWidth === undefined ? DRAWER_MAX_WIDTH : maximumDrawerWidth(availableWidth);
  return Math.min(maximum, Math.max(DRAWER_MIN_WIDTH, width));
}

export interface DrawerResize {
  begin(event: PointerEvent<HTMLHRElement>): void;
  end(event: PointerEvent<HTMLHRElement>): void;
  keyDown(event: KeyboardEvent<HTMLHRElement>): void;
  move(event: PointerEvent<HTMLHRElement>): void;
  width: number | undefined;
}

export function useDrawerResize(): DrawerResize {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const drag = useRef<
    | { availableWidth: number | undefined; pointerId: number; startWidth: number; startX: number }
    | undefined
  >(undefined);
  const begin = (event: PointerEvent<HTMLHRElement>) => {
    event.preventDefault();
    const measured = event.currentTarget.parentElement?.getBoundingClientRect().width;
    drag.current = {
      availableWidth: availableDrawerSpace(event.currentTarget),
      pointerId: event.pointerId,
      startWidth: measured ?? width ?? DRAWER_DEFAULT_WIDTH,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    setWidth(
      clampDrawerWidth(
        drag.current.startWidth + drag.current.startX - event.clientX,
        drag.current.availableWidth,
      ),
    );
  };
  const end = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const availableWidth = availableDrawerSpace(event.currentTarget);
    const measured = event.currentTarget.parentElement?.getBoundingClientRect().width;
    setWidth((current) =>
      clampDrawerWidth(
        (measured ?? current ?? DRAWER_DEFAULT_WIDTH) + (event.key === "ArrowLeft" ? 16 : -16),
        availableWidth,
      ),
    );
  };
  return { begin, end, keyDown, move, width };
}

export function DrawerResizeHandle({ resize }: { resize: DrawerResize }) {
  return (
    <hr
      aria-label="Resize technical details"
      aria-orientation="vertical"
      aria-valuemax={DRAWER_MAX_WIDTH}
      aria-valuemin={DRAWER_MIN_WIDTH}
      aria-valuenow={resize.width ?? DRAWER_DEFAULT_WIDTH}
      className="technical-details-resize-handle"
      onKeyDown={resize.keyDown}
      onPointerCancel={resize.end}
      onPointerDown={resize.begin}
      onPointerMove={resize.move}
      onPointerUp={resize.end}
      tabIndex={0}
    />
  );
}
