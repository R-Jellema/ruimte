import {
    PROTOCOL_VERSION,
    type AgentIntegrationReport,
    type AgentIntegrationsResult,
    type EndpointSettings,
    type LanDoor,
    type MachineUpdate,
    type MachineUpdateReport,
    type MachineWork
} from '@ruimte/contracts';
import { RequestError, type ClientAccess, type Dispatcher } from '../dispatcher.ts';
import { isOwner } from '../auth/access.ts';
import { signForAccount } from '../auth/registration.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { EndpointIdentity, IdentityFlags } from '../endpoint-id.ts';
import { checkWorktreeRoot } from '../git/worktree-root.ts';
import type { BrokerDescription } from '../pulsar/broker-switch.ts';
import type { InstallVerdict } from '../power/machine-update.ts';
import { IntegrationsFixed, isIntegrationKind } from '../agents/integrations.ts';
import { DEFAULT_ADMIN_PROMPT } from '../power/closed-lid.ts';

interface EndpointHost {
    identity: EndpointIdentity;
    // `$RUIMTE_HOME`, which a worktree folder may not sit in.
    home: string;
    version: string;
    // The broker clients are told to dial right now (null when this machine announces itself to none), and whether a flag decides it.
    broker(): BrokerDescription;
    // Where the door on the local network stands right now (null while it is closed), and whether a flag decides it.
    lanDoor(): { lan: LanDoor | null; lanDoorFixed: boolean };
    // Revoking must take effect now, not at the next connection, so the daemon drops that session's sockets here.
    disconnect(sessionId: string): void;
    // A disabled policy stops streams already in flight as well as refusing the next one.
    streamingChanged(allowed: boolean): void;
    // Chats take up a limited turn on a clock only while this is on; turning it off drops what was owed.
    resumeChanged?(on: boolean): void;
    appleFoundationChanged?(on: boolean): Promise<void>;
    // Whether this machine can hold a block on sleep, and the call that follows a changed setting.
    keepAwake?: { available: boolean; changed(): void };
    // The closed-lid mode of a Mac: whether it is offered, whether its rule is installed, and installing or removing that.
    closedLid?: {
        available: boolean;
        rule(): Promise<boolean>;
        setRule(install: boolean, prompt: string): Promise<void>;
    };
    // What a person allowed in the CLIs' global settings, and the calls that read and change it.
    agentIntegrations?: {
        summary(): AgentIntegrationsResult['summary'];
        files(): Promise<AgentIntegrationsResult['files']>;
        set(kind: 'claude' | 'codex', on: boolean): Promise<AgentIntegrationReport[]>;
    };
    // The update of the desktop app on this machine, and what installing it would end right now.
    updates?: {
        state(): MachineUpdate;
        report(clientId: string, report: MachineUpdateReport): void;
        requestInstall(): InstallVerdict;
        ending(): MachineWork;
    };
}

export const PAIRING_REMOVED = 'Pairing links are gone. Put this machine on your account with `ruimte login`, or from the Ruimte app on it.';

