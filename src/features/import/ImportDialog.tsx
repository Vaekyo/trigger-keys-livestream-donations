import { useEffect, useMemo, useRef, useState } from 'react';
import type { ID } from '../../model/types';
import { useDoc } from '../../state/store';
import { closeDialog, setUI, toast, uiStore } from '../../state/ui';
import { addParts, activeCharacter, choosePart } from '../../state/actions';
import { Dialog, MenuButton } from '../../ui/overlays';
import { Btn, Select, Toggle } from '../../ui/controls';
import { buildItem, defaultAlign, groupFiles, prepareItem, type ImportItem } from '../../io/importFiles';
import { storePart } from '../../io/partFactory';
import { AlignEditor } from './AlignEditor';
import { Icon } from '../../ui/Icon';

export function PoseChips({ value, onChange }: { value: ID[]; onChange: (ids: ID[]) => void }) {
  const poses = useDoc((d) => d.project.poses);
  return (
    <div className="chips">
      {poses.map((p) => {
        const on = value.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className={`chip-toggle${on ? ' is-on' : ''}`}
            aria-pressed={on}
            data-tip={on ? `Belongs to pose ${p.name} (click to remove)` : `Also use in pose ${p.name}`}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
          >
            {on && <Icon name="check" size={12} />} {p.name}
          </button>
        );
      })}
    </div>
  );
}

