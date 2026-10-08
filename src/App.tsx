import { lazy, Suspense, useEffect, useState } from 'react';
import { bootstrap } from './state/projects';
import { openDialog, setUI, uiStore, usePrefs, useUI, type MobileTab } from './state/ui';
import { TopBar } from './features/shell/TopBar';
import { LibraryPanel } from './features/library/LibraryPanel';
import { CanvasView } from './features/canvas/CanvasView';
import { PartInspector } from './features/inspector/PartInspector';
import { LayerPanel } from './features/layers/LayerPanel';
import { CharacterPanel } from './features/character/CharacterPanel';
import { DialogHost } from './features/shell/DialogHost';
import { useGlobalShortcuts } from './features/shell/shortcuts';
import { AskHost, Toasts, TooltipHost } from './ui/overlays';
import { Tour } from './features/help/Tour';
import { Icon, type IconName } from './ui/Icon';
import { toast } from './state/ui';

const TraceStudio = lazy(() => import('./features/trace/TraceStudio'));

function useTheme() {
  const theme = usePrefs((p) => p.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

/** Drag image files anywhere onto the window to import them. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || uiStore.get().mode === 'trace') return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const ui = uiStore.get();
      if (ui.mode === 'trace' || !ui.ready) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      const zip = files.find((f) => /\.zip$/i.test(f.name));
      if (zip) {
        const { importProjectZip } = await import('./io/projectZip');
        await importProjectZip(zip);
        return;
      }
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (!images.length) {
        toast('Drop PNG or WebP images to add parts (or a project .zip to import it).');
        return;
      }
      openDialog({ kind: 'import', files: images, categoryId: ui.activeCategoryId ?? undefined });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}

const RIGHT_TABS: { id: Exclude<MobileTab, 'library'>; label: string; icon: IconName; tip: string }[] = [
  { id: 'part', label: 'Part', icon: 'sliders', tip: 'Move, scale, flip and recolor the selected part' },
  { id: 'layers', label: 'Layers', icon: 'layers', tip: 'Stacking order of every part' },
  { id: 'character', label: 'Character', icon: 'person', tip: 'Pose, color groups, palettes, expressions, background' },
];

function RightPanel() {
  const tab = useUI((s) => s.rightTab);
  return (
    <aside className="panel panel-right" aria-label="Inspector" data-tour="inspector">
      <div className="tabs" role="tablist">
        {RIGHT_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} data-tip={t.tip} onClick={() => setUI({ rightTab: t.id, mobileTab: t.id })}>
            <Icon name={t.icon} size={16} /> {t.label}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {tab === 'part' && <PartInspector />}
        {tab === 'layers' && <LayerPanel />}
        {tab === 'character' && <CharacterPanel />}
      </div>
    </aside>
  );
}

function MobileTabs() {
  const tab = useUI((s) => s.mobileTab);
  const collapsed = useUI((s) => s.sheetCollapsed);
  const items: { id: MobileTab; label: string; icon: IconName }[] = [
    { id: 'library', label: 'Parts', icon: 'gallery' },
    { id: 'part', label: 'Edit', icon: 'sliders' },
    { id: 'layers', label: 'Layers', icon: 'layers' },
    { id: 'character', label: 'Character', icon: 'person' },
  ];
  return (
    <nav className="mobile-tabs" aria-label="Panels">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={tab === it.id && !collapsed ? 'is-on' : ''}
          onClick={() =>
            setUI((s) => ({
              mobileTab: it.id,
              rightTab: it.id === 'library' ? s.rightTab : it.id,
              sheetCollapsed: s.mobileTab === it.id ? !s.sheetCollapsed : false,
            }))
          }
        >
          <Icon name={it.icon} size={20} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const ready = useUI((s) => s.ready);
  const message = useUI((s) => s.loadingMessage);
  const mode = useUI((s) => s.mode);
  const mobileTab = useUI((s) => s.mobileTab);
  const collapsed = useUI((s) => s.sheetCollapsed);
  const tourDone = usePrefs((p) => p.tourDone);
  useTheme();
  useGlobalShortcuts();
  const dropping = useFileDrop();

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (ready && !tourDone && uiStore.get().tourStep === null) setUI({ tourStep: 0 });
  }, [ready, tourDone]);

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-logo">🎀</div>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div className={`app${collapsed ? ' sheet-collapsed' : ''}`} data-tab={mobileTab}>
      <TopBar />
      <div className="workspace">
        <LibraryPanel />
        <main className="center">
          <CanvasView />
        </main>
        <RightPanel />
      </div>
      <MobileTabs />
      <DialogHost />
      {mode === 'trace' && (
        <Suspense fallback={<div className="splash overlay">Opening the trace studio…</div>}>
          <TraceStudio />
        </Suspense>
      )}
      {dropping && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="upload" size={48} />
          <p>Drop images to add parts · drop a .zip to import a project</p>
        </div>
      )}
      <Toasts />
      <AskHost />
      <Tour />
      <TooltipHost />
    </div>
  );
}