export function registerAuthHandlers(dispatcher: Dispatcher, store: AuthStore, host: EndpointHost): void {
    const { identity } = host;

    // Built per client, so what the machine is called travels alongside what this connection is allowed.
    const info = async (access: ClientAccess | undefined) => ({
        id: identity.id,
        label: identity.label,
        nameSource: identity.nameSource,
        icon: identity.icon,
        agentsDeleteAnyView: identity.agentsDeleteAnyView,
        streamingAllowed: identity.streamingAllowed,
        resumeAtReset: identity.resumeAtReset,
        visualReplies: identity.visualReplies,
        appleFoundationEnabled: identity.appleFoundationEnabled,
        ...identity.keepAwakeFields(),
        keepAwakeAvailable: host.keepAwake?.available === true,
        keepAwakeLidAvailable: host.closedLid?.available === true,
        keepAwakeLidRule: host.closedLid?.available === true ? await host.closedLid.rule() : false,
        ...(host.agentIntegrations ? { agentIntegrations: host.agentIntegrations.summary() } : {}),
        ...(host.updates ? { update: host.updates.state() } : {}),
        platform: process.platform,
        version: host.version,
        protocol: PROTOCOL_VERSION,
        reachability: access?.reachability ?? 'loopback',
        authenticated: access?.sessionId !== null && access?.sessionId !== undefined,
        publicKey: identity.publicKey,
        broker: identity.broker,
        ...host.broker(),
        lanDoor: identity.lanDoor,
        ...host.lanDoor(),
        // Only the app on this machine is told which account it is on; it is the one that can take it off.
        ...(isOwner(access) ? { accountId: (await store.accountBinding())?.id ?? null, worktreeRoot: identity.worktreeRoot } : {})
    });

    dispatcher.register('endpoint.info', async (_payload, client) => ({ ...(await info(client.access)), features: dispatcher.types() }));

    /*
     * Any client the machine let in may name it. A name and an icon are how a person tells two
     * machines apart, so they belong to the machine and not to whichever client typed them.
     */
    /* The checks and the side effects of the switches both requests set; `write` stores them, with or without a new name. */
    const applySettings = async (
        settings: EndpointSettings,
        access: ClientAccess | undefined,
        write: (flags: IdentityFlags) => Promise<void>
    ): Promise<void> => {
        // Off always goes through, and a switch already on stays on; only turning it on needs the rule.
        if (settings.keepAwakeLidClosed === true && !identity.keepAwake.lidClosed) {
            if (host.closedLid?.available !== true) {
                throw new RequestError('closed-lid-unavailable', 'Only a Mac can stay awake with its lid closed');
            }
            if (!(await host.closedLid.rule())) {
                throw new RequestError('closed-lid-no-rule', 'Allow it on the Mac first: Ruimte there installs the rule with an administrator password');
            }
        }
        // Where checkouts land decides which folders the daemon makes and writes in, so it is the owner's alone.
        let worktreeRoot: string | undefined;
        if (settings.worktreeRoot !== undefined) {
            if (!isOwner(access)) {
                throw new RequestError('owner-only', 'Only a person on this machine can choose where it makes worktrees');
            }
            if (settings.worktreeRoot === '') {
                worktreeRoot = '';
            } else {
                const checked = await checkWorktreeRoot(settings.worktreeRoot, host.home);
                if ('refusal' in checked) {
                    throw new RequestError(checked.refusal, checked.message);
                }
                worktreeRoot = checked.root;
            }
        }
        await write({
            worktreeRoot,
            agentsDeleteAnyView: settings.agentsDeleteAnyView,
            streamingAllowed: settings.streamingAllowed,
            resumeAtReset: settings.resumeAtReset,
            visualReplies: settings.visualReplies,
            appleFoundationEnabled: settings.appleFoundationEnabled,
            keepAwake: settings.keepAwake,
            keepAwakeOnBattery: settings.keepAwakeOnBattery,
            keepAwakeDisplay: settings.keepAwakeDisplay,
            keepAwakeLidClosed: settings.keepAwakeLidClosed,
            broker: settings.broker,
            lanDoor: settings.lanDoor
        });
        if (
            settings.keepAwake !== undefined ||
            settings.keepAwakeOnBattery !== undefined ||
            settings.keepAwakeDisplay !== undefined ||
            settings.keepAwakeLidClosed !== undefined
        ) {
            host.keepAwake?.changed();
        }
        if (settings.streamingAllowed !== undefined) {
            host.streamingChanged(identity.streamingAllowed);
        }
        if (settings.resumeAtReset !== undefined) {
            host.resumeChanged?.(identity.resumeAtReset);
        }
        if (settings.appleFoundationEnabled !== undefined) {
            await host.appleFoundationChanged?.(identity.appleFoundationEnabled);
        }
    };

    dispatcher.register('endpoint.setIdentity', async (payload, client) => {
        await applySettings(payload, client.access, (flags) => identity.setIdentity(payload.name, payload.icon, flags));
        return info(client.access);
    });

    dispatcher.register('endpoint.settings', async (payload, client) => {
        await applySettings(payload, client.access, (flags) => identity.setSwitches(flags));
        return info(client.access);
    });

    /*
     * Only a person on this Mac may give the daemon a way to turn sleep off, so only the local secret
     * asks; macOS then asks that person for an administrator. Removing turns sleep back on and, once the
     * rule is gone, the switch off with it.
     */
    dispatcher.register('endpoint.closedLidRule', async (payload, client) => {
        if (!isOwner(client.access)) {
            throw new RequestError('forbidden', 'Only a person on this Mac can let it stay awake with its lid closed');
        }
        const closedLid = host.closedLid;
        if (closedLid?.available !== true) {
            throw new RequestError('closed-lid-unavailable', 'Only a Mac can stay awake with its lid closed');
        }
        await closedLid.setRule(payload.install, payload.prompt ?? DEFAULT_ADMIN_PROMPT[payload.install ? 'install' : 'remove']);
        return info(client.access);
    });

    /*
     * What Ruimte writes into the CLIs' own settings is a person's call on this machine, so only the local
     * secret reads the files and changes the choice. A client the machine let in is not its owner.
     */
    const integrations = (access: ClientAccess | undefined) => {
        if (!isOwner(access)) {
            throw new RequestError('forbidden', 'Only a person on this machine can change what Ruimte writes into the CLIs’ settings');
        }
        if (host.agentIntegrations === undefined) {
            throw new RequestError('unavailable', 'This machine does not manage the CLIs’ settings');
        }
        return host.agentIntegrations;
    };

    dispatcher.register('endpoint.agentIntegrations', async (_payload, client) => {
        const current = integrations(client.access);
        return { summary: current.summary(), files: await current.files() };
    });

    dispatcher.register('endpoint.setAgentIntegration', async (payload, client) => {
        const current = integrations(client.access);
        if (!isIntegrationKind(payload.provider)) {
            throw new RequestError('unknown-provider', `Ruimte has no status hooks for ${payload.provider}`);
        }
        const report = await current.set(payload.provider, payload.on).catch((e: unknown) => {
            if (e instanceof IntegrationsFixed) {
                throw new RequestError('integrations-fixed', 'This machine was started with --no-hooks');
            }
            throw e;
        });
        return { summary: current.summary(), report };
    });

    /* Only the app on this machine holds the updater, so only the local secret may say where it stands. */
    dispatcher.register('endpoint.reportUpdate', (payload, client) => {
        if (!isOwner(client.access)) {
            throw new RequestError('forbidden', 'Only the app on this machine can say where its update stands');
        }
        host.updates?.report(client.id, payload);
        return {};
    });

    /*
     * Any client may ask, not only the owner: it installs only a signed release of the app, and any
     * client can already stop every terminal and chat one by one. What it cannot do is end that
     * work unawares, so the first ask says what ends and only a second one with `confirm` installs.
     */
    dispatcher.register('endpoint.installUpdate', (payload) => {
        const updates = host.updates;
        if (!updates) {
            throw new RequestError('update-no-app', 'This machine cannot install an update from here');
        }
        const ending = updates.ending();
        if (!payload.confirm) {
            return { started: false, ending };
        }
        const verdict = updates.requestInstall();
        if (verdict === 'no-app') {
            throw new RequestError('update-no-app', 'The Ruimte app is not open on this machine; install the update there');
        }
        if (verdict === 'nothing') {
            throw new RequestError('update-none', 'There is no update to install on this machine');
        }
        return { started: true, ending };
    });

    /*
     * The machine agreeing to be listed on one address book account, which puts it on that account. Only
     * the app on this machine may ask: a machine is shared only with its owner, so another client must
     * not move it onto an account of its choosing. The client posts the answer with its own session, so
     * no account token ever reaches the daemon.
     */
    dispatcher.register('endpoint.signRegistration', async (payload, client) => {
        if (!isOwner(client.access)) {
            throw new RequestError('forbidden', 'Only the app on this machine can put it on an account');
        }
        return {
            registration: await signForAccount(store, identity, host.broker().brokerUrl, payload.accountId, (sessionId) => host.disconnect(sessionId))
        };
    });

    /* A person on this machine taking it off its account: every client a statement let in loses its access at once. */
    dispatcher.register('endpoint.leaveAccount', async (_payload, client) => {
        if (!isOwner(client.access)) {
            throw new RequestError('forbidden', 'Only the app on this machine can take it off its account');
        }
        const revoked = await store.leaveAccount();
        revoked.forEach((sessionId) => host.disconnect(sessionId));
        return { revoked: revoked.length };
    });

    dispatcher.register('auth.sessions', async (_payload, client) => ({ sessions: await store.list(client.access?.sessionId ?? null) }));

    dispatcher.register('auth.revoke', async (payload) => {
        if (!(await store.revoke(payload.id))) {
            throw new RequestError('session-not-found', `No client ${payload.id} on this machine`);
        }
        host.disconnect(payload.id);
        return {};
    });
}
