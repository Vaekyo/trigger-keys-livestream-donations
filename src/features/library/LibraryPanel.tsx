import { useMemo, useRef, useState } from 'react';
import type { Category, Character, ID, Part } from '../../model/types';
import { useDoc } from '../../state/store';
import { openDialog, setPrefs, setUI, toast, uiStore, usePrefs, useUI } from '../../state/ui';
import {
  addInstance,
  choosePart,
  clearCategory,
  emptyTrash,
  placeholderIds,
  purgeCharacters,
  purgeParts,
  restoreCharacter,
  restoreParts,
  toggleFavorite,
  trashParts,
  updateParts,
  usageCount,
} from '../../state/actions';
import { Btn, Empty } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { confirmDialog, MenuButton, type MenuItem } from '../../ui/overlays';
import { LazyThumb } from './LazyThumb';
import { allTags, filterParts } from './filter';
import { startTrace } from '../trace/traceApi';

const NO_LOCKS: ID[] = [];

export async function confirmDeleteParts(ids: ID[]): Promise<boolean> {
  if (!ids.length) return false;
  const used = usageCount(ids);
  const ok = await confirmDialog({
    title: ids.length === 1 ? 'Delete this part?' : `Delete ${ids.length} parts?`,
    message: (
      <>
        <p>{ids.length === 1 ? 'The part moves to the Trash.' : 'The parts move to the Trash.'} You can restore them from the library menu → Trash, or press Undo.</p>
        {used > 0 && (
          <p className="warn">
            {ids.length === 1 ? 'It is' : 'They are'} used in {used} character{used === 1 ? '' : 's'} — {used === 1 ? 'it' : 'they'} will disappear from {used === 1 ? 'that character' : 'those characters'} until restored.
          </p>
        )}
      </>
    ),
    confirmLabel: 'Move to Trash',
    danger: true,
  });
  if (ok) trashParts(ids);
  return ok;
}

function useActiveCharacter(): Character | undefined {
  const id = useUI((s) => s.characterId);
  return useDoc((d) => (id ? d.characters[id] : undefined));
}

