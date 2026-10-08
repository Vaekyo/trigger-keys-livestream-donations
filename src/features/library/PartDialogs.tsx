import { useEffect, useMemo, useState } from 'react';
import type { Align, ID, Part } from '../../model/types';
import { useDoc } from '../../state/store';
import { closeDialog, openDialog, toast } from '../../state/ui';
import { activeCharacter, setPartAlign, updatePart, updateParts } from '../../state/actions';
import { effectiveAlign } from '../../model/geom';
import { loadImage, type DrawSource } from '../../db/assets';
import { partPlainSource } from '../../render/partRender';
import { Dialog } from '../../ui/overlays';
import { Btn, Segmented, Select, Toggle } from '../../ui/controls';
import { AlignEditor } from '../import/AlignEditor';
import { TagInput } from '../import/ImportDialog';
import { confirmDeleteParts } from './LibraryPanel';
import { startTrace } from '../trace/traceApi';
import { Icon } from '../../ui/Icon';

function usePartImage(part: Part | undefined): DrawSource | null {
  const [img, setImg] = useState<DrawSource | null>(null);
  useEffect(() => {
    if (!part) return;
    let alive = true;
    const ids = [part.images.flat, part.images.fill, part.images.line].filter(Boolean) as ID[];
    void Promise.all(ids.map((id) => loadImage(id))).then(() => {
      if (alive) setImg(partPlainSource(part));
    });
    return () => {
      alive = false;
    };
  }, [part]);
  return img;
}

