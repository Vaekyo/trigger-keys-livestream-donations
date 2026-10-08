import { docStore } from '../state/store';
import { addParts } from '../state/actions';
import { setUI, toast } from '../state/ui';
import { generatePlaceholders } from './placeholders';

/** Re-generate the placeholder-* parts into the open project (skips names that already exist). */
export async function addPlaceholders() {
  const d = docStore.get();
  setUI({ saving: true });
  toast('Creating placeholder parts…');
  const generated = await generatePlaceholders(d.project);
  const existing = new Set(Object.values(docStore.get().parts).filter((p) => !p.deletedAt).map((p) => p.name));
  const fresh = Object.values(generated).filter((p) => !existing.has(p.name));
  addParts(fresh, `Add ${fresh.length} placeholder parts`);
  toast(fresh.length ? `Added ${fresh.length} placeholder parts` : 'All placeholder parts already exist');
}
