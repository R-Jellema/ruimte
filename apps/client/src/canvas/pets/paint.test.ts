import { describe, expect, test } from 'bun:test';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/canvas/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/canvas/pets/animals';
import { drawnFrameKey, petPainter, type PetLook } from '@/canvas/pets/paint';
import type { PetFrame, PetMood } from '@/canvas/pets/pet-state';
import { DRAWN_CYCLE, PET_POSES } from '@/canvas/pets/pixel';

const STILL_STRIP: PetLook = { kind: 'sheet', sprite: { id: 'still', name: 'Still', image: 'data:image/png;base64,AAAA', frameSize: 16, frames: 1 } };
const BUDDY: PetLook = { kind: 'drawn', sprite: CLAUDE_BUDDY };

function paintsOver(look: PetLook, mood: PetMood, ticks: number, done: (frame: PetFrame) => boolean = () => true): PetFrame[] {
    const painted: PetFrame[] = [];
    const tick = petPainter(look, mood, false, (frame) => {
        const finished = done(frame);
        if (finished) {
            painted.push(frame);
        }
        return finished;
    });
    for (let i = 0; i < ticks; i++) {
        tick(i);
    }
    return painted;
}

describe('a pet paints only a picture that changed', () => {
    test('a strip of one frame paints once, however many beats go by', () => {
        for (const mood of ['idle', 'working', 'stopped', 'visiting'] as const) {
            expect(paintsOver(STILL_STRIP, mood, 60)).toHaveLength(1);
        }
    });

    test('a strip of one frame that waits paints each step of its jump, and once more only for the next jump', () => {
        const painted = paintsOver(STILL_STRIP, 'waiting', 8);
        // Two ticks on the ground in a row draw one picture.
        expect(painted.map((frame) => frame.lift)).toEqual([0, 2, 3, 4, 3, 2, 0]);
    });

    test('a strip that waits, snoozed, paints its bubble once and stands still', () => {
        const painted = paintsOver(STILL_STRIP, 'snoozed', 40);
        expect(painted).toHaveLength(1);
        expect(painted[0].bubble).toBe(true);
    });

    test('a paint that could not finish, a strip still decoding, is tried again on the next beat', () => {
        let calls = 0;
        const painted = paintsOver(STILL_STRIP, 'idle', 10, () => {
            calls += 1;
            return calls > 1;
        });
        expect(calls).toBe(2);
        expect(painted).toHaveLength(1);
    });

    test('a built-in figure at rest paints once per frame of its own, not once per beat', () => {
        // Asleep it moves every fourth beat, so 48 beats are 12 frames of its own.
        expect(paintsOver(BUDDY, 'idle', 48)).toHaveLength(12);
    });

    test('a built-in figure looks the same a cycle later, which is why the key may wrap there', () => {
        for (const sprite of [CLAUDE_BUDDY, CODEX_BUDDY, FOX_SPRITE, FROG_SPRITE]) {
            for (const pose of PET_POSES) {
                for (let frame = 0; frame < DRAWN_CYCLE; frame++) {
                    expect(sprite.poses[pose](frame + DRAWN_CYCLE)).toEqual(sprite.poses[pose](frame));
                }
            }
        }
        const frame: PetFrame = { pose: 'work', frame: 3, lift: 0, bubble: false };
        expect(drawnFrameKey(BUDDY, frame)).toBe(drawnFrameKey(BUDDY, { ...frame, frame: 3 + DRAWN_CYCLE }));
    });
});
