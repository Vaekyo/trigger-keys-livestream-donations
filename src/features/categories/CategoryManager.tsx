import { useRef, useState } from 'react';
import type { Category, ID } from '../../model/types';
import { useDoc } from '../../state/store';
import { closeDialog, openDialog } from '../../state/ui';
import { addCategory, deleteCategory, getDoc, moveCategory, updateCategory } from '../../state/actions';
import { CATEGORY_ICONS } from '../../model/defaults';
import { Dialog, Popover, confirmDialog, promptDialog } from '../../ui/overlays';
import { Btn, Select, TextField, Toggle } from '../../ui/controls';
import { Icon } from '../../ui/Icon';


function IconPicker({ value, onPick }: { value: string; onPick: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className="icon-pick" data-tip="Choose an icon" onClick={() => setOpen(!open)}>
        {value}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)}>
          <div className="icon-grid">
            {CATEGORY_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                className={i === value ? 'is-on' : ''}
                onClick={() => {
                  onPick(i);
                  setOpen(false);
                }}
              >
                {i}
              </button>
            ))}
          </div>
          <div className="row">
            <input className="text-input grow" placeholder="or type/paste any emoji" value={custom} maxLength={4} onChange={(e) => setCustom(e.target.value)} aria-label="Custom icon" />
            <Btn
              small
              label="Use"
              tip="Use this icon"
              disabled={!custom.trim()}
              onClick={() => {
                onPick(custom.trim());
                setOpen(false);
              }}
            />
          </div>
        </Popover>
      )}
    </>
  );
}

async function askDelete(cat: Category) {
  const d = getDoc();
  const count = Object.values(d.parts).filter((p) => p.categoryId === cat.id && !p.deletedAt).length;
  let target: ID | 'trash' = 'trash';
  const others = d.project.categories.filter((c) => c.id !== cat.id);
  const ok = await confirmDialog({
    title: `Delete category “${cat.name}”?`,
    message: count ? `It has ${count} part${count === 1 ? '' : 's'}. Choose where they go:` : 'It has no parts. You can undo this.',
    confirmLabel: 'Delete category',
    danger: true,
    extra: count ? (
      <select className="select wide" defaultValue="trash" onChange={(e) => (target = e.target.value)} aria-label="Move parts to">
        <option value="trash">Move the parts to the Trash</option>
        {others.map((c) => (
          <option key={c.id} value={c.id}>
            Move the parts to {c.icon} {c.name}
          </option>
        ))}
      </select>
    ) : undefined,
  });
  if (ok) deleteCategory(cat.id, target);
}

export function CategoryManager() {
  const categories = useDoc((d) => d.project.categories);
  const groups = useDoc((d) => d.project.colorGroups);
  const parts = useDoc((d) => d.parts);
  const [drag, setDrag] = useState<{ id: ID; dy: number; target: number } | null>(null);
  const rowH = useRef(60);

  const startDrag = (cat: Category, index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const li = el.closest('li') as HTMLElement;
    rowH.current = li.offsetHeight + 4;
    const calc = (ev: PointerEvent) => Math.max(0, Math.min(categories.length - 1, index + Math.round((ev.clientY - y0) / rowH.current)));
    const move = (ev: PointerEvent) => setDrag({ id: cat.id, dy: ev.clientY - y0, target: calc(ev) });
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      const t = calc(ev);
      if (ev.type === 'pointerup' && t !== index) moveCategory(cat.id, t);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <Dialog
      title="Categories"
      icon="sliders"
      wide
      onClose={closeDialog}
      footer={
        <>
          <Btn
            icon="plus"
            label="Add category"
            tip="Create a new category"
            onClick={async () => {
              const name = await promptDialog({ title: 'New category', placeholder: 'e.g. hats, wings, tails', confirmLabel: 'Add' });
              if (name) addCategory(name);
            }}
          />
          <span className="grow" />
          <Btn label="Done" variant="primary" tip="Close" onClick={closeDialog} />
        </>
      }
    >
      <p className="muted small">
        The order is the default stacking: the first category is drawn at the back, the last one in front. Drag <Icon name="grip" size={12} /> to reorder. All changes can be undone.
      </p>
      <ul className="cat-list">
        <li className="cat-list-head muted small" aria-hidden="true">
          <span />
          <span>Icon & name</span>
          <span>Choice</span>
          <span>Options</span>
          <span>Default color group</span>
          <span />
        </li>
        {categories.map((c, i) => {
          const count = Object.values(parts).filter((p) => p.categoryId === c.id && !p.deletedAt).length;
          const isDragging = drag?.id === c.id;
          let shift = 0;
          if (drag && !isDragging) {
            const from = categories.findIndex((x) => x.id === drag.id);
            if (from < i && drag.target >= i) shift = -rowH.current;
            if (from > i && drag.target <= i) shift = rowH.current;
          }
          return (
            <li key={c.id} className={`cat-row${isDragging ? ' is-dragging' : ''}`} style={{ transform: isDragging ? `translateY(${drag!.dy}px)` : shift ? `translateY(${shift}px)` : undefined }}>
              <span className="layer-grip" onPointerDown={startDrag(c, i)} data-tip="Drag to reorder (changes the default stacking)">
                <Icon name="grip" size={16} />
              </span>
              <span className="row">
                <IconPicker value={c.icon} onPick={(icon) => updateCategory(c.id, { icon }, 'Change category icon')} />
                <TextField value={c.name} tip="Category name" onCommit={(name) => updateCategory(c.id, { name }, 'Rename category')} />
                <span className="muted small">{count}</span>
              </span>
              <Select
                tip="Single: one part at a time (e.g. eyes). Multiple: any number (e.g. accessories, stickers)."
                value={c.mode}
                onChange={(mode) => updateCategory(c.id, { mode })}
                options={[
                  { value: 'single', label: 'Single choice' },
                  { value: 'multiple', label: 'Multiple' },
                ]}
              />
              <span className="stack tight">
                <Toggle label="“None” allowed" tip="Can the character have nothing from this category?" checked={c.allowNone} onChange={(allowNone) => updateCategory(c.id, { allowNone })} />
                <Toggle label="Is background" tip="Hidden when exporting with a transparent background, and not clickable on the canvas" checked={c.isBackground} onChange={(isBackground) => updateCategory(c.id, { isBackground })} />
              </span>
              <Select
                tip="New parts from this category link to this color group"
                value={c.colorGroupId ?? ''}
                onChange={(v) => updateCategory(c.id, { colorGroupId: v || null })}
                options={[{ value: '', label: '— none —' }, ...groups.map((g) => ({ value: g.id, label: `🔗 ${g.name}` }))]}
              />
              <Btn icon="trash" tip="Delete category…" variant="danger" onClick={() => askDelete(c)} />
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        Color groups themselves are edited in{' '}
        <button type="button" className="link" onClick={() => openDialog({ kind: 'project-settings', tab: 'groups' })}>
          Project settings → Color groups
        </button>
        .
      </p>
    </Dialog>
  );
}
