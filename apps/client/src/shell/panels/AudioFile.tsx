import type { ComponentProps } from 'react';
import { MediaFile } from '@/shell/panels/VideoFile';

export function AudioFile(props: Omit<ComponentProps<typeof MediaFile>, 'kind'>) {
    return <MediaFile kind="audio" {...props} />;
}
