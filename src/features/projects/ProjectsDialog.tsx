import { useEffect, useState } from 'react';
import type { Project } from '../../model/types';
import { useDoc } from '../../state/store';
import { closeDialog } from '../../state/ui';
import { allProjects, createProject, openProject, purgeProject, restoreProject, trashProject } from '../../state/projects';
import { Dialog, confirmDialog, promptDialog } from '../../ui/overlays';
import { Btn, Toggle } from '../../ui/controls';

export function ProjectsDialog() {
  const currentId = useDoc((d) => d.project.id);
  const [list, setList] = useState<Project[]>([]);
  const [withPlaceholders, setWithPlaceholders] = useState(false);
  const refresh = () => void allProjects().then(setList);
  useEffect(refresh, []);
  const live = list.filter((p) => !p.deletedAt);
  const deleted = list.filter((p) => p.deletedAt);
  return (
    <Dialog title="Projects" icon="folder" wide onClose={closeDialog} footer={<Btn label="Close" tip="Close" onClick={closeDialog} />}>
      <p className="muted small">Each project has its own canvas size, categories, poses, parts and characters. Back up a project with Project menu → Export project as .zip.</p>
      <ul className="settings-list">
        {live.map((p) => (
          <li key={p.id} className={`row wrap${p.id === currentId ? ' is-current' : ''}`}>
            <strong className="grow">
              {p.name} {p.id === currentId && <span className="badge">open</span>}
            </strong>
            <span className="muted small">
              {p.width}×{p.height} · edited {new Date(p.updatedAt).toLocaleDateString()}
            </span>
            {p.id !== currentId && (
              <Btn
                small
                label="Open"
                variant="primary"
                tip="Switch to this project"
                onClick={async () => {
                  closeDialog();
                  await openProject(p.id);
                }}
              />
            )}
            <Btn
              small
              icon="trash"
              variant="danger"
              tip="Delete project (goes to Recently deleted)"
              onClick={async () => {
                if (await confirmDialog({ title: `Delete project “${p.name}”?`, message: 'It moves to “Recently deleted” below, where you can restore it.', confirmLabel: 'Delete', danger: true })) {
                  await trashProject(p.id);
                  refresh();
                }
              }}
            />
          </li>
        ))}
      </ul>
      <div className="row wrap">
        <Btn
          icon="plus"
          label="New project…"
          tip="Create a new project"
          onClick={async () => {
            const name = await promptDialog({ title: 'New project', value: 'My project', confirmLabel: 'Create' });
            if (!name) return;
            closeDialog();
            await createProject(name, undefined, undefined, withPlaceholders);
          }}
        />
        <Toggle label="with placeholder parts" tip="Start the new project with the generated placeholder parts" checked={withPlaceholders} onChange={setWithPlaceholders} />
      </div>
      {deleted.length > 0 && (
        <>
          <h4>Recently deleted</h4>
          <ul className="settings-list">
            {deleted.map((p) => (
              <li key={p.id} className="row wrap">
                <span className="grow">{p.name}</span>
                <span className="muted small">deleted {new Date(p.deletedAt!).toLocaleDateString()}</span>
                <Btn
                  small
                  label="Restore"
                  icon="refresh"
                  tip="Restore this project"
                  onClick={async () => {
                    await restoreProject(p.id);
                    refresh();
                  }}
                />
                <Btn
                  small
                  icon="trash"
                  variant="danger"
                  tip="Delete forever"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete “${p.name}” forever?`, message: 'All its parts, images and characters are removed from this browser. This cannot be undone.', confirmLabel: 'Delete forever', danger: true })) {
                      await purgeProject(p.id);
                      refresh();
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
