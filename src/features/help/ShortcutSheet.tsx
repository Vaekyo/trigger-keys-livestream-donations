import { closeDialog } from '../../state/ui';
import { Dialog } from '../../ui/overlays';
import { Kbd } from '../../ui/controls';
import { SHORTCUTS } from '../shell/shortcuts';

export function ShortcutSheet() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <Dialog title="Keyboard shortcuts" icon="keyboard" wide onClose={closeDialog}>
      <div className="shortcut-grid">
        {groups.map((g) => (
          <section key={g}>
            <h4>{g}</h4>
            <dl>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.keys + s.label} className="shortcut-row">
                  <dt>
                    {s.keys.split(' / ').map((k, i) => (
                      <span key={k}>
                        {i > 0 && ' / '}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="muted small">On Mac, use ⌘ instead of Ctrl. Every button also shows a tooltip when you hover it (or long-press on touch screens).</p>
    </Dialog>
  );
}