export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);
    if (t.length) onChange([...new Set([...value, ...t])]);
    setText('');
  };
  return (
    <div className="tag-input" data-tip="Tags help you search and filter. Press Enter or comma to add.">
      {value.map((t) => (
        <span key={t} className="chip">
          #{t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        value={text}
        placeholder={value.length ? '' : 'add tags…'}
        onChange={(e) => {
          if (e.target.value.endsWith(',')) {
            setText(e.target.value);
            setTimeout(add, 0);
          } else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        aria-label="Add tag"
      />
    </div>
  );
}

export function ImportDialog({ files, categoryId, force }: { files: File[]; categoryId?: ID; force?: boolean }) {
  const project = useDoc((d) => d.project);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'details' | 'align'>('details');
  const [current, setCurrent] = useState(0);
  const [applyRest, setApplyRest] = useState(false);
  const [saving, setSaving] = useState(false);
  const urls = useRef<string[]>([]);
  const poseId = activeCharacter()?.poseId ?? project.poses[0]?.id;

  useEffect(() => {
    let alive = true;
    (async () => {
      const groups = groupFiles(files.filter((f) => f.type.startsWith('image/') || /\.(png|webp)$/i.test(f.name)));
      const out: ImportItem[] = [];
      for (const g of groups) {
        const it = await buildItem(g.name, g.files, project, categoryId, !!force, poseId ? [poseId] : []);
        out.push(it);
        if (it.previewUrl) urls.current.push(it.previewUrl);
        if (!alive) return;
        setItems([...out]);
      }
      setLoading(false);
      if (!out.length) {
        toast('No images found. Drop PNG or WebP files.');
        closeDialog();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = (key: string, patch: Partial<ImportItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const setCategory = (key: string, cat: ID) =>
    setItems((list) =>
      list.map((i) => {
        if (i.key !== key) return i;
        if (!i.aligned && i.prepared && !i.preAligned) return { ...i, categoryId: cat, align: defaultAlign(i.prepared, project, cat).align };
        return { ...i, categoryId: cat };
      }),
    );

  const pair = async (a: ImportItem, b: ImportItem, aIs: 'line' | 'fill') => {
    const files = aIs === 'line' ? { line: a.files.flat ?? a.files.line, fill: b.files.flat ?? b.files.fill } : { fill: a.files.flat ?? a.files.fill, line: b.files.flat ?? b.files.line };
    const merged = await prepareItem({ ...a, files, aligned: false }, project);
    if (merged.previewUrl) urls.current.push(merged.previewUrl);
    setItems((list) => list.filter((i) => i.key !== b.key).map((i) => (i.key === a.key ? merged : i)));
  };

  const split = async (a: ImportItem) => {
    const lineItem = await prepareItem({ ...a, files: { flat: a.files.line }, name: `${a.name}-line`, aligned: false }, project);
    const fillItem = await prepareItem({ ...a, key: Math.random().toString(36).slice(2), files: { flat: a.files.fill }, name: `${a.name}-fill`, aligned: false }, project);
    urls.current.push(lineItem.previewUrl, fillItem.previewUrl);
    setItems((list) => list.flatMap((i) => (i.key === a.key ? [lineItem, fillItem] : [i])));
  };

  const valid = items.filter((i) => !i.error && i.prepared);
  const needsAlign = valid.filter((i) => !i.preAligned);

  const finish = async (list: ImportItem[] = valid) => {
    setSaving(true);
    try {
      const parts = [];
      for (const it of list) {
        parts.push(
          await storePart({
            name: it.name || 'part',
            categoryId: it.categoryId,
            poseIds: it.poseIds.length ? it.poseIds : project.poses.map((p) => p.id),
            tags: it.tags,
            prepared: it.prepared!,
            align: it.align,
          }),
        );
      }
      addParts(parts, parts.length === 1 ? `Import ${parts[0].name}` : `Import ${parts.length} parts`);
      closeDialog();
      const first = parts[0];
      if (first) {
        setUI({ activeCategoryId: first.categoryId, libraryQuery: '', showTrash: false });
        if (parts.length === 1 && uiStore.get().characterId && first.poseIds.includes(activeCharacter()?.poseId ?? '')) choosePart(first.id);
      }
      toast(`Added ${parts.length} part${parts.length === 1 ? '' : 's'} to the library`, { undo: true });
    } catch (err) {
      console.error(err);
      toast(`Import failed: ${(err as Error).message}`);
      setSaving(false);
    }
  };

  const alignItem = needsAlign[current] ?? valid[current];
  const catOptions = useMemo(() => project.categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })), [project.categories]);

  const footer =
    step === 'details' ? (
      <>
        <span className="muted small grow">
          {loading ? 'Reading images…' : `${valid.length} part${valid.length === 1 ? '' : 's'}${needsAlign.length ? ` · ${needsAlign.length} need${needsAlign.length === 1 ? 's' : ''} aligning` : ' · already aligned to the canvas'}`}
        </span>
        <Btn label="Cancel" tip="Discard this import" onClick={closeDialog} />
        {valid.length > 0 && (
          <Btn
            label={needsAlign.length ? 'Next: align' : 'Align anyway'}
            icon="move"
            tip="Drag and scale each part over the template guide"
            variant={needsAlign.length ? 'primary' : 'ghost'}
            disabled={loading}
            onClick={() => {
              setCurrent(0);
              setStep('align');
            }}
          />
        )}
        {needsAlign.length === 0 && valid.length > 0 && (
          <Btn label={`Add ${valid.length} part${valid.length === 1 ? '' : 's'}`} icon="check" variant="primary" tip="Save to the library" disabled={loading || saving} onClick={() => void finish()} />
        )}
      </>
    ) : (
      <>
        <Btn label="Back" icon="chevLeft" tip="Back to names and categories" onClick={() => setStep('details')} />
        <span className="muted small grow">
          Part {current + 1} of {(needsAlign.length || valid.length)}
        </span>
        {current + 1 < (needsAlign.length || valid.length) && (
          <Toggle label="Same alignment for the rest" tip="Use this position/scale for all remaining images (great for variants traced on the same reference)" checked={applyRest} onChange={setApplyRest} />
        )}
        {current + 1 < (needsAlign.length || valid.length) && !applyRest ? (
          <Btn label="Next part" icon="chevRight" variant="primary" tip="Align the next part" onClick={() => setCurrent(current + 1)} />
        ) : (
          <Btn
            label={`Add ${valid.length} part${valid.length === 1 ? '' : 's'}`}
            icon="check"
            variant="primary"
            tip="Save to the library"
            disabled={saving}
            onClick={() => {
              if (applyRest && alignItem) {
                const list = needsAlign.length ? needsAlign : valid;
                const rest = new Set(list.slice(current + 1).map((i) => i.key));
                void finish(valid.map((i) => (rest.has(i.key) ? { ...i, align: alignItem.align, aligned: true } : i)));
              } else void finish();
            }}
          />
        )}
      </>
    );

  return (
    <Dialog title={step === 'details' ? 'Add parts' : 'Align parts'} icon="upload" onClose={closeDialog} wide="xl" footer={footer} className="import-dialog">
      {step === 'details' && (
        <div className="import-list">
          <p className="muted small">
            Choose a category for each image. Files named like <code>hair_line.png</code> + <code>hair_fill.png</code> become one part with smart tint. Images exactly the size of the canvas are already aligned.
          </p>
          {items.length > 1 && (
            <div className="row wrap bulk">
              <span className="muted small">For all:</span>
              <Select tip="Set the category of every image" value={'' as string} onChange={(v) => v && items.forEach((i) => setCategory(i.key, v))} options={[{ value: '', label: 'Category…' }, ...catOptions]} />
              <PoseChips value={items[0]?.poseIds ?? []} onChange={(ids) => setItems((l) => l.map((i) => ({ ...i, poseIds: ids })))} />
            </div>
          )}
          {items.map((it) => {
            const isPair = !!(it.files.line && it.files.fill);
            const singles = items.filter((o) => o.key !== it.key && o.files.flat);
            return (
              <div key={it.key} className={`import-item${it.error ? ' has-error' : ''}`}>
                <div className="import-preview checker">{it.previewUrl ? <img src={it.previewUrl} alt="" /> : <span className="thumb-loading" />}</div>
                <div className="import-fields">
                  <div className="row">
                    <input className="text-input grow" value={it.name} onChange={(e) => update(it.key, { name: e.target.value })} aria-label="Part name" data-tip="Part name" />
                    <Select tip="Category" value={it.categoryId} onChange={(v) => setCategory(it.key, v)} options={catOptions} />
                  </div>
                  <PoseChips value={it.poseIds} onChange={(poseIds) => update(it.key, { poseIds })} />
                  <TagInput value={it.tags} onChange={(tags) => update(it.key, { tags })} />
                  <div className="row small muted">
                    {it.error ? (
                      <span className="error">{it.error}</span>
                    ) : (
                      <>
                        <span>
                          {isPair ? '✓ line + fill (smart tint)' : 'single image'} · {it.prepared?.w}×{it.prepared?.h}px
                          {it.prepared && it.prepared.k < 1 ? ' (scaled down to save memory)' : ''}
                          {it.preAligned ? ' · aligned to canvas' : ''}
                        </span>
                        {isPair ? (
                          <Btn small label="Split" tip="Treat line and fill as two separate parts" onClick={() => split(it)} />
                        ) : (
                          singles.length > 0 && (
                            <MenuButton
                              small
                              icon="link"
                              label="Pair…"
                              tip="Combine with another image as line art + fill"
                              items={singles.flatMap((o) => [
                                { label: `This is line art, “${o.name}” is its fill`, onClick: () => pair(it, o, 'line') },
                                { label: `This is the fill, “${o.name}” is its line art`, onClick: () => pair(it, o, 'fill') },
                              ])}
                            />
                          )
                        )}
                      </>
                    )}
                  </div>
                </div>
                <Btn icon="x" tip="Leave this image out" onClick={() => setItems((l) => l.filter((i) => i.key !== it.key))} />
              </div>
            );
          })}
        </div>
      )}
      {step === 'align' && alignItem && alignItem.preview && (
        <div className="stack">
          <p className="muted small">
            Aligning <strong>{alignItem.name}</strong> ({project.categories.find((c) => c.id === alignItem.categoryId)?.name}). Drag it over the ghost of your character and the template until it fits. This position becomes its default.
          </p>
          <AlignEditor
            key={alignItem.key}
            image={alignItem.preview}
            w={alignItem.prepared!.w}
            h={alignItem.prepared!.h}
            align={alignItem.align}
            onChange={(a) => update(alignItem.key, { align: a, aligned: true })}
            categoryId={alignItem.categoryId}
            poseId={alignItem.poseIds[0] ?? poseId ?? ''}
          />
        </div>
      )}
    </Dialog>
  );
}