export function LibraryPanel() {
  const categories = useDoc((d) => d.project.categories);
  const parts = useDoc((d) => d.parts);
  const projectId = useDoc((d) => d.project.id);
  const char = useActiveCharacter();
  const activeCat = useUI((s) => s.activeCategoryId);
  const query = useUI((s) => s.libraryQuery);
  const favoritesOnly = useUI((s) => s.favoritesOnly);
  const tag = useUI((s) => s.tagFilter);
  const showAllPoses = useUI((s) => s.showAllPoses);
  const selectMode = useUI((s) => s.libSelectMode);
  const showTrash = useUI((s) => s.showTrash);
  const locks = usePrefs((p) => p.randomLocks[projectId]) ?? NO_LOCKS;
  const fileRef = useRef<HTMLInputElement>(null);
  const poseId = char?.poseId ?? null;

  const filtered = useMemo(
    () => filterParts(parts, { query, favoritesOnly, tag, poseId: showAllPoses ? null : poseId }),
    [parts, query, favoritesOnly, tag, poseId, showAllPoses],
  );
  const byCat = useMemo(() => {
    const m = new Map<ID, Part[]>();
    for (const p of filtered) {
      const list = m.get(p.categoryId) ?? [];
      list.push(p);
      m.set(p.categoryId, list);
    }
    return m;
  }, [filtered]);
  const usedCats = useMemo(() => {
    const s = new Set<ID>();
    if (char) for (const i of char.items) if (!i.shape && parts[i.partId]) s.add(parts[i.partId].categoryId);
    return s;
  }, [char, parts]);
  const trashCount = useMemo(() => Object.values(parts).filter((p) => p.deletedAt).length, [parts]);
  const tags = useMemo(() => allTags(parts), [parts]);
  const category = categories.find((c) => c.id === activeCat) ?? categories[0];

  const toggleLock = (id: ID) =>
    setPrefs((p) => {
      const cur = p.randomLocks[projectId] ?? [];
      return { randomLocks: { ...p.randomLocks, [projectId]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } };
    });

  const libMenu = (): MenuItem[] => [
    { label: 'Import images…', icon: 'upload', onClick: () => fileRef.current?.click() },
    { label: 'Trace a new part…', icon: 'pen', onClick: () => startTrace({ categoryId: category?.id }) },
    { separator: true, label: '' },
    { label: selectMode ? 'Stop selecting' : 'Select multiple parts', icon: 'select', onClick: () => setUI({ libSelectMode: !selectMode, libSelected: [] }) },
    { label: 'Manage categories…', icon: 'sliders', onClick: () => openDialog({ kind: 'categories' }) },
    { label: `Trash (${trashCount})`, icon: 'trash', onClick: () => setUI({ showTrash: true, libSelectMode: false }) },
    { separator: true, label: '' },
    {
      label: 'Delete all placeholders…',
      icon: 'scissors',
      onClick: async () => {
        const ids = placeholderIds();
        if (!ids.length) return toast('There are no placeholder parts left.');
        await confirmDeleteParts(ids);
      },
    },
    {
      label: 'Add placeholder parts again',
      icon: 'refresh',
      onClick: async () => {
        const { addPlaceholders } = await import('../../starter/addPlaceholders');
        await addPlaceholders();
      },
    },
  ];

  if (showTrash) return <TrashView />;

  const searching = query.trim().length > 0;

  return (
    <aside className="panel panel-library" data-tour="library" aria-label="Parts library">
      <div className="lib-head">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            value={query}
            placeholder="Search parts or tags"
            onChange={(e) => setUI({ libraryQuery: e.target.value })}
            data-tip="Search all categories by name or tag"
            aria-label="Search parts"
          />
          {query && <Btn icon="x" small tip="Clear search" onClick={() => setUI({ libraryQuery: '' })} />}
        </div>
        <Btn icon={favoritesOnly ? 'starFilled' : 'star'} tip={favoritesOnly ? 'Showing favorites only' : 'Show favorites only'} active={favoritesOnly} onClick={() => setUI({ favoritesOnly: !favoritesOnly })} />
        <MenuButton
          icon="tag"
          tip={tag ? `Filtering by tag “${tag}”` : 'Filter by tag'}
          items={() => [
            { label: 'All tags', checked: tag === null, onClick: () => setUI({ tagFilter: null }) },
            ...tags.map((t) => ({ label: t, checked: tag === t, onClick: () => setUI({ tagFilter: t }) })),
          ]}
        />
        <MenuButton icon="plus" tip="Add parts: import images or trace" variant="soft" tour="add-parts" items={libMenu().slice(0, 2)} />
        <MenuButton icon="more" tip="Library menu" items={libMenu} />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/webp,image/jpeg,image/gif"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) openDialog({ kind: 'import', files, categoryId: category?.id });
          }}
        />
      </div>
      {(tag || favoritesOnly || showAllPoses) && (
        <div className="filter-chips">
          {favoritesOnly && <Chip label="★ favorites" onClear={() => setUI({ favoritesOnly: false })} />}
          {tag && <Chip label={`#${tag}`} onClear={() => setUI({ tagFilter: null })} />}
          {showAllPoses && <Chip label="all poses" onClear={() => setUI({ showAllPoses: false })} />}
        </div>
      )}
      <div className="lib-body">
        <nav className="cat-rail" aria-label="Categories">
          {categories.map((c) => (
            <CategoryTab
              key={c.id}
              cat={c}
              active={!searching && c.id === category?.id}
              count={byCat.get(c.id)?.length ?? 0}
              used={usedCats.has(c.id)}
              locked={locks.includes(c.id)}
              onLock={() => toggleLock(c.id)}
            />
          ))}
          <button type="button" className="cat-tab cat-manage" data-tip="Add, rename, reorder or delete categories" onClick={() => openDialog({ kind: 'categories' })}>
            <span className="cat-icon">
              <Icon name="sliders" size={18} />
            </span>
            <span className="cat-name">Edit</span>
          </button>
        </nav>
        <section className="part-area">
          {searching ? (
            <SearchResults byCat={byCat} categories={categories} char={char} />
          ) : category ? (
            <CategoryGrid category={category} list={byCat.get(category.id) ?? []} char={char} />
          ) : (
            <Empty icon="folder" title="No categories">
              Add one with “Edit”.
            </Empty>
          )}
        </section>
      </div>
      {selectMode && <SelectionBar />}
    </aside>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="chip">
      {label}
      <button type="button" aria-label={`Remove filter ${label}`} data-tip="Remove this filter" onClick={onClear}>
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

