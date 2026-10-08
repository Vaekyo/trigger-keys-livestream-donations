import type { ID } from '../../model/types';
import { createStore } from '../../state/store';
import { setUI } from '../../state/ui';

export interface TraceLaunch {
  categoryId?: ID;
  /** Re-open a part made in the studio. */
  editPartId?: ID;
  /** Start a new drawing with an existing part as the reference image. */
  referencePartId?: ID;
}

export const traceLaunchStore = createStore<TraceLaunch | null>(null);

export function startTrace(opts: TraceLaunch = {}) {
  traceLaunchStore.set({ ...opts });
  setUI({ mode: 'trace', dialog: null });
}

export function exitTrace() {
  setUI({ mode: 'mixer' });
  traceLaunchStore.set(null);
}
