import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUp, PawPrint, Pencil, Trash2 } from 'lucide-react';
import { Button, Checkbox, Icon, IconButton, Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { SHEET_LIMITS, stripsOf, usePetSprites, type CustomPetSprite } from '@/canvas/pets/custom-sprites';
import { CUSTOM_PET_PREFIX, PET_SETS, petChoiceKey, petPoolOf, petSetsWith } from '@/canvas/pets/pet-state';
import { PetFigureDialog, type PetFigureEdit } from '@/shell/settings/panes/PetFigureDialog';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings, type PetsPlace } from '@/state/settings';

const PETS_PLACES: readonly PetsPlace[] = ['nodes', 'screen'];

/* Pets on the canvas: whether they come, which figures, and the strips a person added, which stay in this client. */
export function PetsSection() {
    const { t } = useTranslation('settings');
    const setting = useSettings((s) => s.petsSets);
    const place = useSettings((s) => s.petsPlace);
    const update = useSettings((s) => s.update);
    const sprites = usePetSprites((s) => s.sprites);
    const remove = usePetSprites((s) => s.remove);
    const [edit, setEdit] = useState<PetFigureEdit | null>(null);

    const pool = petPoolOf(
        setting,
        sprites.map((sprite) => sprite.id)
    );
    const picked = pool.map(petChoiceKey);
    const choices = [
        ...PET_SETS.map((set) => ({ key: set, label: t(`views.pets.sprite.sets.${set}`) })),
        ...sprites.map((sprite) => ({ key: `${CUSTOM_PET_PREFIX}${sprite.id}`, label: sprite.name }))
    ];

    const open = (sprite: CustomPetSprite | null): void => setEdit({ sprite, open: true, round: (edit?.round ?? 0) + 1 });

    const saved = (sprite: CustomPetSprite): void => {
        // A figure a person just added joins the pets, beside the sets already picked; a changed one stays where it was.
        if (edit?.sprite === null) {
            update({ petsSets: petSetsWith(pool, `${CUSTOM_PET_PREFIX}${sprite.id}`, true) });
        }
        setEdit(edit === null ? null : { ...edit, open: false });
    };

    const removeSprite = (id: string): void => {
        remove(id);
        const rest = picked.filter((key) => key !== `${CUSTOM_PET_PREFIX}${id}`);
        update({ petsSets: rest.length > 0 ? rest : ['buddies'] });
    };

    return (
        <SettingsSection title={t('views.pets.title')} icon={PawPrint}>
            <SettingSwitchRow id="views.pets.enabled" setting="pets" />
            <SettingsRow
                searchId="views.pets.place"
                label={t('views.pets.place.label')}
                description={t('views.pets.place.description')}
                control={
                    <Select
                        value={place}
                        label={t('views.pets.place.label')}
                        align="end"
                        items={PETS_PLACES.map((each) => ({ value: each, label: t(`views.pets.place.${each}`) }))}
                        onValueChange={(next) => update({ petsPlace: next })}
                    />
                }
            />
            <SettingSwitchRow id="views.pets.subagents" setting="petsSubagents" />
            <SettingSwitchRow id="views.pets.visitor" setting="petsVisitor" />
            <SettingsRow searchId="views.pets.sprite" label={t('views.pets.sprite.label')} description={t('views.pets.sprite.description')}>
                <ul role="group" aria-label={t('views.pets.sprite.label')} className="flex flex-col gap-1">
                    {choices.map((choice) => {
                        const on = picked.includes(choice.key);
                        return (
                            <li key={choice.key}>
                                <label className="flex items-center gap-2 text-sm text-text">
                                    <Checkbox
                                        checked={on}
                                        // The last set picked stays, so the pets always come from one.
                                        disabled={on && picked.length === 1}
                                        label={choice.label}
                                        onCheckedChange={(next) => update({ petsSets: petSetsWith(pool, choice.key, next) })}
                                    />
                                    <span className="min-w-0 truncate">{choice.label}</span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </SettingsRow>
            <SettingsRow
                searchId="views.pets.custom"
                label={t('views.pets.custom.label')}
                description={t('views.pets.custom.description', {
                    frames: SHEET_LIMITS.maxFrames,
                    size: SHEET_LIMITS.maxFrame,
                    kilobytes: SHEET_LIMITS.bytes / 1024
                })}
                control={
                    <Button disabled={sprites.length >= SHEET_LIMITS.maxSprites} onClick={() => open(null)}>
                        <Icon icon={ImageUp} size={12} /> {t('views.pets.custom.add')}
                    </Button>
                }
            >
                {sprites.length > 0 && (
                    <ul className="flex flex-col gap-1">
                        {sprites.map((sprite) => (
                            <li key={sprite.id} className="flex items-center gap-2 text-sm text-text">
                                <span className="min-w-0 grow truncate">{sprite.name}</span>
                                <span className="shrink-0 text-xs text-text-muted tabular-nums">
                                    {t('views.pets.custom.stateCount', { count: Object.keys(stripsOf(sprite)).length })}
                                </span>
                                <IconButton icon={Pencil} size="sm" label={t('views.pets.custom.edit', { name: sprite.name })} onClick={() => open(sprite)} />
                                <IconButton
                                    icon={Trash2}
                                    size="sm"
                                    label={t('views.pets.custom.remove', { name: sprite.name })}
                                    onClick={() => removeSprite(sprite.id)}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </SettingsRow>
            <PetFigureDialog key={edit?.round ?? 0} edit={edit} onClose={() => setEdit(edit === null ? null : { ...edit, open: false })} onSaved={saved} />
        </SettingsSection>
    );
}
