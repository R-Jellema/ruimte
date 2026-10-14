import { useEffect, useState } from 'react';
import { desktop } from '@/desktop/bridge';

/* Whether a daemon already answers on this computer's port. Asked when it is mounted and when the window gets the focus, never on a timer; a failure reads as no. */
export function useMachineFound(enabled: boolean): boolean {
    const [found, setFound] = useState(false);
    useEffect(() => {
        const machine = desktop()?.machine;
        if (!enabled || machine === undefined) {
            return;
        }
        let alive = true;
        const ask = (): void => {
            machine
                .found()
                .then((answer) => {
                    if (alive) {
                        setFound(answer);
                    }
                })
                .catch(() => {
                    if (alive) {
                        setFound(false);
                    }
                });
        };
        ask();
        window.addEventListener('focus', ask);
        return () => {
            alive = false;
            window.removeEventListener('focus', ask);
        };
    }, [enabled]);
    return found;
}
