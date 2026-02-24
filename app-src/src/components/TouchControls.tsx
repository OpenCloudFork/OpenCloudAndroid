import { useRef, useEffect, useCallback, useState, memo } from "react";
import type { JSX } from "react";
import type { GfnWebRtcClient } from "../gfn/webrtcClient";
import {
  InputEncoder,
  MOUSE_LEFT,
  MOUSE_RIGHT,
  GAMEPAD_A,
  GAMEPAD_B,
  GAMEPAD_X,
  GAMEPAD_Y,
  GAMEPAD_LB,
  GAMEPAD_RB,
  GAMEPAD_START,
} from "../gfn/inputProtocol";

interface TouchControlsProps {
  client: GfnWebRtcClient | null;
  visible: boolean;
  onToggle: () => void;
  mouseSensitivity: number;
}

const DEADZONE = 0.15;
const JOYSTICK_RADIUS = 50;
const STICK_KNOB_RADIUS = 22;
const TOUCH_CONTROLLER_ID = 3;

function timestampUs(): bigint {
  return BigInt(Math.floor(performance.now() * 1000));
}

function applyDeadzone(x: number, y: number): [number, number] {
  const mag = Math.sqrt(x * x + y * y);
  if (mag < DEADZONE) return [0, 0];
  const scale = (mag - DEADZONE) / (1 - DEADZONE) / mag;
  return [x * scale, y * scale];
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function toInt16(v: number): number {
  return clamp(Math.round(v * 32767), -32768, 32767);
}

function toUint8(v: number): number {
  return clamp(Math.round(v * 255), 0, 255);
}

const ButtonDefs = [
  { label: "A", flag: GAMEPAD_A, color: "#4CAF50" },
  { label: "B", flag: GAMEPAD_B, color: "#f44336" },
  { label: "X", flag: GAMEPAD_X, color: "#2196F3" },
  { label: "Y", flag: GAMEPAD_Y, color: "#FFC107" },
] as const;

const ShoulderDefs = [
  { label: "L1", flag: GAMEPAD_LB },
  { label: "R1", flag: GAMEPAD_RB },
] as const;

export const TouchControls = memo(function TouchControls({
  client,
  visible,
  onToggle,
  mouseSensitivity,
}: TouchControlsProps): JSX.Element | null {
  const encoderRef = useRef<InputEncoder | null>(null);
  if (!encoderRef.current) encoderRef.current = new InputEncoder();
  const rafRef = useRef<number>(0);
  const stickRef = useRef({ x: 0, y: 0 });
  const stickActiveRef = useRef(false);
  const stickOriginRef = useRef({ x: 0, y: 0 });
  const stickTouchIdRef = useRef<number | null>(null);
  const buttonsRef = useRef<number>(0);
  const lookTouchIdRef = useRef<number | null>(null);
  const lookLastRef = useRef({ x: 0, y: 0 });
  const knobElRef = useRef<HTMLDivElement | null>(null);
  const stickBaseRef = useRef<HTMLDivElement | null>(null);

  const sendGamepad = useCallback(() => {
    if (!client) return;
    const [dx, dy] = applyDeadzone(stickRef.current.x, stickRef.current.y);
    const encoder = encoderRef.current!;
    const bytes = encoder.encodeGamepadState(
      {
        controllerId: TOUCH_CONTROLLER_ID,
        buttons: buttonsRef.current,
        leftTrigger: 0,
        rightTrigger: 0,
        leftStickX: toInt16(dx),
        leftStickY: toInt16(-dy),
        rightStickX: 0,
        rightStickY: 0,
        connected: true,
        timestampUs: timestampUs(),
      },
      1 << TOUCH_CONTROLLER_ID,
      false,
    );
    client.sendReliable(bytes);
  }, [client]);

  const sendMouse = useCallback(
    (dx: number, dy: number) => {
      if (!client) return;
      const encoder = encoderRef.current!;
      const bytes = encoder.encodeMouseMove({
        dx: Math.round(dx * mouseSensitivity),
        dy: Math.round(dy * mouseSensitivity),
        timestampUs: timestampUs(),
      });
      client.sendReliable(bytes);
    },
    [client, mouseSensitivity],
  );

  const sendMouseButton = useCallback(
    (button: number, down: boolean) => {
      if (!client) return;
      const encoder = encoderRef.current!;
      const bytes = down
        ? encoder.encodeMouseButtonDown({ button, timestampUs: timestampUs() })
        : encoder.encodeMouseButtonUp({ button, timestampUs: timestampUs() });
      client.sendReliable(bytes);
    },
    [client],
  );

  const sendKey = useCallback(
    (keycode: number, scancode: number, down: boolean) => {
      if (!client) return;
      const encoder = encoderRef.current!;
      const bytes = down
        ? encoder.encodeKeyDown({ keycode, scancode, modifiers: 0, timestampUs: timestampUs() })
        : encoder.encodeKeyUp({ keycode, scancode, modifiers: 0, timestampUs: timestampUs() });
      client.sendReliable(bytes);
    },
    [client],
  );

  const startRafLoop = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      if (!stickActiveRef.current) {
        rafRef.current = 0;
        return;
      }
      sendGamepad();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [sendGamepad]);

  useEffect(() => {
    if (!visible) return;
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const encoder = encoderRef.current!;
    if (client) {
      const bytes = encoder.encodeGamepadState(
        {
          controllerId: TOUCH_CONTROLLER_ID,
          buttons: 0,
          leftTrigger: 0,
          rightTrigger: 0,
          leftStickX: 0,
          leftStickY: 0,
          rightStickX: 0,
          rightStickY: 0,
          connected: true,
          timestampUs: timestampUs(),
        },
        1 << TOUCH_CONTROLLER_ID,
        false,
      );
      client.sendReliable(bytes);
    }
    return () => {
      if (client) {
        const bytes = encoder.encodeGamepadState(
          {
            controllerId: TOUCH_CONTROLLER_ID,
            buttons: 0,
            leftTrigger: 0,
            rightTrigger: 0,
            leftStickX: 0,
            leftStickY: 0,
            rightStickX: 0,
            rightStickY: 0,
            connected: false,
            timestampUs: timestampUs(),
          },
          1 << TOUCH_CONTROLLER_ID,
          false,
        );
        client.sendReliable(bytes);
      }
    };
  }, [visible, client]);

  const onStickTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const touch = e.changedTouches[0];
      if (!touch || stickTouchIdRef.current !== null) return;
      stickTouchIdRef.current = touch.identifier;
      const base = stickBaseRef.current;
      if (base) {
        const rect = base.getBoundingClientRect();
        stickOriginRef.current = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
      stickRef.current = { x: 0, y: 0 };
      stickActiveRef.current = true;
      updateKnobVisual(0, 0);
      startRafLoop();
    },
    [startRafLoop],
  );

  const onStickTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]!;
        if (touch.identifier !== stickTouchIdRef.current) continue;
        const dx = touch.clientX - stickOriginRef.current.x;
        const dy = touch.clientY - stickOriginRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clamped = Math.min(dist, JOYSTICK_RADIUS);
        const angle = Math.atan2(dy, dx);
        const nx = (clamped * Math.cos(angle)) / JOYSTICK_RADIUS;
        const ny = (clamped * Math.sin(angle)) / JOYSTICK_RADIUS;
        stickRef.current = { x: nx, y: ny };
        updateKnobVisual(
          (clamped * Math.cos(angle)),
          (clamped * Math.sin(angle)),
        );
      }
    },
    [],
  );

  const onStickTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i]!.identifier === stickTouchIdRef.current) {
          stickTouchIdRef.current = null;
          stickRef.current = { x: 0, y: 0 };
          stickActiveRef.current = false;
          updateKnobVisual(0, 0);
          sendGamepad();
        }
      }
    },
    [sendGamepad],
  );

  const updateKnobVisual = (px: number, py: number) => {
    if (knobElRef.current) {
      knobElRef.current.style.transform = `translate(${px}px, ${py}px)`;
    }
  };

  const lookAreaRef = useRef<HTMLDivElement | null>(null);
  const tapStartRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const onLookTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const touches = e.changedTouches;

      if (e.touches.length === 2) {
        scrollTouchesRef.current.clear();
        for (let i = 0; i < e.touches.length; i++) {
          const t = e.touches[i]!;
          scrollTouchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
        lookTouchIdRef.current = null;
        return;
      }

      for (let i = 0; i < touches.length; i++) {
        const touch = touches[i]!;
        if (lookTouchIdRef.current === null) {
          lookTouchIdRef.current = touch.identifier;
          lookLastRef.current = { x: touch.clientX, y: touch.clientY };
          tapStartRef.current = { time: performance.now(), x: touch.clientX, y: touch.clientY };
        }
      }
    },
    [],
  );

  const onLookTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();

      if (scrollTouchesRef.current.size === 2 && e.touches.length === 2) {
        let totalDy = 0;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i]!;
          const prev = scrollTouchesRef.current.get(t.identifier);
          if (prev) {
            totalDy += t.clientY - prev.y;
            scrollTouchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
          }
        }
        if (Math.abs(totalDy) > 1) {
          const encoder = encoderRef.current!;
          if (client) {
            const bytes = encoder.encodeMouseWheel({
              delta: Math.round(-totalDy * 3),
              timestampUs: timestampUs(),
            });
            client.sendReliable(bytes);
          }
        }
        tapStartRef.current = null;
        return;
      }

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]!;
        if (touch.identifier !== lookTouchIdRef.current) continue;
        const dx = touch.clientX - lookLastRef.current.x;
        const dy = touch.clientY - lookLastRef.current.y;
        lookLastRef.current = { x: touch.clientX, y: touch.clientY };
        sendMouse(dx, dy);
        if (tapStartRef.current) {
          const dist = Math.sqrt(
            (touch.clientX - tapStartRef.current.x) ** 2 +
            (touch.clientY - tapStartRef.current.y) ** 2,
          );
          if (dist > 10) tapStartRef.current = null;
        }
      }
    },
    [sendMouse, client],
  );

  const onLookTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();

      for (let i = 0; i < e.changedTouches.length; i++) {
        scrollTouchesRef.current.delete(e.changedTouches[i]!.identifier);
      }

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]!;
        if (touch.identifier === lookTouchIdRef.current) {
          lookTouchIdRef.current = null;

          if (tapStartRef.current && performance.now() - tapStartRef.current.time < 250) {
            tapCountRef.current++;
            if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
            const count = tapCountRef.current;
            tapTimerRef.current = setTimeout(() => {
              if (count >= 2) {
                sendMouseButton(MOUSE_RIGHT, true);
                setTimeout(() => sendMouseButton(MOUSE_RIGHT, false), 50);
              } else {
                sendMouseButton(MOUSE_LEFT, true);
                setTimeout(() => sendMouseButton(MOUSE_LEFT, false), 50);
              }
              tapCountRef.current = 0;
              tapTimerRef.current = null;
            }, 200);
          }
          tapStartRef.current = null;
        }
      }
    },
    [sendMouseButton],
  );

  const onGamepadButton = useCallback(
    (flag: number, down: boolean) => {
      if (down) {
        buttonsRef.current |= flag;
      } else {
        buttonsRef.current &= ~flag;
      }
      sendGamepad();
    },
    [sendGamepad],
  );

  const [kbVisible, setKbVisible] = useState(false);
  const kbInputRef = useRef<HTMLInputElement | null>(null);

  const toggleKeyboard = useCallback(() => {
    if (kbVisible) {
      kbInputRef.current?.blur();
      setKbVisible(false);
    } else {
      setKbVisible(true);
      setTimeout(() => kbInputRef.current?.focus(), 50);
    }
  }, [kbVisible]);

  const onKbInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const val = (e.target as HTMLInputElement).value;
      if (val.length > 0) {
        const char = val[val.length - 1]!;
        const code = char.toUpperCase().charCodeAt(0);
        if (code >= 0x41 && code <= 0x5a) {
          const scancode = 0x04 + (code - 0x41);
          sendKey(code, scancode, true);
          setTimeout(() => sendKey(code, scancode, false), 30);
        } else if (code >= 0x30 && code <= 0x39) {
          const scancode = code === 0x30 ? 0x27 : 0x1e + (code - 0x31);
          sendKey(code, scancode, true);
          setTimeout(() => sendKey(code, scancode, false), 30);
        } else if (char === " ") {
          sendKey(0x20, 0x2c, true);
          setTimeout(() => sendKey(0x20, 0x2c, false), 30);
        }
        (e.target as HTMLInputElement).value = "";
      }
    },
    [sendKey],
  );

  const onKbKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        sendKey(0x0d, 0x28, true);
        setTimeout(() => sendKey(0x0d, 0x28, false), 30);
        e.preventDefault();
      } else if (e.key === "Backspace") {
        sendKey(0x08, 0x2a, true);
        setTimeout(() => sendKey(0x08, 0x2a, false), 30);
        e.preventDefault();
      } else if (e.key === "Escape") {
        sendKey(0x1b, 0x29, true);
        setTimeout(() => sendKey(0x1b, 0x29, false), 30);
        kbInputRef.current?.blur();
        setKbVisible(false);
        e.preventDefault();
      }
    },
    [sendKey],
  );

  if (!visible) return null;

  return (
    <div className="touch-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }}>
      {/* Left stick */}
      <div
        ref={stickBaseRef}
        className="touch-stick-base"
        onTouchStart={onStickTouchStart}
        onTouchMove={onStickTouchMove}
        onTouchEnd={onStickTouchEnd}
        onTouchCancel={onStickTouchEnd}
        style={{
          position: "absolute",
          left: 24,
          bottom: 80,
          width: JOYSTICK_RADIUS * 2 + 20,
          height: JOYSTICK_RADIUS * 2 + 20,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          border: "2px solid rgba(255,255,255,0.15)",
          pointerEvents: "auto",
          touchAction: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          ref={knobElRef}
          style={{
            width: STICK_KNOB_RADIUS * 2,
            height: STICK_KNOB_RADIUS * 2,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.3)",
            border: "2px solid rgba(255,255,255,0.5)",
            transition: stickActiveRef.current ? "none" : "transform 0.15s ease",
            willChange: "transform",
          }}
        />
      </div>

      {/* Right look area */}
      <div
        ref={lookAreaRef}
        onTouchStart={onLookTouchStart}
        onTouchMove={onLookTouchMove}
        onTouchEnd={onLookTouchEnd}
        onTouchCancel={onLookTouchEnd}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: "50%",
          height: "100%",
          pointerEvents: "auto",
          touchAction: "none",
        }}
      />

      {/* Gamepad buttons — ABXY */}
      <div
        style={{
          position: "absolute",
          right: 24,
          bottom: 80,
          width: 130,
          height: 130,
          pointerEvents: "auto",
        }}
      >
        {ButtonDefs.map((btn, i) => {
          const positions = [
            { left: 44, top: 0 },
            { left: 88, top: 44 },
            { left: 44, top: 88 },
            { left: 0, top: 44 },
          ];
          const pos = positions[i]!;
          return (
            <button
              key={btn.label}
              onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(btn.flag, true); }}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(btn.flag, false); }}
              onTouchCancel={(e) => { e.preventDefault(); onGamepadButton(btn.flag, false); }}
              style={{
                position: "absolute",
                left: pos.left,
                top: pos.top,
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: `${btn.color}44`,
                border: `2px solid ${btn.color}88`,
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* Shoulders L1 / R1 */}
      <div style={{ position: "absolute", top: 16, left: 16, pointerEvents: "auto" }}>
        <button
          onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(ShoulderDefs[0].flag, true); }}
          onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(ShoulderDefs[0].flag, false); }}
          onTouchCancel={(e) => { e.preventDefault(); onGamepadButton(ShoulderDefs[0].flag, false); }}
          style={shoulderStyle}
        >
          L1
        </button>
      </div>
      <div style={{ position: "absolute", top: 16, right: 16, pointerEvents: "auto" }}>
        <button
          onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(ShoulderDefs[1].flag, true); }}
          onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(ShoulderDefs[1].flag, false); }}
          onTouchCancel={(e) => { e.preventDefault(); onGamepadButton(ShoulderDefs[1].flag, false); }}
          style={shoulderStyle}
        >
          R1
        </button>
      </div>

      {/* Start */}
      <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", pointerEvents: "auto" }}>
        <button
          onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(GAMEPAD_START, true); }}
          onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onGamepadButton(GAMEPAD_START, false); }}
          onTouchCancel={(e) => { e.preventDefault(); onGamepadButton(GAMEPAD_START, false); }}
          style={{
            ...shoulderStyle,
            width: 64,
            fontSize: 11,
          }}
        >
          START
        </button>
      </div>

      {/* Keyboard toggle */}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", pointerEvents: "auto" }}>
        <button
          onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); toggleKeyboard(); }}
          style={{
            ...shoulderStyle,
            width: 44,
            height: 44,
            fontSize: 18,
            borderRadius: "50%",
          }}
        >
          ⌨
        </button>
      </div>

      {/* Hidden keyboard input */}
      {kbVisible && (
        <input
          ref={kbInputRef}
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onInput={onKbInput}
          onKeyDown={onKbKeyDown}
          onBlur={() => setKbVisible(false)}
          style={{
            position: "absolute",
            bottom: -100,
            left: 0,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "auto",
          }}
        />
      )}

      {/* Toggle button */}
      <button
        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
        style={{
          position: "absolute",
          top: 16,
          right: 80,
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.3)",
          color: "#fff",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "auto",
          touchAction: "none",
        }}
      >
        🎮
      </button>
    </div>
  );
});

const shoulderStyle: React.CSSProperties = {
  width: 52,
  height: 32,
  borderRadius: 6,
  background: "rgba(255,255,255,0.1)",
  border: "1.5px solid rgba(255,255,255,0.3)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  touchAction: "none",
  userSelect: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
