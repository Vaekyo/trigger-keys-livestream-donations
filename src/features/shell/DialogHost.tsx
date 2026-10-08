import { useUI } from '../../state/ui';
import { ImportDialog } from '../import/ImportDialog';
import { AlignDialog, PartDetailsDialog } from '../library/PartDialogs';
import { CategoryManager } from '../categories/CategoryManager';
import { ProjectSettings } from '../projects/ProjectSettings';
import { ProjectsDialog } from '../projects/ProjectsDialog';
import { GalleryDialog } from '../gallery/GalleryDialog';
import { ExportDialog } from '../export/ExportDialog';
import { ShortcutSheet } from '../help/ShortcutSheet';

export function DialogHost() {
  const d = useUI((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case 'import':
      return <ImportDialog files={d.files} categoryId={d.categoryId} force={d.force} />;
    case 'align':
      return <AlignDialog partId={d.partId} />;
    case 'part-details':
      return <PartDetailsDialog partIds={d.partIds} />;
    case 'categories':
      return <CategoryManager />;
    case 'project-settings':
      return <ProjectSettings tab={d.tab} />;
    case 'projects':
      return <ProjectsDialog />;
    case 'gallery':
      return <GalleryDialog />;
    case 'export':
      return <ExportDialog tab={d.tab} />;
    case 'share':
      return <ExportDialog tab="share" />;
    case 'shortcuts':
      return <ShortcutSheet />;
  }
}
