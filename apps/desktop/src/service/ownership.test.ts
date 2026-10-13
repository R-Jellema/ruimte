import { describe, expect, test } from 'bun:test';
import { launchAgentPlist, systemdUnit } from '@adecore/service';
import { daemonServiceSpec } from '@ruimte/service/host';
import { definitionHome, serviceOwnership } from './ownership';

const IDENTITY = { ruimteHome: '/home/bas/.ruimte', commandLineProgram: '/home/bas/.ruimte/bin/ruimte' };

function specOf(program: string, ruimteHome: string) {
    return daemonServiceSpec({ program, args: ['--port', '4210'], home: '/home/bas', ruimteHome, path: '/usr/bin:/bin' });
}

describe('definitionHome', () => {
    test('reads the home the app and the command line write, on both platforms', () => {
        const home = '/home/bas/My "100%" Ruimte\\ & <home>';
        expect(definitionHome(launchAgentPlist(specOf('/opt/Ruimte/resources/bin/ruimte', home)))).toBe(home);
        expect(definitionHome(systemdUnit(specOf('/opt/Ruimte/resources/bin/ruimte', home)))).toBe(home);
    });

    test('a plist that names no home, or names one twice, has none', () => {
        expect(definitionHome('<plist><dict><key>Label</key><string>app.ruimte.daemon</string></dict></plist>')).toBeNull();
        const twice = '<plist><dict><key>RUIMTE_HOME</key><string>/a</string><key>RUIMTE_HOME</key><string>/b</string></dict></plist>';
        expect(definitionHome(twice)).toBeNull();
    });

    test('a home in a plist comment is not read', () => {
        expect(definitionHome('<plist><dict><!-- <key>RUIMTE_HOME</key><string>/a</string> --></dict></plist>')).toBeNull();
    });

    test('a unit reads the last assignment of `[Service]`, and an empty one clears it', () => {
        const unit = ['[Service]', 'Environment=RUIMTE_HOME=/a', 'Environment="PATH=/bin" "RUIMTE_HOME=/b"', '# Environment=RUIMTE_HOME=/c'].join('\n');
        expect(definitionHome(unit)).toBe('/b');
        expect(definitionHome(`${unit}\nEnvironment=`)).toBeNull();
        expect(definitionHome('[Install]\nEnvironment=RUIMTE_HOME=/a')).toBeNull();
    });
});

describe('serviceOwnership', () => {
    test('nothing on disk is nobody', () => {
        expect(serviceOwnership(null, IDENTITY)).toBe('none');
    });

    test('an app with this home is this installation, wherever its binary is', () => {
        expect(serviceOwnership(systemdUnit(specOf('/opt/Ruimte/resources/bin/ruimte', IDENTITY.ruimteHome)), IDENTITY)).toBe('this');
        expect(serviceOwnership(systemdUnit(specOf('/home/bas/Apps/Ruimte/resources/bin/ruimte', IDENTITY.ruimteHome)), IDENTITY)).toBe('this');
    });

    test('another home, the command line of this home and a definition without a home are another', () => {
        expect(serviceOwnership(systemdUnit(specOf('/opt/Ruimte/resources/bin/ruimte', '/home/bas/.ruimte-beta')), IDENTITY)).toBe('other');
        expect(serviceOwnership(systemdUnit(specOf(IDENTITY.commandLineProgram, IDENTITY.ruimteHome)), IDENTITY)).toBe('other');
        expect(serviceOwnership('[Service]\nExecStart=/opt/Ruimte/resources/bin/ruimte\n', IDENTITY)).toBe('other');
    });
});
