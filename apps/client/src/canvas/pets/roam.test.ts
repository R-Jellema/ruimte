import { describe, expect, test } from 'bun:test';
import { FIGURE, FLOOR_LEVEL, groundOf, Roam, type Obstacle } from '@/canvas/pets/roam';

const WIDTH = 1200;
const DOCK: Obstacle = { left: 400, right: 800, bottom: 16, top: 60, ledge: true };
const MINIMAP: Obstacle = { left: 980, right: 1184, bottom: 16, top: 160, ledge: false };

/* A random that runs through the same numbers every time. */
function seeded(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

describe('the ground along the bottom of a canvas', () => {
    test('is the floor on either side of the dock and the minimap, and the top of the dock', () => {
        const ground = groundOf(WIDTH, [DOCK, MINIMAP]);
        expect(ground.floors).toEqual([
            { left: 8, right: 400 - FIGURE.w },
            { left: 800, right: 980 - FIGURE.w }
        ]);
        expect(ground.ledge?.level).toBe(58);
        // Only the dock is a step up; the minimap is walked around.
        expect(ground.climbs.map((climb) => climb.floor)).toEqual([400 - FIGURE.w, 800]);
    });

    test('has no room on the dock while a prompt card stands just above it', () => {
        const card: Obstacle = { left: 300, right: 900, bottom: 64, top: 400, ledge: false };
        expect(groundOf(WIDTH, [DOCK, card]).ledge).toBeNull();
    });

    test('runs under what stands higher than a pet, and is the whole floor without a dock', () => {
        const card: Obstacle = { left: 300, right: 900, bottom: 64, top: 400, ledge: false };
        expect(groundOf(WIDTH, [card]).floors).toEqual([{ left: 8, right: WIDTH - 8 - FIGURE.w }]);
    });
});

describe('pets along the bottom of the screen', () => {
    test('start spread over the floor, not in a pile', () => {
        const roam = new Roam(seeded(1));
        const ground = groundOf(WIDTH, [DOCK]);
        for (const id of ['a', 'b', 'c']) {
            roam.join(id, 'idle');
        }
        roam.step(ground, false);
        const xs = ['a', 'b', 'c'].map((id) => roam.spot(id)!.x);
        expect(xs[1] - xs[0]).toBeGreaterThan(FIGURE.w);
        expect(xs[2] - xs[1]).toBeGreaterThan(FIGURE.w);
        expect(['a', 'b', 'c'].every((id) => roam.spot(id)!.y === FLOOR_LEVEL)).toBe(true);
    });

    test('wander, and in time hop onto the dock, and never stand in it', () => {
        const roam = new Roam(seeded(7));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        let onDock = false;
        for (let i = 0; i < 4000; i++) {
            roam.step(ground, false);
            const spot = roam.spot('a')!;
            if (spot.y === ground.ledge!.level) {
                onDock = true;
            }
            if (spot.y === FLOOR_LEVEL) {
                expect(spot.x + FIGURE.w <= DOCK.left || spot.x >= DOCK.right).toBe(true);
            }
        }
        expect(onDock).toBe(true);
    });

    test('jump over one another rather than walk through', () => {
        const roam = new Roam(seeded(11));
        const ground = groundOf(WIDTH, []);
        roam.join('waiting', 'waiting');
        roam.join('walker', 'working');
        let crossings = 0;
        let side: number | null = null;
        for (let i = 0; i < 6000; i++) {
            roam.step(ground, false);
            const walker = roam.spot('walker')!;
            const now = Math.sign(walker.x - roam.spot('waiting')!.x);
            if (side !== null && now !== 0 && now !== side) {
                crossings += 1;
                // Over its head, not through it.
                expect(walker.y).toBeGreaterThan(FLOOR_LEVEL + FIGURE.h / 2);
            }
            side = now === 0 ? side : now;
        }
        expect(crossings).toBeGreaterThan(0);
    });

    test('one that waits on you stays where it is', () => {
        const roam = new Roam(seeded(3));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'waiting');
        roam.step(ground, false);
        const first = roam.spot('a');
        for (let i = 0; i < 500; i++) {
            roam.step(ground, false);
        }
        expect(roam.spot('a')).toEqual(first);
    });

    test('jump off the dock when it hides, onto the floor beside it', () => {
        const roam = new Roam(seeded(7));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        let i = 0;
        while (roam.spot('a')?.y !== ground.ledge!.level && i < 4000) {
            roam.step(ground, false);
            i += 1;
        }
        roam.join('a', 'stopped');
        // The dock comes back over the place it stood, so it takes the nearest floor beside it.
        const crowded = groundOf(WIDTH, [DOCK, { left: 300, right: 900, bottom: 64, top: 400, ledge: false }]);
        for (let step = 0; step < 10; step++) {
            roam.step(crowded, false);
        }
        const spot = roam.spot('a')!;
        expect(spot.y).toBe(FLOOR_LEVEL);
        expect(spot.x + FIGURE.w <= DOCK.left || spot.x >= DOCK.right).toBe(true);
    });

    test('with reduced motion only take their place and never walk', () => {
        const roam = new Roam(seeded(5));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        roam.step(ground, true);
        const first = roam.spot('a');
        for (let i = 0; i < 500; i++) {
            roam.step(ground, true);
        }
        expect(roam.spot('a')).toEqual(first);
        expect(first?.walking).toBe(false);
    });
});