function CategoryTab({ cat, active, count, used, locked, onLock }: { cat: Category; active: boolean; count: number; used: boolean; locked: boolean; onLock: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`cat-tab${active ? ' is-active' : ''}${over ? ' is-drop' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        openDialog({ kind: 'import', files: [...e.dataTransfer.files], categoryId: cat.id, force: true });
      }}
    >
      <button
        type="button"
        className="cat-btn"
        data-tip={`${cat.name} — ${count} part${count === 1 ? '' : 's'} (${cat.mode === 'single' ? 'pick one' : 'pick several'}). Drop images here to add to this category.`}
        onClick={() => setUI({ activeCategoryId: cat.id, libraryQuery: '' })}
        aria-current={active}
      >
        <span className="cat-icon">{cat.icon}</span>
        <span className="cat-name">{cat.name}</span>
        {used && <span className="cat-dot" aria-label="in use" />}
      </button>
      <button
        type="button"
        className={`cat-lock${locked ? ' is-on' : ''}`}
        data-tip={locked ? 'Locked: Randomize keeps this category' : 'Lock this category so Randomize leaves it alone'}
        aria-label={locked ? `Unlock ${cat.name}` : `Lock ${cat.name}`}
        aria-pressed={locked}
        onClick={onLock}
      >
        <Icon name={locked ? 'lock' : 'unlock'} size={12} />
      </button>
    </div>
  );
}

function SearchResults({ byCat, categories, char }: { byCat: Map<ID, Part[]>; categories: Category[]; char?: Character }) {
  const any = [...byCat.values()].some((l) => l.length);
  if (!any) return <Empty icon="search" title="No parts match">Try another word, or clear the filters.</Empty>;
  return (
    <div className="part-scroll">
      {categories.map((c) => {
        const list = byCat.get(c.id);
        if (!list?.length) return null;
        return (
          <div key={c.id} className="result-group">
            <h4>
              {c.icon} {c.name}
            </h4>
            <PartGrid list={list} category={c} char={char} />
          </div>
        );
      })}
    </div>
  );
}

function CategoryGrid({ category, list, char }: { category: Category; list: Part[]; char?: Character }) {
  const parts = useDoc((d) => d.parts);
  const showAllPoses = useUI((s) => s.showAllPoses);
  const inUse = char?.items.some((i) => !i.shape && parts[i.partId]?.categoryId === category.id) ?? false;
  const hiddenByPose = useMemo(
    () => Object.values(parts).filter((p) => !p.deletedAt && p.categoryId === category.id && char && !p.poseIds.includes(char.poseId)).length,
    [parts, category.id, char],
  );
  return (
    <div className="part-scroll">
      <header className="grid-head">
        <div>
          <strong>
            {category.icon} {category.name}
          </strong>
          <span className="muted small">
            {category.mode === 'single' ? 'Pick one' : 'Pick any number'}
            {category.allowNone ? '' : ' · required'}
          </span>
        </div>
        {inUse && category.allowNone && <Btn small label="Clear" icon="x" tip={`Remove all ${category.name} parts from the character`} onClick={() => clearCategory(category.id)} />}
      </header>
      {list.length === 0 ? (
        <Empty icon="image" title="No parts here yet">
          <p>Drag PNG/WebP images onto this category (or anywhere), use + → Import images, or trace your own.</p>
          {hiddenByPose > 0 && !showAllPoses && (
            <p>
              {hiddenByPose} part{hiddenByPose === 1 ? '' : 's'} belong to other poses.{' '}
              <button type="button" className="link" onClick={() => setUI({ showAllPoses: true })}>
                Show all poses
              </button>
            </p>
          )}
        </Empty>
      ) : (
        <PartGrid list={list} category={category} char={char} showNone={category.mode === 'single' && category.allowNone} noneActive={!inUse} />
      )}
      {hiddenByPose > 0 && list.length > 0 && !showAllPoses && (
        <p className="muted small grid-foot">
          {hiddenByPose} more in other poses ·{' '}
          <button type="button" className="link" onClick={() => setUI({ showAllPoses: true })}>
            show
          </button>
        </p>
      )}
    </div>
  );
}

function PartGrid({ list, category, char, showNone, noneActive }: { list: Part[]; category: Category; char?: Character; showNone?: boolean; noneActive?: boolean }) {
  const counts = useMemo(() => {
    const m = new Map<ID, number>();
    if (char) for (const i of char.items) m.set(i.partId, (m.get(i.partId) ?? 0) + 1);
    return m;
  }, [char]);
  return (
    <div className="part-grid">
      {showNone && (
        <button type="button" className={`tile tile-none${noneActive ? ' is-chosen' : ''}`} data-tip={`No ${category.name}`} onClick={() => clearCategory(category.id)}>
          <span className="none-mark">
            <Icon name="x" size={28} />
          </span>
          <span className="tile-name">none</span>
        </button>
      )}
      {list.map((p) => (
        <PartTile key={p.id} part={p} count={counts.get(p.id) ?? 0} multiple={category.mode === 'multiple'} />
      ))}
    </div>
  );
}

function PartTile({ part, count, multiple }: { part: Part; count: number; multiple: boolean }) {
  const selectMode = useUI((s) => s.libSelectMode);
  const selected = useUI((s) => s.libSelected.includes(part.id));
  const items = (): MenuItem[] => [
    { label: 'Edit name, tags & poses…', icon: 'tag', onClick: () => openDialog({ kind: 'part-details', partIds: [part.id] }) },
    { label: 'Adjust default alignment…', icon: 'move', onClick: () => openDialog({ kind: 'align', partId: part.id }) },
    ...(part.trace ? [{ label: 'Edit in trace studio…', icon: 'pen' as const, onClick: () => startTrace({ editPartId: part.id }) }] : []),
    { label: part.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onClick: () => toggleFavorite(part.id) },
    ...(multiple ? [{ label: 'Add another copy', icon: 'plus' as const, onClick: () => addInstance(part.id) }] : []),
    { separator: true, label: '' },
    { label: 'Delete…', icon: 'trash', danger: true, onClick: () => void confirmDeleteParts([part.id]) },
  ];
  const onClick = () => {
    if (selectMode) {
      setUI((s) => ({ libSelected: s.libSelected.includes(part.id) ? s.libSelected.filter((x) => x !== part.id) : [...s.libSelected, part.id] }));
      return;
    }
    choosePart(part.id);
    if (window.matchMedia('(max-width: 900px)').matches && !multiple) setUI({ mobileTab: 'library' });
  };
  return (
    <div className={`tile${count ? ' is-chosen' : ''}${selected ? ' is-picked' : ''}`}>
      <button
        type="button"
        className="tile-main"
        draggable={!selectMode}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-part-id', part.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={onClick}
        data-tip={`${part.name}${part.tags.length ? ` · ${part.tags.map((t) => `#${t}`).join(' ')}` : ''}${multiple ? ' — click to add/remove, drag onto the canvas to place' : ' — click to choose, drag onto the canvas'}`}
        aria-pressed={count > 0}
      >
        <LazyThumb assetId={part.thumb} alt={part.name} />
        <span className="tile-name">{part.name.replace(/^placeholder-/, '')}</span>
      </button>
      {selectMode && <span className={`tile-check${selected ? ' is-on' : ''}`}>{selected && <Icon name="check" size={14} />}</span>}
      {!selectMode && (
        <>
          <button
            type="button"
            className={`tile-fav${part.favorite ? ' is-on' : ''}`}
            data-tip={part.favorite ? 'Favorite (click to remove)' : 'Add to favorites'}
            aria-label={part.favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => toggleFavorite(part.id)}
          >
            <Icon name={part.favorite ? 'starFilled' : 'star'} size={14} />
          </button>
          <span className="tile-menu">
            <MenuButton items={items} tip="Part options" small />
          </span>
        </>
      )}
      {count > 1 && <span className="tile-count">×{count}</span>}
      {part.placeholder && <span className="tile-ph" data-tip="Placeholder part (generated)">ph</span>}
    </div>
  );
}

function SelectionBar() {
  const sel = useUI((s) => s.libSelected);
  const parts = useDoc((d) => d.parts);
  const char = useActiveCharacter();
  const none = sel.length === 0;
  const selectAllShown = () => {
    const st = uiStore.get();
    const shown = filterParts(parts, {
      query: st.libraryQuery,
      favoritesOnly: st.favoritesOnly,
      tag: st.tagFilter,
      poseId: st.showAllPoses ? null : (char?.poseId ?? null),
    }).filter((p) => st.libraryQuery.trim() || p.categoryId === st.activeCategoryId);
    setUI({ libSelected: shown.map((p) => p.id) });
  };
  return (
    <div className="selection-bar">
      <span>{sel.length} selected</span>
      <Btn small icon="select" tip="Select every part currently shown" onClick={selectAllShown} />
      <Btn small icon="star" tip="Add selected to favorites" disabled={none} onClick={() => updateParts(sel, (p) => ({ ...p, favorite: true }), 'Favorite parts')} />
      <Btn small icon="tag" tip="Edit category, poses and tags of the selected parts" disabled={none} onClick={() => openDialog({ kind: 'part-details', partIds: sel })} />
      <Btn small icon="trash" tip="Delete selected parts" variant="danger" disabled={none} onClick={async () => (await confirmDeleteParts(sel)) && setUI({ libSelected: [] })} />
      <Btn small label="Done" tip="Stop selecting" onClick={() => setUI({ libSelectMode: false, libSelected: [] })} />
    </div>
  );
}

function TrashView() {
  const parts = useDoc((d) => d.parts);
  const chars = useDoc((d) => d.characters);
  const trashedParts = Object.values(parts).filter((p) => p.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const trashedChars = Object.values(chars).filter((c) => c.deletedAt);
  return (
    <aside className="panel panel-library" aria-label="Trash">
      <div className="lib-head">
        <Btn icon="chevLeft" label="Back" tip="Back to the library" onClick={() => setUI({ showTrash: false })} />
        <strong className="grow">Trash</strong>
        <Btn
          label="Empty trash"
          icon="trash"
          variant="danger"
          small
          tip="Permanently delete everything in the Trash"
          disabled={!trashedParts.length && !trashedChars.length}
          onClick={async () => {
            if (
              await confirmDialog({
                title: 'Empty the Trash?',
                message: `${trashedParts.length} part(s) and ${trashedChars.length} character(s) will be deleted for good. (Undo still works until you reload the page.)`,
                confirmLabel: 'Delete forever',
                danger: true,
              })
            )
              emptyTrash();
          }}
        />
      </div>
      <div className="part-scroll trash">
        {!trashedParts.length && !trashedChars.length && <Empty icon="trash" title="The Trash is empty" />}
        {trashedChars.length > 0 && (
          <>
            <h4>Characters</h4>
            <ul className="trash-list">
              {trashedChars.map((c) => (
                <li key={c.id}>
                  <span className="grow">{c.name}</span>
                  <Btn small icon="refresh" label="Restore" tip="Restore this character" onClick={() => restoreCharacter(c.id)} />
                  <Btn small icon="trash" tip="Delete forever" variant="danger" onClick={async () => (await confirmDialog({ title: `Delete “${c.name}” forever?`, confirmLabel: 'Delete forever', danger: true })) && purgeCharacters([c.id])} />
                </li>
              ))}
            </ul>
          </>
        )}
        {trashedParts.length > 0 && (
          <>
            <h4>
              Parts{' '}
              <Btn small label="Restore all" tip="Restore every part in the Trash" onClick={() => restoreParts(trashedParts.map((p) => p.id))} />
            </h4>
            <div className="part-grid">
              {trashedParts.map((p) => (
                <div key={p.id} className="tile">
                  <button type="button" className="tile-main" onClick={() => restoreParts([p.id])} data-tip={`${p.name} — click to restore`}>
                    <LazyThumb assetId={p.thumb} alt={p.name} />
                    <span className="tile-name">{p.name}</span>
                  </button>
                  <button
                    type="button"
                    className="tile-fav"
                    data-tip="Delete forever"
                    aria-label="Delete forever"
                    onClick={async () => (await confirmDialog({ title: `Delete “${p.name}” forever?`, confirmLabel: 'Delete forever', danger: true })) && purgeParts([p.id])}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

