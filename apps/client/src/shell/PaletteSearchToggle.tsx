import type { LucideIcon } from 'lucide-react';
import { IconButton } from '@adecore/ui';

export function PaletteSearchToggle({ icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
    return (
        <IconButton
            icon={icon}
            size="sm"
            label={label}
            aria-pressed={active}
            // The field keeps the keys; a toggle that takes focus would swallow the next arrow.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
        />
    );
}
