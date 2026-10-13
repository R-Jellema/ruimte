/* The channels of the app's own pages. A channel refuses every other page. */
export interface AppIpc {
    handle<Args extends unknown[]>(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => unknown): void;
    on<Args extends unknown[]>(channel: string, listener: (event: Electron.IpcMainEvent, ...args: Args) => void): void;
    /* The app window whose page sent it. */
    senderWindow(event: { sender: Electron.WebContents }): Electron.BrowserWindow | null;
}

function refuseOtherPages(): never {
    throw new Error('Only the app window may ask this');
}

/*
 * Every channel answers the app's own pages and nothing else. A guest cannot reach one (its preload
 * only talks to its host), but a page the window was navigated to would inherit the bridge.
 */
export function createAppIpc(
    ipcMain: Electron.IpcMain,
    fromAppWindow: (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => boolean,
    windowOf: (contents: Electron.WebContents) => Electron.BrowserWindow | null
): AppIpc {
    return {
        handle<Args extends unknown[]>(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => unknown): void {
            ipcMain.handle(channel, (event, ...args) => (fromAppWindow(event) ? handler(event, ...(args as Args)) : refuseOtherPages()));
        },
        on<Args extends unknown[]>(channel: string, listener: (event: Electron.IpcMainEvent, ...args: Args) => void): void {
            ipcMain.on(channel, (event, ...args) => {
                if (fromAppWindow(event)) {
                    listener(event, ...(args as Args));
                }
            });
        },
        senderWindow: (event) => windowOf(event.sender)
    };
}
