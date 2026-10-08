import type { Character } from '../../model/types';
import { useDoc } from '../../state/store';
import { closeDialog, useUI } from '../../state/ui';
import { createCharacter, duplicateCharacter, openCharacter, renameCharacter, trashCharacter } from '../../state/actions';
import { Dialog, MenuButton, confirmDialog, promptDialog } from '../../ui/overlays';
import { Btn } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { useCharThumb } from './charThumbs';

function Card({ char, current }: { char: Character; current: boolean }) {
  const url = useCharThumb(char);
  return (
    <div className={`gallery-card${current ? ' is-current' : ''}`}>
      <button
        type="button"
        className="gallery-open"
        data-tip={current ? 'This character is open' : `Open ${char.name}`}
        onClick={() => {
          openCharacter(char.id);
          closeDialog();
        }}
      >
        <div className="gallery-thumb checker">{url ? <img src={url} alt={char.name} /> : <span className="thumb-loading" />}</div>
      </button>
      <div className="gallery-meta">
        <div className="grow">
          <strong className="ellipsis">{char.name}</strong>
          <span className="muted small">
            {current ? 'open now · ' : ''}
            {new Date(char.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </div>
        <MenuButton
          small
          tip="Character options"
          items={[
            {
              label: 'Open',
              icon: 'chevRight',
              onClick: () => {
                openCharacter(char.id);
                closeDialog();
              },
            },
            {
              label: 'Rename…',
              icon: 'text',
              onClick: async () => {
                const n = await promptDialog({ title: 'Rename character', value: char.name });
                if (n) renameCharacter(char.id, n);
              },
            },
            { label: 'Duplicate', icon: 'copy', onClick: () => duplicateCharacter(char.id) },
            { separator: true, label: '' },
            {
              label: 'Delete…',
              icon: 'trash',
              danger: true,
              onClick: async () => {
                if (await confirmDialog({ title: `Delete “${char.name}”?`, message: 'It moves to the Trash (library menu → Trash). You can also press Undo.', confirmLabel: 'Move to Trash', danger: true }))
                  trashCharacter(char.id);
              },
            },
          ]}
        />
      </div>
    </div>
  );
}

export function GalleryDialog() {
  const chars = useDoc((d) => d.characters);
  const current = useUI((s) => s.characterId);
  const list = Object.values(chars)
    .filter((c) => !c.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <Dialog
      title="Gallery"
      icon="gallery"
      wide="xl"
      onClose={closeDialog}
      footer={
        <>
          <span className="muted small grow">Characters save automatically while you edit.</span>
          <Btn label="Close" tip="Close" onClick={closeDialog} />
        </>
      }
    >
      <div className="gallery-grid">
        <button
          type="button"
          className="gallery-card gallery-new"
          data-tip="Start a new character (keeps your current colors)"
          onClick={() => {
            createCharacter();
            closeDialog();
          }}
        >
          <Icon name="plus" size={36} />
          <span>New character</span>
        </button>
        {list.map((c) => (
          <Card key={c.id} char={c} current={c.id === current} />
        ))}
      </div>
    </Dialog>
  );
}
