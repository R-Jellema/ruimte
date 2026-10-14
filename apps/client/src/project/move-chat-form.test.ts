import { describe, expect, test } from 'bun:test';
import type { ChatMoveInfoResult } from '@ruimte/contracts';
import { baseName, defaultOwnFiles, folderSlug, joinFolder, moveTargetOf, NEW_PROJECT, workedCard, type MoveForm } from './move-chat-form';

const INFO = {
    folders: [
        { path: '/work/vinyl-shelf', project: null, branch: null, files: 3 },
        { path: '/work/atlas', project: { projectId: 'p-atlas', name: 'Atlas' }, branch: null, files: 1 }
    ]
} as ChatMoveInfoResult;

const FORM: MoveForm = { destination: NEW_PROJECT, folder: 'new', name: 'Vinyl shelf', newPath: '', initGit: true, chosenPath: '' };

describe('the folder of a new project', () => {
    test('is named after the project in plain words', () => {
        expect(folderSlug('Vinyl Shelf')).toBe('vinyl-shelf');
        expect(folderSlug('  Café & Bar!  ')).toBe('cafe-bar');
        expect(folderSlug('日本')).toBe('');
    });

    test('goes under its parent in the style of the machine', () => {
        expect(joinFolder('/work', 'vinyl')).toBe('/work/vinyl');
        expect(joinFolder('/work/', 'vinyl')).toBe('/work/vinyl');
        expect(joinFolder('C:\\work', 'vinyl')).toBe('C:\\work\\vinyl');
        expect(baseName('/work/vinyl/')).toBe('vinyl');
    });
});

describe('what the form asks the machine for', () => {
    test('a project that is there by its id, whatever else the form holds', () => {
        expect(moveTargetOf({ ...FORM, destination: 'p-1' }, INFO, '')).toEqual({ projectId: 'p-1' });
    });

    test('nothing until a project or a folder is picked', () => {
        expect(moveTargetOf({ ...FORM, destination: null }, INFO, '/work/x')).toBeNull();
        expect(moveTargetOf(FORM, INFO, '')).toBeNull();
        expect(moveTargetOf(FORM, INFO, 'relative/path')).toBeNull();
    });

    test('a new folder is made, with the repository the person asked for', () => {
        expect(moveTargetOf(FORM, INFO, '/work/vinyl-shelf')).toEqual({ folder: '/work/vinyl-shelf', name: 'Vinyl shelf', createFolder: true, initGit: true });
        expect(moveTargetOf({ ...FORM, initGit: false }, INFO, '/work/vinyl-shelf')).toMatchObject({ initGit: false });
    });

    test('a folder where the chat worked is a project by id when the machine has one there, else a folder that is not made', () => {
        expect(moveTargetOf({ ...FORM, folder: 'worked:1' }, INFO, '')).toEqual({ projectId: 'p-atlas' });
        expect(moveTargetOf({ ...FORM, folder: 'worked:0' }, INFO, '')).toEqual({
            folder: '/work/vinyl-shelf',
            name: 'Vinyl shelf',
            createFolder: false,
            initGit: false
        });
        expect(workedCard(INFO, 'worked:5')).toBeNull();
    });

    test('a chosen folder is not made', () => {
        expect(moveTargetOf({ ...FORM, folder: 'choose', chosenPath: '/elsewhere' }, INFO, '/ignored')).toMatchObject({
            folder: '/elsewhere',
            createFolder: false
        });
    });

    test('a question without a name still names the project', () => {
        expect(moveTargetOf({ ...FORM, name: '  ' }, INFO, '/work/x')).toMatchObject({ name: 'project' });
    });
});

describe('what happens to the files of the chat', () => {
    test('they go along into a folder made for them and stay in Chats everywhere else', () => {
        expect(defaultOwnFiles(FORM)).toBe('move');
        expect(defaultOwnFiles({ ...FORM, folder: 'choose' })).toBe('leave');
        expect(defaultOwnFiles({ ...FORM, folder: 'worked:0' })).toBe('leave');
        expect(defaultOwnFiles({ ...FORM, destination: 'p-1' })).toBe('leave');
    });
});
