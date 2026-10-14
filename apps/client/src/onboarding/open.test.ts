import { afterEach, describe, expect, test } from 'bun:test';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { closeOnboarding, openOnboarding, startOnboarding } from './open';

let stop: () => void = () => undefined;

afterEach(() => {
    stop();
    useSettings.setState({ onboardingSeen: false, onboardingIntroSeen: false, onboardingSkipWelcome: false });
    useUi.setState({ onboarding: null });
});

describe('meeting the onboarding', () => {
    test('opens on the welcome on a client that never met it, and never without a machine of its own', () => {
        stop = startOnboarding(false);
        expect(useUi.getState().onboarding).toBeNull();
        stop = startOnboarding(true);
        expect(useUi.getState().onboarding).toBe('welcome');
    });

    test('stays away once met, and comes back on its list when asked', () => {
        useSettings.setState({ onboardingSeen: true });
        stop = startOnboarding(true);
        expect(useUi.getState().onboarding).toBeNull();
        openOnboarding(true);
        expect(useUi.getState().onboarding).toBe('hub');
    });

    test('counts as met once closed, wherever it stood', () => {
        stop = startOnboarding(true);
        closeOnboarding();
        expect(useSettings.getState().onboardingSeen).toBe(true);
        expect(useUi.getState().onboarding).toBeNull();
    });

    test('puts its welcome away when another window answered it, but keeps a list a person opened', () => {
        stop = startOnboarding(true);
        useSettings.setState({ onboardingSeen: true });
        expect(useUi.getState().onboarding).toBeNull();
        useSettings.setState({ onboardingSeen: false });
        useUi.setState({ onboarding: 'hub' });
        useSettings.setState({ onboardingSeen: true });
        expect(useUi.getState().onboarding).toBe('hub');
    });
});

describe('after the first-run choice', () => {
    test('opens on the list instead of the welcome, and closing clears the mark', () => {
        useSettings.setState({ onboardingSkipWelcome: true });
        stop = startOnboarding(true);
        expect(useUi.getState().onboarding).toBe('hub');
        closeOnboarding();
        expect(useSettings.getState().onboardingSkipWelcome).toBe(false);
        expect(useSettings.getState().onboardingSeen).toBe(true);
    });
});
