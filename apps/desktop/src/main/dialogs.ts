import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { allFilesLabel, openDialogPlan, parseOpenPathRequest, parseSavePathRequest } from '../database-bridge';
import { copyablePaths, fileClipboard, osClipboardFormat } from '../file-clipboard';
import { openImageCopy } from '../open-image';
import { isSystemSettingsPane, isWebLink } from '../web-guards';
import { electron } from './electron';
import type { AppIpc } from './ipc';

const { app, clipboard, ClipboardItem, dialog, shell } = electron;

/* The native dialogs, the system's own apps and the clipboard, for files a page names. */
export function installDialogs(ipc: AppIpc, language: () => string | undefined): void {
    ipc.handle('dialog:pick-folder', async (event, initialPath?: string) => {
        const window = ipc.senderWindow(event);
        if (!window) {
            return null;
        }
        const result = await dialog.showOpenDialog(window, {
            properties: ['openDirectory', 'createDirectory'],
            ...(initialPath ? { defaultPath: initialPath } : {})
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });

    ipc.handle('dialog:save-file', async (event, suggestedName: string, bytes: Uint8Array, mime: string) => {
        const window = ipc.senderWindow(event);
        if (!window) {
            return null;
        }
        const extension = suggestedName.split('.').pop() ?? '';
        const result = await dialog.showSaveDialog(window, {
            defaultPath: suggestedName,
            ...(extension ? { filters: [{ name: mime, extensions: [extension] }] } : {})
        });
        if (result.canceled || !result.filePath) {
            return null;
        }
        await writeFile(result.filePath, Buffer.from(bytes));
        return result.filePath;
    });

    const openedImagesFolder = join(app.getPath('temp'), `ruimte-images-${process.pid}-${randomBytes(8).toString('hex')}`);
    app.on('will-quit', () => void rm(openedImagesFolder, { recursive: true, force: true }).catch(() => undefined));
    ipc.handle('image:open', async (_event, suggestedName: string, bytes: Uint8Array, mime: string) => {
        await openImageCopy(openedImagesFolder, suggestedName, bytes, mime, (path) => shell.openPath(path));
    });

    /* Where a database export goes. Only the path comes back: the machine writes the file, and only for a page on this computer. */
    ipc.handle('dialog:choose-save-path', async (event, request: unknown) => {
        const { suggestedName, extension } = parseSavePathRequest(request);
        const window = ipc.senderWindow(event);
        if (!window) {
            return null;
        }
        const result = await dialog.showSaveDialog(window, {
            defaultPath: suggestedName,
            filters: [
                { name: extension.toUpperCase(), extensions: [extension] },
                { name: allFilesLabel(language()), extensions: ['*'] }
            ]
        });
        return result.canceled || !result.filePath ? null : result.filePath;
    });

    /* A file to import, a SQLite database or an SSH key. Only the path comes back; nothing is read here. */
    ipc.handle('dialog:choose-open-path', async (event, request: unknown) => {
        const plan = openDialogPlan(parseOpenPathRequest(request), app.getPath('home'), allFilesLabel(language()));
        const window = ipc.senderWindow(event);
        if (!window) {
            return null;
        }
        const result = await dialog.showOpenDialog(window, {
            properties: plan.showHiddenFiles ? ['openFile', 'showHiddenFiles'] : ['openFile'],
            filters: plan.filters,
            ...(plan.defaultPath === undefined ? {} : { defaultPath: plan.defaultPath })
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });

    ipc.handle('shell:open-external', async (_event, url: string) => {
        if (isWebLink(url)) {
            await shell.openExternal(url);
        }
    });

    ipc.handle('shell:open-system-settings', async (_event, url: string) => {
        if (process.platform === 'darwin' && isSystemSettingsPane(url)) {
            await shell.openExternal(url);
        }
    });

    // One path that is relative or gone refuses the whole copy.
    ipc.handle('clipboard:copy-files', async (_event, requested: unknown) => {
        const paths = copyablePaths(requested);
        const contents = paths === null ? null : fileClipboard(process.platform, paths);
        if (paths === null || contents === null || !paths.every((path) => existsSync(path))) {
            return false;
        }
        const formats = Object.entries(contents.formats).map(([format, value]) => [osClipboardFormat(format), new Blob([value])] as const);
        await clipboard.write([new ClipboardItem({ 'text/plain': contents.text, ...Object.fromEntries(formats) })]);
        return true;
    });
}
