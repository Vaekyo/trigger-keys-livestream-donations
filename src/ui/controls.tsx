import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Icon, type IconName } from './Icon';

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export interface BtnProps {
  icon?: IconName;
  label?: ReactNode;
  /** Tooltip text (also used as the accessible name). */
  tip: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'ghost' | 'primary' | 'danger' | 'soft';
  active?: boolean;
  disabled?: boolean;
  small?: boolean;
  className?: string;
  tour?: string;
  style?: CSSProperties;
  type?: 'button' | 'submit';
  iconSize?: number;
}

export function Btn({ icon, label, tip, onClick, variant = 'ghost', active, disabled, small, className = '', tour, style, type = 'button', iconSize }: BtnProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${active ? ' is-active' : ''}${small ? ' btn-sm' : ''}${label ? '' : ' btn-icon'} ${className}`}
      data-tip={tip}
      aria-label={typeof label === 'string' ? label : tip}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      disabled={disabled}
      data-tour={tour}
      style={style}
    >
      {icon && <Icon name={icon} size={iconSize ?? (small ? 16 : 18)} />}
      {label && <span className="btn-label">{label}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Slider with numeric field and gesture callbacks                     */
/* ------------------------------------------------------------------ */

export interface SliderProps {
  label: string;
  tip: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Display transform (e.g. scale → percent). */
  format?: (v: number) => string;
  parse?: (s: string) => number;
  onChange: (v: number) => void;
  /** Called when a drag starts / ends, so a whole drag can be one undo step. */
  onStart?: () => void;
  onEnd?: () => void;
  disabled?: boolean;
  gradient?: string;
}

export function Slider({ label, tip, value, min, max, step = 1, unit, format, parse, onChange, onStart, onEnd, disabled, gradient }: SliderProps) {
  const [text, setText] = useState<string | null>(null);
  const dragging = useRef(false);
  const shown = format ? format(value) : String(Math.round(value * 100) / 100);
  const end = () => {
    if (dragging.current) {
      dragging.current = false;
      onEnd?.();
    }
  };
  const commitText = () => {
    if (text === null) return;
    const v = parse ? parse(text) : parseFloat(text);
    setText(null);
    if (Number.isFinite(v)) {
      onStart?.();
      onChange(Math.min(max, Math.max(min, v)));
      onEnd?.();
    }
  };
  return (
    <label className={`slider${disabled ? ' is-disabled' : ''}`} data-tip={tip}>
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={gradient ? { background: gradient } : undefined}
        onPointerDown={() => {
          if (!dragging.current) {
            dragging.current = true;
            onStart?.();
          }
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onBlur={end}
        onKeyDown={() => {
          if (!dragging.current) {
            dragging.current = true;
            onStart?.();
          }
        }}
        onKeyUp={end}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
      />
      <span className="slider-value">
        <input
          className="num"
          value={text ?? shown}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setText(null);
          }}
          aria-label={`${label} value`}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle, segmented, inputs                                           */
/* ------------------------------------------------------------------ */

export function Toggle({ label, tip, checked, onChange, disabled }: { label: ReactNode; tip: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle${disabled ? ' is-disabled' : ''}`} data-tip={tip}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  tip,
  small,
}: {
  value: T;
  options: { value: T; label: ReactNode; tip?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  tip: string;
  small?: boolean;
}) {
  return (
    <div className={`segmented${small ? ' is-small' : ''}`} role="radiogroup" aria-label={tip} data-tip={tip}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'is-on' : ''}
          data-tip={o.tip ?? tip}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text input that commits on blur / Enter (so typing is one undo step). */
export function TextField({
  value,
  onCommit,
  tip,
  placeholder,
  className = '',
  autoFocus,
  maxLength = 120,
}: {
  value: string;
  onCommit: (v: string) => void;
  tip: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = text.trim();
    if (v && v !== value) onCommit(v);
    else setText(value);
  };
  return (
    <input
      className={`text-input ${className}`}
      value={text}
      data-tip={tip}
      aria-label={tip}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  tip,
  className = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  tip: string;
  className?: string;
}) {
  return (
    <select className={`select ${className}`} value={value} data-tip={tip} aria-label={tip} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Section({ title, children, actions, tour, collapsible = false, defaultOpen = true }: { title: ReactNode; children: ReactNode; actions?: ReactNode; tour?: string; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section" data-tour={tour}>
      <header className="section-head">
        {collapsible ? (
          <button type="button" className="section-toggle" onClick={() => setOpen(!open)} data-tip={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
            <Icon name={open ? 'chevDown' : 'chevRight'} size={14} />
            <span>{title}</span>
          </button>
        ) : (
          <h3>{title}</h3>
        )}
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {(!collapsible || open) && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Empty({ icon, title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} size={32} />}
      <strong>{title}</strong>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}
