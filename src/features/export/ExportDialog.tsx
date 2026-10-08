import { useEffect, useRef, useState } from 'react';
import type { Character, CropPreset, Rect } from '../../model/types';
import { docStore, useDoc } from '../../state/store';
import { closeDialog, setPrefs, toast, usePrefs, useUI } from '../../state/ui';
import { openCharacter, updateCrops } from '../../state/actions';
import { Dialog } from '../../ui/overlays';
import { Btn, Segmented, Slider, Toggle } from '../../ui/controls';
import { ColorButton } from '../../ui/ColorPicker';
import { canvasToBlob } from '../../db/assets';
import { renderCharacter } from '../../render/compositor';
import { copyCanvasToClipboard, cropRect, renderExpressionSheet, renderPng, type SheetOptions } from '../../io/exporters';
import { downloadBlob, safeFileName } from '../../io/download';
import { decodeShareCode, encodeShareCode, encodeShareJson } from '../../io/shareCode';
import { useElementSize } from '../../hooks/useElementSize';

type Tab = 'png' | 'sheet' | 'share';

export function ExportDialog({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((initial as Tab) ?? 'png');
  const charId = useUI((s) => s.characterId);
  const char = useDoc((d) => (charId ? d.characters[charId] : undefined));
  if (!char) return null;
  return (
    <Dialog title="Export" icon="download" wide="xl" onClose={closeDialog}>
      <div className="tabs inline" role="tablist">
        {(
          [
            ['png', 'PNG image'],
            ['sheet', 'Expression sheet'],
            ['share', 'Share code'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'png' && <PngTab char={char} />}
      {tab === 'sheet' && <SheetTab char={char} />}
      {tab === 'share' && <ShareTab char={char} />}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function CropEditor({ char, crop, transparent }: { char: Character; crop: CropPreset | undefined; transparent: boolean }) {
  const project = useDoc((d) => d.project);
  const [url, setUrl] = useState<string>('');
  const [live, setLive] = useState<Rect | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wrap = useElementSize(wrapRef);
  const W = project.width;
  const H = project.height;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await renderCharacter(docStore.get(), char, { scale: Math.min(1, 520 / H), background: !transparent });
      const b = await canvasToBlob(c);
      if (!alive) return;
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(b);
      });
    })();
    return () => {
      alive = false;
    };
  }, [char, transparent, H]);

  const r = live ?? crop?.rect ?? { x: 0, y: 0, w: 1, h: 1 };

  const startDrag = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const box = boxRef.current!.getBoundingClientRect();
    const start = { ...crop.rect };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const aspect = (start.w * W) / (start.h * H);
    let last = start;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / box.width;
      const dy = (ev.clientY - y0) / box.height;
      let n = { ...start };
      if (mode === 'move') {
        n.x = Math.min(1 - start.w, Math.max(0, start.x + dx));
        n.y = Math.min(1 - start.h, Math.max(0, start.y + dy));
      } else {
        const left = mode === 'nw' || mode === 'sw';
        const top = mode === 'nw' || mode === 'ne';
        let w = Math.max(0.05, start.w + (left ? -dx : dx));
        let h = Math.max(0.05, start.h + (top ? -dy : dy));
        if (!ev.shiftKey) {
          // keep the aspect ratio unless Shift is held
          h = (w * W) / aspect / H;
        }
        w = Math.min(w, 1);
        h = Math.min(h, 1);
        n = { x: left ? start.x + start.w - w : start.x, y: top ? start.y + start.h - h : start.y, w, h };
        n.x = Math.max(0, Math.min(1 - n.w, n.x));
        n.y = Math.max(0, Math.min(1 - n.h, n.y));
      }
      last = n;
      setLive(n);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setLive(null);
      if (last !== start) updateCrops(docStore.get().project.crops.map((c) => (c.id === crop.id ? { ...c, rect: last } : c)));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const maxH = Math.min(window.innerHeight * 0.62, 600);
  const avail = wrap.width || 400;
  const bw = Math.min(avail, maxH * (W / H));
  const bh = bw * (H / W);
  return (
    <div className="crop-wrap" ref={wrapRef}>
    <div className="crop-editor checker" ref={boxRef} style={{ width: bw, height: bh }}>
      {url && <img src={url} alt="Preview" draggable={false} />}
      {crop && (
        <div className="crop-box" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} onPointerDown={startDrag('move')} data-tip="Drag to move the crop · corners resize (Shift = free ratio)">
          {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
            <span key={k} className={`crop-handle ${k}`} onPointerDown={startDrag(k)} />
          ))}
        </div>
      )}
    </div>
    </div>
  );
}

