import { useTranslation } from 'react-i18next';
import { Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useSettings, type Settings } from '@/state/settings';

type BooleanSetting = { [Key in keyof Settings]: Settings[Key] extends boolean ? Key : never }[keyof Settings];

/* A switch for one setting of this client, with its words under `settings:<id>.label` and `.description`; the search finds it by `id`. */
export function SettingSwitchRow({ id, setting }: { id: string; setting: BooleanSetting }) {
    const { t } = useTranslation('settings');
    const checked = useSettings((s) => s[setting]);
    const update = useSettings((s) => s.update);

    return (
        <SettingsRow
            searchId={id}
            label={t(`${id}.label`)}
            description={t(`${id}.description`)}
            control={<Switch checked={checked} onCheckedChange={(next) => update({ [setting]: next })} label={t(`${id}.label`)} />}
        />
    );
}
