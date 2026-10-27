import { Folder, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@adecore/ui/settings';
import { Input, Segmented, Stepper } from '@adecore/ui';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { FILES_TAB_LIMIT_RANGE, useSettings } from '@/state/settings';

/* The two panels beside the canvas, what the Files panel shows and keeps open, and how the Git panel lists what changed. */
export function FilesPane() {
    const { t } = useTranslation('settings');
    const filesTabLimit = useSettings((s) => s.filesTabLimit);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const diffLayout = useSettings((s) => s.diffLayout);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('files.files.title')} icon={Folder}>
                <SettingsRow
                    searchId="files.files.openFiles"
                    label={t('files.files.openFiles.label')}
                    description={t('files.files.openFiles.description')}
                    control={
                        <Stepper
                            value={filesTabLimit}
                            min={FILES_TAB_LIMIT_RANGE.min}
                            max={FILES_TAB_LIMIT_RANGE.max}
                            step={FILES_TAB_LIMIT_RANGE.step}
                            label={t('files.files.openFiles.label')}
                            onValueChange={(value) => update({ filesTabLimit: value })}
                        />
                    }
                />
                <SettingSwitchRow id="files.files.hidden" setting="filesShowHidden" />
                <SettingsRow
                    searchId="files.files.browseStart"
                    label={t('files.files.browseStart.label')}
                    description={t('files.files.browseStart.description')}
                >
                    <Input
                        mono
                        aria-label={t('files.files.browseStart.label')}
                        placeholder="~/projects"
                        value={browseStartFolder}
                        spellCheck={false}
                        onChange={(e) => update({ browseStartFolder: e.target.value })}
                        onKeyDown={(e) => e.stopPropagation()}
                    />
                </SettingsRow>
            </SettingsSection>
            <SettingsSection title={t('files.git.title')} icon={GitBranch}>
                <SettingsRow
                    searchId="files.git.layout"
                    label={t('files.git.layout.label')}
                    description={t('files.git.layout.description')}
                    control={
                        <Segmented
                            value={diffLayout}
                            options={[
                                { id: 'stacked', label: t('files.git.layout.options.stacked') },
                                { id: 'split', label: t('files.git.layout.options.split') }
                            ]}
                            label={t('files.git.layout.label')}
                            onValueChange={(value) => update({ diffLayout: value })}
                        />
                    }
                />
                <SettingSwitchRow id="files.git.whitespace" setting="diffWhitespace" />
            </SettingsSection>
        </>
    );
}