export function AlignDialog({ partId }: { partId: ID }) {
  const part = useDoc((d) => d.parts[partId]);
  const poses = useDoc((d) => d.project.poses);
  const charPose = activeCharacter()?.poseId;
  const [poseId, setPoseId] = useState<ID>(() => (part && charPose && part.poseIds.includes(charPose) ? charPose : (part?.poseIds[0] ?? poses[0]?.id ?? '')));
  const [align, setAlign] = useState<Align | null>(() => (part ? effectiveAlign(part, poseId) : null));
  const [scope, setScope] = useState<'pose' | 'all'>(() => (part?.poseAlign?.[poseId] ? 'pose' : 'all'));
  const img = usePartImage(part);
  if (!part || !align) return null;
  const multiPose = part.poseIds.length > 1;
  return (
    <Dialog
      title={`Default alignment · ${part.name}`}
      icon="move"
      wide="xl"
      onClose={closeDialog}
      footer={
        <>
          <Btn label="Revert" icon="reset" tip="Back to the saved alignment" onClick={() => setAlign(effectiveAlign(part, poseId))} />
          <span className="grow" />
          {multiPose && (
            <Segmented
              tip="Which poses get this alignment"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'pose', label: `Only ${poses.find((p) => p.id === poseId)?.name ?? 'this pose'}`, tip: 'Separate alignment for this pose' },
                { value: 'all', label: 'All poses', tip: 'Same alignment in every pose' },
              ]}
            />
          )}
          <Btn label="Cancel" tip="Close without changes" onClick={closeDialog} />
          <Btn
            label="Save alignment"
            icon="check"
            variant="primary"
            tip="Every character using this part updates"
            onClick={() => {
              setPartAlign(part.id, align, multiPose && scope === 'pose' ? poseId : 'all');
              closeDialog();
              toast('Default alignment saved', { undo: true });
            }}
          />
        </>
      }
    >
      {multiPose && (
        <div className="row">
          <span className="muted small">Editing pose</span>
          <Select
            tip="Pose to align for"
            value={poseId}
            onChange={(p) => {
              setPoseId(p);
              setAlign(effectiveAlign(part, p));
              setScope(part.poseAlign?.[p] ? 'pose' : scope);
            }}
            options={poses.filter((p) => part.poseIds.includes(p.id)).map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
      )}
      {img ? (
        <AlignEditor image={img} w={part.w} h={part.h} align={align} onChange={setAlign} categoryId={part.categoryId} poseId={poseId} excludePartId={part.id} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </Dialog>
  );
}

type Tri = 'all' | 'none' | 'mixed';

export function PartDetailsDialog({ partIds }: { partIds: ID[] }) {
  const allParts = useDoc((d) => d.parts);
  const project = useDoc((d) => d.project);
  const parts = useMemo(() => partIds.map((id) => allParts[id]).filter(Boolean) as Part[], [partIds, allParts]);
  const single = parts.length === 1 ? parts[0] : undefined;
  const [name, setName] = useState(single?.name ?? '');
  const [category, setCategory] = useState<ID>(single?.categoryId ?? '');
  const [poseState, setPoseState] = useState<Record<ID, Tri>>(() => {
    const m: Record<ID, Tri> = {};
    for (const p of project.poses) {
      const n = parts.filter((x) => x.poseIds.includes(p.id)).length;
      m[p.id] = n === 0 ? 'none' : n === parts.length ? 'all' : 'mixed';
    }
    return m;
  });
  const [tags, setTags] = useState<string[]>(single?.tags ?? []);
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(single?.favorite ?? false);
  if (!parts.length) return null;
  const unionTags = [...new Set(parts.flatMap((p) => p.tags))].sort();

  const save = () => {
    const apply = (p: Part): Part => {
      let poseIds = p.poseIds;
      for (const [pid, st] of Object.entries(poseState)) {
        if (st === 'all' && !poseIds.includes(pid)) poseIds = [...poseIds, pid];
        if (st === 'none') poseIds = poseIds.filter((x) => x !== pid);
      }
      let t = single ? tags : [...new Set([...p.tags.filter((x) => !removeTags.includes(x)), ...tags])];
      t = t.filter(Boolean);
      return {
        ...p,
        name: single ? name.trim() || p.name : p.name,
        categoryId: category || p.categoryId,
        poseIds,
        tags: t,
        favorite: single ? favorite : p.favorite,
      };
    };
    if (single) updatePart(single.id, apply(single), `Edit ${single.name}`);
    else updateParts(partIds, apply, `Edit ${parts.length} parts`);
    closeDialog();
  };

  return (
    <Dialog
      title={single ? `Edit ${single.name}` : `Edit ${parts.length} parts`}
      icon="tag"
      onClose={closeDialog}
      footer={
        <>
          {single && <Btn label="Delete…" icon="trash" variant="danger" tip="Move this part to the Trash" onClick={async () => (await confirmDeleteParts([single.id])) && closeDialog()} />}
          <span className="grow" />
          <Btn label="Cancel" tip="Close without changes" onClick={closeDialog} />
          <Btn label="Save" icon="check" variant="primary" tip="Save changes (undoable)" onClick={save} />
        </>
      }
    >
      <div className="form">
        {single && (
          <label className="field">
            <span>Name</span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>Category</span>
          <Select
            tip="Category"
            value={category}
            onChange={setCategory}
            options={[...(single ? [] : [{ value: '', label: '(keep each part’s category)' }]), ...project.categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))]}
          />
        </label>
        <div className="field">
          <span>Poses</span>
          <div className="chips">
            {project.poses.map((p) => {
              const st = poseState[p.id];
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`chip-toggle${st === 'all' ? ' is-on' : st === 'mixed' ? ' is-mixed' : ''}`}
                  data-tip={st === 'mixed' ? 'Some of the selected parts are in this pose — click to add to all' : st === 'all' ? 'Click to remove from this pose' : 'Click to add to this pose'}
                  onClick={() => setPoseState({ ...poseState, [p.id]: st === 'all' ? 'none' : 'all' })}
                >
                  {st === 'all' && <Icon name="check" size={12} />}
                  {st === 'mixed' && '–'} {p.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <span>{single ? 'Tags' : 'Add tags'}</span>
          <TagInput value={tags} onChange={setTags} />
        </div>
        {!single && unionTags.length > 0 && (
          <div className="field">
            <span>Remove tags</span>
            <div className="chips">
              {unionTags.map((t) => (
                <button key={t} type="button" className={`chip-toggle${removeTags.includes(t) ? ' is-on danger' : ''}`} onClick={() => setRemoveTags(removeTags.includes(t) ? removeTags.filter((x) => x !== t) : [...removeTags, t])}>
                  #{t}
                </button>
              ))}
            </div>
          </div>
        )}
        {single && <Toggle label="Favorite" tip="Favorites are used by “Surprise me”" checked={favorite} onChange={setFavorite} />}
        {single && (
          <div className="row wrap">
            <Btn small icon="move" label="Default alignment…" tip="Change where this part sits by default" onClick={() => openDialog({ kind: 'align', partId: single.id })} />
            {single.trace && <Btn small icon="pen" label="Edit in trace studio…" tip="Re-open the drawing layers" onClick={() => startTrace({ editPartId: single.id })} />}
          </div>
        )}
      </div>
    </Dialog>
  );
}
