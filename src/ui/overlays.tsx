// Dialog shell, promise-based confirm/prompt, popovers, menus, toasts and tooltips.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createStore, useStore } from '../state/store';
import { dismissToast, useUI } from '../state/ui';
import { undo } from '../state/actions';
import { Icon, type IconName } from './Icon';
import { Btn } from './controls';

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
  className = '',
  icon,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean | 'xl';
  className?: string;
  icon?: IconName;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.dialog-close)');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  return createPortal(
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${wide === 'xl' ? 'dialog-xl' : wide ? 'dialog-wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="dialog-head">
          {icon && <Icon name={icon} />}
          <h2>{title}</h2>
          <Btn className="dialog-close" icon="x" tip="Close (Esc)" onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* confirm() / prompt()                                                */
/* ------------------------------------------------------------------ */

interface AskState {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  value?: string;
  placeholder?: string;
  resolve: (v: string | boolean | null) => void;
  extra?: ReactNode;
}

const askStore = createStore<AskState | null>(null);

export function confirmDialog(opts: { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean; extra?: ReactNode }): Promise<boolean> {
  return new Promise((resolve) => {
    askStore.set({ kind: 'confirm', confirmLabel: 'OK', ...opts, resolve: (v) => resolve(v === true) });
  });
}

export function promptDialog(opts: { title: string; message?: ReactNode; value?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    askStore.set({ kind: 'prompt', confirmLabel: 'OK', ...opts, resolve: (v) => resolve(typeof v === 'string' ? v : null) });
  });
}

export function AskHost() {
  const ask = useStore(askStore, (s) => s);
  const [text, setText] = useState('');
  useEffect(() => setText(ask?.value ?? ''), [ask]);
  if (!ask) return null;
  const close = (v: string | boolean | null) => {
    askStore.set(null);
    ask.resolve(v);
  };
  return (
    <Dialog
      title={ask.title}
      onClose={() => close(ask.kind === 'confirm' ? false : null)}
      className="dialog-ask"
      footer={
        <>
          <Btn label="Cancel" tip="Cancel (Esc)" onClick={() => close(ask.kind === 'confirm' ? false : null)} />
          <Btn
            label={ask.confirmLabel}
            tip={ask.confirmLabel}
            variant={ask.danger ? 'danger' : 'primary'}
            onClick={() => close(ask.kind === 'confirm' ? true : text.trim() || null)}
          />
        </>
      }
    >
      {ask.message && <div className="ask-message">{ask.message}</div>}
      {ask.kind === 'prompt' && (
        <input
          className="text-input wide"
          autoFocus
          value={text}
          placeholder={ask.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(text.trim() || null);
          }}
          aria-label={ask.title}
        />
      )}
      {ask.extra}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Popover & menu                                                      */
/* ------------------------------------------------------------------ */

export function Popover({
  anchor,
  onClose,
  children,
  placement = 'bottom-start',
  className = '',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start' | 'left-start';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (placement === 'bottom-end') left = r.right - m.width;
    if (placement === 'top-start') top = r.top - m.height - 6;
    if (placement === 'right-start') {
      left = r.right + 6;
      top = r.top;
    }
    if (placement === 'left-start') {
      left = r.left - m.width - 6;
      top = r.top;
    }
    if (top + m.height > vh - 8) top = Math.max(8, r.top - m.height - 6);
    if (top < 8) top = 8;
    left = Math.max(8, Math.min(vw - m.width - 8, left));
    setPos({ left, top });
  }, [anchor, placement]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  separator?: boolean;
  checked?: boolean;
}

export function Menu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="menu" role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item${it.danger ? ' is-danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            <span className="menu-icon">{it.checked !== undefined ? it.checked ? <Icon name="check" size={16} /> : null : it.icon && <Icon name={it.icon} size={16} />}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** A button that opens a menu. */
export function MenuButton({ items, tip, icon = 'more', label, variant, small, tour, placement }: { items: MenuItem[] | (() => MenuItem[]); tip: string; icon?: IconName; label?: ReactNode; variant?: 'ghost' | 'primary' | 'soft'; small?: boolean; tour?: string; placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} className="menu-anchor">
      <Btn icon={icon} label={label} tip={tip} variant={variant} small={small} tour={tour} active={open} onClick={() => setOpen(!open)} />
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement={placement}>
          <Menu items={typeof items === 'function' ? items() : items} onClose={() => setOpen(false)} />
        </Popover>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.undo && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(t.id);
                undo();
              }}
            >
              Undo
            </button>
          )}
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltips: any element with data-tip gets one (hover or long-press)  */
/* ------------------------------------------------------------------ */

export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;
    let touchTimer: ReturnType<typeof setTimeout> | null = null;
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 60;
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
    };
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = setTimeout(() => show(el), 450);
    };
    const down = (e: PointerEvent) => {
      hide();
      if (e.pointerType !== 'touch') return;
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      if (!el) return;
      touchTimer = setTimeout(() => {
        show(el);
        setTimeout(hide, 2200);
      }, 550);
    };
    const up = () => {
      if (touchTimer) clearTimeout(touchTimer);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', hide, true);
    return () => {
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', hide, true);
    };
  }, []);
  if (!tip) return null;
  return createPortal(
    <div className={`tooltip${tip.below ? ' is-below' : ''}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>,
    document.body,
  );
}
