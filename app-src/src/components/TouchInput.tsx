import { useRef, useEffect, useCallback, useState, memo } from "react";
import type { JSX } from "react";
import type { GfnWebRtcClient } from "../gfn/webrtcClient";
import { InputEncoder, MOUSE_LEFT, MOUSE_RIGHT } from "../gfn/inputProtocol";

interface TouchInputProps {
  client: GfnWebRtcClient | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

const LONG_PRESS_MS = 400;
const DEBOUNCE_MS = 30;

function tsUs(): bigint {
  return BigInt(Math.floor(performance.now() * 1000));
}

export const TouchInput = memo(function TouchInput({
  client,
  videoRef,
}: TouchInputProps): JSX.Element {
  const encoderRef = useRef<InputEncoder | null>(null);
  if (!encoderRef.current) encoderRef.current = new InputEncoder();

  const lastPointerDownMs = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const cachedRect = useRef<DOMRect | null>(null);

  const [kbOpen, setKbOpen] = useState(false);
  const kbInputRef = useRef<HTMLInputElement | null>(null);

  const sendAbsoluteClick = useCallback(
    (nx: number, ny: number, button: number) => {
      if (!client) return;
      const enc = encoderRef.current!;
      const x = (nx * 65535) | 0;
      const y = (ny * 65535) | 0;
      const ts = tsUs();
      client.sendReliable(enc.encodeMouseAbsolute({ x, y, timestampUs: ts }));
      client.sendReliable(enc.encodeMouseButtonDown({ button, timestampUs: ts }));
      client.sendReliable(enc.encodeMouseButtonUp({ button, timestampUs: ts }));
    },
    [client],
  );

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !client) return;

    const resolveNormalized = (
      clientX: number,
      clientY: number,
      rect: DOMRect,
    ): [number, number] => {
      let nx = (clientX - rect.left) / rect.width;
      let ny = (clientY - rect.top) / rect.height;
      if (nx < 0) nx = 0; else if (nx > 1) nx = 1;
      if (ny < 0) ny = 0; else if (ny > 1) ny = 1;
      return [nx, ny];
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const now = performance.now();
      if (now - lastPointerDownMs.current < DEBOUNCE_MS) return;
      lastPointerDownMs.current = now;

      e.preventDefault();
      cachedRect.current = video.getBoundingClientRect();
      const [nx, ny] = resolveNormalized(e.clientX, e.clientY, cachedRect.current);

      longPressFired.current = false;
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        sendAbsoluteClick(nx, ny, MOUSE_RIGHT);
      }, LONG_PRESS_MS);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      clearLongPress();
      if (longPressFired.current) return;

      const rect = cachedRect.current;
      if (!rect) return;
      const [nx, ny] = resolveNormalized(e.clientX, e.clientY, rect);
      sendAbsoluteClick(nx, ny, MOUSE_LEFT);
    };

    const onPointerCancel = () => {
      clearLongPress();
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
    };

    video.addEventListener("pointerdown", onPointerDown, { passive: false });
    video.addEventListener("pointerup", onPointerUp, { passive: true });
    video.addEventListener("pointercancel", onPointerCancel, { passive: true });
    video.addEventListener("touchstart", onTouchStart, { passive: false });

    video.style.touchAction = "none";
    (video.style as any).webkitUserSelect = "none";
    video.style.userSelect = "none";

    return () => {
      video.removeEventListener("pointerdown", onPointerDown);
      video.removeEventListener("pointerup", onPointerUp);
      video.removeEventListener("pointercancel", onPointerCancel);
      video.removeEventListener("touchstart", onTouchStart);
      clearLongPress();
      video.style.touchAction = "";
    };
  }, [client, videoRef, sendAbsoluteClick, clearLongPress]);

  const toggleKb = useCallback(() => {
    setKbOpen((prev) => {
      if (prev) {
        kbInputRef.current?.blur();
        return false;
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (kbOpen) {
      const t = setTimeout(() => kbInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [kbOpen]);

  const onKbInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      if (!client) return;
      const el = e.target as HTMLInputElement;
      const val = el.value;
      if (val.length > 0) {
        client.sendText(val);
        el.value = "";
      }
    },
    [client],
  );

  const onKbKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!client) return;
      const enc = encoderRef.current!;
      const ts = tsUs();
      if (e.key === "Enter") {
        client.sendReliable(enc.encodeKeyDown({ keycode: 0x0d, scancode: 0x28, modifiers: 0, timestampUs: ts }));
        client.sendReliable(enc.encodeKeyUp({ keycode: 0x0d, scancode: 0x28, modifiers: 0, timestampUs: ts }));
        e.preventDefault();
      } else if (e.key === "Backspace") {
        client.sendReliable(enc.encodeKeyDown({ keycode: 0x08, scancode: 0x2a, modifiers: 0, timestampUs: ts }));
        client.sendReliable(enc.encodeKeyUp({ keycode: 0x08, scancode: 0x2a, modifiers: 0, timestampUs: ts }));
        e.preventDefault();
      } else if (e.key === "Escape") {
        client.sendReliable(enc.encodeKeyDown({ keycode: 0x1b, scancode: 0x29, modifiers: 0, timestampUs: ts }));
        client.sendReliable(enc.encodeKeyUp({ keycode: 0x1b, scancode: 0x29, modifiers: 0, timestampUs: ts }));
        kbInputRef.current?.blur();
        setKbOpen(false);
        e.preventDefault();
      }
    },
    [client],
  );

  const onKbBlur = useCallback(() => {
    setKbOpen(false);
  }, []);

  return (
    <>
      <button
        className="ti-kb-btn"
        onPointerDown={(e) => { e.stopPropagation(); toggleKb(); }}
        aria-label="Toggle keyboard"
      >
        ⌨
      </button>
      {kbOpen && (
        <input
          ref={kbInputRef}
          className="ti-kb-input"
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          onInput={onKbInput}
          onKeyDown={onKbKeyDown}
          onBlur={onKbBlur}
        />
      )}
    </>
  );
});
