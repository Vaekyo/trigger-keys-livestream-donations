import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { setPrefs, setUI, useUI } from '../../state/ui';
import { Btn } from '../../ui/controls';

interface Step {
  target?: string;
  title: string;
  body: string;
  before?: () => void;
}

const STEPS: Step[] = [
  {
    title: 'Welcome! 🎀',
    body: 'This is your character maker. Everything is saved in this browser automatically, and every action can be undone (Ctrl+Z). This quick tour takes 30 seconds — or skip it.',
  },
  {
    target: '[data-tour="library"]',
    title: 'Parts library',
    body: 'Pick a category on the left, then click a part to put it on your character. Drag PNG/WebP images anywhere onto the app to add your own parts. The 🔒 on a category keeps it during Randomize.',
    before: () => setUI({ mobileTab: 'library', sheetCollapsed: false }),
  },
  {
    target: '[data-tour="canvas"]',
    title: 'Canvas',
    body: 'Click a part to select it and drag to move it. Corner handles scale, the top handle rotates. Scroll or pinch to zoom, drag an empty area (or hold Space) to pan.',
  },
  {
    target: '[data-tour="inspector"]',
    title: 'Edit, layers & character',
    body: 'Part: move, scale, flip, recolor. Layers: drag one part behind another. Character: pose, linked color groups (hair, skin, eyes…), palettes, expressions and background.',
    before: () => setUI({ rightTab: 'part', mobileTab: 'part', sheetCollapsed: false }),
  },
  {
    target: '[data-tour="randomize"]',
    title: 'Randomize',
    body: 'Mix random parts and/or colors. The ▾ menu has “colors only”, “parts only” and “Surprise me” (favorites only).',
  },
  {
    target: '[data-tour="pose"]',
    title: 'Poses',
    body: 'Switch between poses / head angles. Only parts made for the selected pose are shown.',
  },
  {
    target: '[data-tour="trace"]',
    title: 'Trace your own parts',
    body: 'Load any reference image, trace over it with a smoothing pen, auto-fill the inside, shade in gray and save it straight into the library.',
  },
  {
    target: '[data-tour="export"]',
    title: 'Export & share',
    body: 'Download PNGs (1×/2×, transparent, crop presets), expression sheets and share codes. Back up the whole project from the project menu.',
  },
  {
    title: 'You are ready!',
    body: 'Hover over any button for a tip. Press ? for all keyboard shortcuts. The tour can be replayed from the Help menu (?).',
  },
];

export function Tour() {
  const step = useUI((s) => s.tourStep);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cur = step !== null ? STEPS[step] : undefined;

  useEffect(() => {
    cur?.before?.();
  }, [cur]);

  useLayoutEffect(() => {
    if (!cur?.target) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = [...document.querySelectorAll(cur.target!)].find((e) => (e as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const t = setTimeout(measure, 120);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [cur]);

  if (step === null || !cur) return null;
  const finish = () => {
    setUI({ tourStep: null });
    setPrefs({ tourDone: true });
  };
  const last = step === STEPS.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let style: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const below = rect.bottom + 220 < vh;
    const left = Math.max(12, Math.min(vw - 352, rect.left + rect.width / 2 - 170));
    const room = rect.height > vh * 0.6;
    style = room ? { left: Math.max(12, Math.min(vw - 352, rect.right + 12 > vw - 352 ? rect.left - 352 : rect.right + 12)), top: Math.max(12, rect.top + 40) } : below ? { left, top: rect.bottom + 12 } : { left, top: Math.max(12, rect.top - 212) };
  }
  return createPortal(
    <div className="tour" role="dialog" aria-label="Quick tour">
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={style}>
        <div className="tour-progress">
          {step + 1} / {STEPS.length}
        </div>
        <h3>{cur.title}</h3>
        <p>{cur.body}</p>
        <div className="row">
          <Btn label="Skip tour" tip="Close the tour (replay it from Help)" onClick={finish} />
          <span className="grow" />
          {step > 0 && <Btn label="Back" tip="Previous step" onClick={() => setUI({ tourStep: step - 1 })} />}
          <Btn label={last ? 'Start making!' : 'Next'} variant="primary" tip={last ? 'Finish the tour' : 'Next step'} onClick={() => (last ? finish() : setUI({ tourStep: step + 1 }))} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
