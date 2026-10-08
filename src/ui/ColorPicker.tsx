import { useEffect, useRef, useState } from 'react';
import { hexToHsv, hsvToHex, isHex, normalizeHex } from '../render/color';
import { useDoc } from '../state/store';
import { addSwatch, removeSwatch } from '../state/actions';
import { startEyedropper } from '../state/ui';
import { Popover, confirmDialog } from './overlays';
import { Btn } from './controls';

interface PickerProps {
  value: string;
  onChange: (hex: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onEyedropper?: () => void;
}

function useDrag(onMove: (fx: number, fy: number) => void, onStart?: () => void, onEnd?: () => void) {
  return (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const update = (ev: PointerEvent | React.PointerEvent) => {
      onMove(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    onStart?.();
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
}

export function ColorPicker({ value, onChange, onStart, onEnd, onEyedropper }: PickerProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hex, setHex] = useState(value);
  const lastOut = useRef(value);
  const swatches = useDoc((d) => d.project.swatches);

  useEffect(() => {
    if (value !== lastOut.current) {
      const [h, s, v] = hexToHsv(value);
      setHsv((prev) => [s === 0 || v === 0 ? prev[0] : h, v === 0 ? prev[1] : s, v]);
      lastOut.current = value;
    }
    setHex(value);
  }, [value]);

  const emit = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const out = hsvToHex(h, s, v);
    lastOut.current = out;
    setHex(out);
    onChange(out);
  };

  const svDown = useDrag((fx, fy) => emit(hsv[0], fx, 1 - fy), onStart, onEnd);
  const hueDown = useDrag((fx) => emit(fx * 360, hsv[1], hsv[2]), onStart, onEnd);

  const commitHex = () => {
    if (isHex(hex)) {
      const n = normalizeHex(hex.startsWith('#') ? hex : `#${hex}`);
      onStart?.();
      lastOut.current = n;
      setHsv(hexToHsv(n));
      onChange(n);
      onEnd?.();
    } else setHex(value);
  };

  return (
    <div className="picker">
      <div
        className="picker-sv"
        style={{ background: `hsl(${hsv[0]}, 100%, 50%)` }}
        onPointerDown={svDown}
        data-tip="Drag to pick saturation and brightness"
      >
        <div className="picker-sv-white" />
        <div className="picker-sv-black" />
        <div className="picker-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: value }} />
      </div>
      <div className="picker-hue" onPointerDown={hueDown} data-tip="Drag to pick hue">
        <div className="picker-knob is-hue" style={{ left: `${(hsv[0] / 360) * 100}%`, background: `hsl(${hsv[0]},100%,50%)` }} />
      </div>
      <div className="picker-row">
        <span className="picker-preview" style={{ background: value }} />
        <input
          className="text-input mono"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          data-tip="Hex color code — type or paste one"
          aria-label="Hex color"
          maxLength={7}
        />
        {onEyedropper && <Btn icon="pipette" tip="Eyedropper: pick a color from the canvas (I)" onClick={onEyedropper} small />}
        <Btn icon="plus" tip="Save this color as a swatch" small onClick={() => addSwatch(value)} />
      </div>
      {swatches.length > 0 && (
        <div className="swatches">
          {swatches.map((s) => (
            <button
              key={s}
              type="button"
              className={`swatch${s.toLowerCase() === value.toLowerCase() ? ' is-on' : ''}`}
              style={{ background: s }}
              data-tip={`${s} — click to use, right-click to remove`}
              aria-label={`Swatch ${s}`}
              onClick={() => {
                onStart?.();
                lastOut.current = s;
                setHsv(hexToHsv(s));
                onChange(s);
                onEnd?.();
              }}
              onContextMenu={async (e) => {
                e.preventDefault();
                if (await confirmDialog({ title: 'Remove swatch?', message: `Remove ${s} from your saved swatches?`, confirmLabel: 'Remove' })) removeSwatch(s);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A color chip that opens a picker popover. */
export function ColorButton({
  value,
  onChange,
  onStart,
  onEnd,
  tip,
  label,
  disabled,
}: PickerProps & { tip: string; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="color-btn"
        data-tip={tip}
        aria-label={tip}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span className="color-chip" style={{ background: value }} />
        {label && <span className="color-btn-label">{label}</span>}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement="left-start">
          <ColorPicker
            value={value}
            onChange={onChange}
            onStart={onStart}
            onEnd={onEnd}
            onEyedropper={() => {
              setOpen(false);
              startEyedropper((hex) => {
                onStart?.();
                onChange(hex);
                onEnd?.();
              });
            }}
          />
        </Popover>
      )}
    </>
  );
}