function PngTab({ char }: { char: Character }) {
  const crops = useDoc((d) => d.project.crops);
  const scale = usePrefs((p) => p.exportScale);
  const transparent = usePrefs((p) => p.exportTransparent);
  const cropId = usePrefs((p) => p.exportCrop);
  const [busy, setBusy] = useState(false);
  const crop = crops.find((c) => c.id === cropId) ?? crops[0];
  const rect = cropRect(docStore.get(), crop);

  const make = () => renderPng(docStore.get(), char, { scale, transparent, cropId: crop?.id ?? 'full' });

  return (
    <div className="export-layout">
      <CropEditor char={char} crop={crop} transparent={transparent} />
      <div className="stack">
        <div className="field">
          <span>Crop</span>
          <Segmented tip="Crop preset — drag the box on the preview to adjust it" value={crop?.id ?? ''} onChange={(v) => setPrefs({ exportCrop: v })} options={crops.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <div className="field">
          <span>Scale</span>
          <Segmented
            tip="Output resolution"
            value={String(scale)}
            onChange={(v) => setPrefs({ exportScale: Number(v) })}
            options={[
              { value: '0.5', label: '½×' },
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
            ]}
          />
        </div>
        <div className="field">
          <span>Background</span>
          <Segmented
            tip="Transparent hides the background and background-category parts"
            value={transparent ? 't' : 'b'}
            onChange={(v) => setPrefs({ exportTransparent: v === 't' })}
            options={[
              { value: 'b', label: 'With background' },
              { value: 't', label: 'Transparent' },
            ]}
          />
        </div>
        <p className="muted small">
          Output: {Math.round(rect.w * scale)} × {Math.round(rect.h * scale)} px PNG
        </p>
        <div className="row wrap">
          <Btn
            icon="download"
            label="Download PNG"
            variant="primary"
            tip="Save the image"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const c = await make();
                downloadBlob(await canvasToBlob(c), `${safeFileName(char.name)}-${crop?.name ?? 'full'}${scale !== 1 ? `@${scale}x` : ''}.png`.replace(/\s+/g, '-').toLowerCase());
              } finally {
                setBusy(false);
              }
            }}
          />
          <Btn
            icon="copy"
            label="Copy"
            tip="Copy the image to the clipboard"
            disabled={busy}
            onClick={async () => toast((await copyCanvasToClipboard(await make())) ? 'Image copied to the clipboard' : 'Copying images is not supported in this browser — use Download.')}
          />
        </div>
      </div>
    </div>
  );
}

