import { useRef } from 'react';
import { useDoc, useHistoryLabels, useStore } from '../../state/store';
import { openDialog, setPrefs, setUI, toast, uiStore, usePrefs, useUI } from '../../state/ui';
import { createCharacter, redo, renameCharacter, setPose, undo } from '../../state/actions';
import { Btn, Select, TextField } from '../../ui/controls';
import { MenuButton, promptDialog } from '../../ui/overlays';
import { mainViewport } from '../canvas/viewport';
import { randomizeActive } from '../randomize/randomize';
import { startTrace } from '../trace/traceApi';
import { createProject } from '../../state/projects';

export function TopBar() {
  const projectName = useDoc((d) => d.project.name);
  const poses = useDoc((d) => d.project.poses);
  const charId = useUI((s) => s.characterId);
  const char = useDoc((d) => (charId ? d.characters[charId] : undefined));
  const { undo: undoLabel, redo: redoLabel } = useHistoryLabels();
  const overlays = usePrefs((p) => p.overlays);
  const randomMode = usePrefs((p) => p.randomMode);
  const zoom = useStore(mainViewport.store, (v) => v.zoom);
  const saving = useUI((s) => s.saving);
  const theme = usePrefs((p) => p.theme);
  const zipRef = useRef<HTMLInputElement>(null);

  const toggle = (key: 'template' | 'symmetry' | 'grid') => setPrefs((p) => ({ overlays: { ...p.overlays, [key]: !p.overlays[key] } }));

  return (
    <header className="topbar">
      <div className="tb-group">
        <span className="logo" aria-hidden="true">
          🎀
        </span>
        <MenuButton
          icon="folder"
          label={<span className="ellipsis tb-project">{projectName}</span>}
          tip="Project menu: switch projects, settings, backup"
          tour="project"
          items={[
            { label: 'All projects…', icon: 'folder', onClick: () => openDialog({ kind: 'projects' }) },
            { label: 'Project settings…', icon: 'gear', onClick: () => openDialog({ kind: 'project-settings' }) },
            { separator: true, label: '' },
            {
              label: 'Export project as .zip',
              icon: 'download',
              hint: 'backup',
              onClick: async () => {
                const { exportProjectZip } = await import('../../io/projectZip');
                await exportProjectZip();
              },
            },
            { label: 'Import project .zip…', icon: 'upload', onClick: () => zipRef.current?.click() },
            { separator: true, label: '' },
            {
              label: 'New empty project…',
              icon: 'plus',
              onClick: async () => {
                const name = await promptDialog({ title: 'New project', placeholder: 'Project name', value: 'My project', confirmLabel: 'Create' });
                if (name) await createProject(name);
              },
            },
          ]}
        />
        <input
          ref={zipRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const { importProjectZip } = await import('../../io/projectZip');
            await importProjectZip(f);
          }}
        />
        <span className="tb-sep" />
        {char && <TextField className="tb-name" value={char.name} tip="Character name (click to rename)" onCommit={(n) => renameCharacter(char.id, n)} />}
        <Btn icon="gallery" tip="Gallery: all saved characters (Ctrl+G)" tour="gallery" onClick={() => openDialog({ kind: 'gallery' })} />
        <Btn icon="plus" tip="New character" onClick={() => createCharacter()} />
      </div>

      <div className="tb-group">
        <Btn icon="undo" tip={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} disabled={!undoLabel} onClick={undo} />
        <Btn icon="redo" tip={redoLabel ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} disabled={!redoLabel} onClick={redo} />
      </div>

      <div className="tb-group">
        {char && (
          <span data-tour="pose">
            <Select
              className="tb-pose"
              tip="Pose / head angle — switching shows only parts made for that pose"
              value={char.poseId}
              onChange={(p) => setPose(p)}
              options={poses.map((p) => ({ value: p.id, label: `🧭 ${p.name}` }))}
            />
          </span>
        )}
        <span className="split-btn" data-tour="randomize">
          <Btn
            icon="dice"
            label="Randomize"
            tip={`Randomize ${randomMode === 'both' ? 'parts and colors' : randomMode} (Shift+R). Locked categories stay.`}
            variant="soft"
            onClick={() => randomizeActive()}
          />
          <MenuButton
            icon="chevDown"
            tip="Randomize options"
            variant="soft"
            items={[
              { label: 'Parts and colors', checked: randomMode === 'both', onClick: () => setPrefs({ randomMode: 'both' }) },
              { label: 'Parts only', checked: randomMode === 'parts', onClick: () => setPrefs({ randomMode: 'parts' }) },
              { label: 'Colors only', checked: randomMode === 'colors', onClick: () => setPrefs({ randomMode: 'colors' }) },
              { separator: true, label: '' },
              { label: 'Surprise me (favorites only)', icon: 'sparkles', hint: 'Shift+F', onClick: () => randomizeActive({ favoritesOnly: true }) },
              { label: 'Lock categories: use the 🔒 on each library tab', icon: 'lock', disabled: true },
            ]}
          />
        </span>
      </div>

      <div className="tb-group" data-tour="overlays">
        <Btn icon="template" tip="Template guides (T)" active={overlays.template} onClick={() => toggle('template')} />
        <Btn icon="symmetry" tip="Symmetry line (M)" active={overlays.symmetry} onClick={() => toggle('symmetry')} />
        <Btn icon="grid" tip="Grid (G)" active={overlays.grid} onClick={() => toggle('grid')} />
        <span className="tb-sep" />
        <Btn icon="zoomOut" tip="Zoom out (-)" onClick={() => mainViewport.zoomCenter(0.8)} />
        <button type="button" className="btn btn-ghost tb-zoom" data-tip="Zoom level — click for 100% (1)" onClick={() => mainViewport.setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <Btn icon="zoomIn" tip="Zoom in (+)" onClick={() => mainViewport.zoomCenter(1.25)} />
        <Btn
          icon="fit"
          tip="Fit to screen (0)"
          onClick={() => setUI((s) => ({ fitRequest: s.fitRequest + 1 }))}
        />
      </div>

      <div className="tb-group tb-right">
        <span className={`save-state${saving ? ' is-saving' : ''}`} data-tip="Everything is saved automatically in this browser">
          <span className="save-dot" aria-hidden="true" />
          <span className="save-text">{saving ? 'Saving…' : 'Saved'}</span>
        </span>
        <Btn icon="pen" label="Trace" tip="Trace a new part over a reference image" tour="trace" onClick={() => startTrace({ categoryId: uiStore.get().activeCategoryId ?? undefined })} />
        <Btn icon="download" label="Export" variant="primary" tip="Export PNG, expression sheet or share code (Ctrl+E)" tour="export" onClick={() => openDialog({ kind: 'export' })} />
        <MenuButton
          icon="help"
          tip="Help"
          placement="bottom-end"
          items={[
            { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onClick: () => openDialog({ kind: 'shortcuts' }) },
            { label: 'Replay the quick tour', icon: 'flag', onClick: () => setUI({ tourStep: 0 }) },
            { label: 'How to make a new part', icon: 'pen', onClick: () => toast('Trace → load a reference → trace with the stabilizer → Make fill → shade in gray → Save as part → tag it.', { ms: 9000 }) },
            { separator: true, label: '' },
            {
              label: 'Theme: follow system',
              checked: theme === 'system',
              onClick: () => setPrefs({ theme: 'system' }),
            },
            { label: 'Theme: dark', checked: theme === 'dark', onClick: () => setPrefs({ theme: 'dark' }) },
            { label: 'Theme: light', checked: theme === 'light', onClick: () => setPrefs({ theme: 'light' }) },
          ]}
        />
      </div>
    </header>
  );
}