function SheetTab({ char }: { char: Character }) {
  const crops = useDoc((d) => d.project.crops);
  const [o, setO] = useState<SheetOptions>({
    columns: 3,
    cropId: crops.find((c) => c.id === 'face')?.id ?? crops[0]?.id ?? 'full',
    scale: 0.5,
    transparent: false,
    labels: true,
    padding: 24,
    sheetColor: '#ffffff',
    labelColor: '#2b2140',
    includeCurrent: false,
  });
  const [url, setUrl] = useState('');
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const c = await renderExpressionSheet(docStore.get(), char, o);
      if (!alive) return;
      canvasRef.current = c;
      setSize([c.width, c.height]);
      const b = await canvasToBlob(c);
      if (!alive) return;
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(b);
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [char, o]);

  const set = (p: Partial<SheetOptions>) => setO({ ...o, ...p });
  return (
    <div className="export-layout">
      <div className="sheet-preview checker">{url ? <img src={url} alt="Expression sheet preview" /> : <span className="thumb-loading" />}</div>
      <div className="stack">
        {char.expressions.length === 0 && <p className="warn small">This character has no saved expressions yet. Save some in the Character tab → Expressions. The sheet below just shows the current face.</p>}
        <div className="field">
          <span>Crop</span>
          <Segmented tip="Crop of each cell" value={o.cropId} onChange={(cropId) => set({ cropId })} options={crops.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <Slider label="Columns" tip="Cells per row" value={o.columns} min={1} max={8} onChange={(columns) => set({ columns })} />
        <Slider label="Cell scale" tip="Resolution of each cell" value={Math.round(o.scale * 100)} min={10} max={200} unit="%" onChange={(v) => set({ scale: v / 100 })} />
        <Slider label="Spacing" tip="Space between cells" value={o.padding} min={0} max={120} unit="px" onChange={(padding) => set({ padding })} />
        <Toggle label="Name labels" tip="Write each expression's name under it" checked={o.labels} onChange={(labels) => set({ labels })} />
        <Toggle label="Include the current face" tip="Add the face as it is now as the first cell" checked={o.includeCurrent} onChange={(includeCurrent) => set({ includeCurrent })} />
        <Toggle label="Transparent" tip="No sheet color and no character background" checked={o.transparent} onChange={(transparent) => set({ transparent })} />
        {!o.transparent && <ColorButton label="Sheet color" tip="Sheet background color" value={o.sheetColor} onChange={(sheetColor) => set({ sheetColor })} />}
        {o.labels && <ColorButton label="Label color" tip="Label text color" value={o.labelColor} onChange={(labelColor) => set({ labelColor })} />}
        <p className="muted small">
          Output: {size[0]} × {size[1]} px
        </p>
        <Btn
          icon="download"
          label="Download sheet"
          variant="primary"
          tip="Save the expression sheet as PNG"
          disabled={!url}
          onClick={async () => canvasRef.current && downloadBlob(await canvasToBlob(canvasRef.current), `${safeFileName(char.name)}-expressions.png`.replace(/\s+/g, '-').toLowerCase())}
        />
      </div>
    </div>
  );
}

function ShareTab({ char }: { char: Character }) {
  const [readable, setReadable] = useState(false);
  const [input, setInput] = useState('');
  const doc = docStore.get();
  const code = readable ? encodeShareJson(doc, char) : encodeShareCode(doc, char);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Share code copied');
    } catch {
      toast('Select the code and copy it manually (Ctrl+C).');
    }
  };
  return (
    <div className="stack">
      <p className="muted small">
        A share code describes this character (parts, positions, colors, expressions). Paste it into this app on another computer that has the same parts — for example after importing the same project .zip.
      </p>
      <div className="field">
        <span>Code for “{char.name}” ({code.length} characters)</span>
        <textarea className="text-input mono code" readOnly rows={readable ? 8 : 4} value={code} onFocus={(e) => e.target.select()} aria-label="Share code" />
      </div>
      <div className="row wrap">
        <Btn icon="copy" label="Copy code" variant="primary" tip="Copy to the clipboard" onClick={copy} />
        <Toggle label="Readable JSON instead of compact" tip="Longer, but you can read and edit it" checked={readable} onChange={setReadable} />
      </div>
      <hr />
      <div className="field">
        <span>Load a share code</span>
        <textarea className="text-input mono code" rows={3} placeholder="Paste a code starting with PCM1. or {" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Paste share code" />
      </div>
      <Btn
        icon="upload"
        label="Create character from code"
        tip="Adds a new character to the gallery"
        disabled={!input.trim()}
        onClick={() => {
          try {
            const { character, missing } = decodeShareCode(docStore.get(), input);
            if (Object.values(docStore.get().characters).some((c) => !c.deletedAt && c.name === character.name)) character.name = `${character.name} (shared)`;
            docStore.commit('Load share code', (d) => ({ ...d, characters: { ...d.characters, [character.id]: character } }));
            openCharacter(character.id);
            closeDialog();
            toast(missing.length ? `Loaded “${character.name}”. ${missing.length} part(s) not in your library: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}` : `Loaded “${character.name}”`, { ms: 8000, undo: true });
          } catch (err) {
            toast(`Could not read that code: ${(err as Error).message}`, { ms: 7000 });
          }
        }}
      />
    </div>
  );
}
