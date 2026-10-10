import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sound } from "../src/index";
import { FakeWebAudio, installWebAudioFake } from "./webAudioFake";

/**
 * What a token does with its play options on a decoded buffer.
 */
describe("a decoded token", () => {
    let fake: FakeWebAudio;
    let sound: Sound;

    beforeEach(async () => {
        fake = installWebAudioFake();
        sound = await new Sound({ silent: true }).onceReady();
    });

    afterEach(() => {
        sound.destroy();
        fake.restore();
    });

    it("plays at the rate it was asked for from the first sample", async () => {
        const channel = sound.createChannel("sfx");

        await channel.play(await sound.load("hit.wav"), { rate: 1.5 });

        // Recorded on the token and written to a later source only, so the option did nothing.
        expect(fake.contexts[0].bufferSources[0].playbackRate.value).toBe(1.5);
    });

    it("writes a loop region onto the node and arms no stop timer for it", async () => {
        vi.useFakeTimers();
        try {
            const channel = sound.createChannel("bgm");
            const token = await channel.play(await sound.load("theme.mp3"), {
                loop: true, startTime: 2, endTime: 30,
            });
            const node = fake.contexts[0].bufferSources[0];

            expect(node.starts).toEqual([{ when: 0, offset: 2 }]);
            expect(node).toMatchObject({ loop: true, loopStart: 2, loopEnd: 30 });

            // The out point of a loop is where it repeats, not where it stops.
            vi.advanceTimersByTime(60_000);
            expect(token.isPlaying()).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("repeats from a loop in point of its own", async () => {
        const channel = sound.createChannel("bgm");

        await channel.play(await sound.load("theme.mp3"), {
            loop: true, startTime: 0, loopStart: 12, endTime: 90,
        });

        // The intro plays once from the top; every repeat returns to 12s.
        expect(fake.contexts[0].bufferSources[0]).toMatchObject({ loop: true, loopStart: 12, loopEnd: 90 });
    });

    it("ignores a loop in point outside the region", async () => {
        const channel = sound.createChannel("bgm");

        await channel.play(await sound.load("theme.mp3"), {
            loop: true, startTime: 2, loopStart: 120, endTime: 30,
        });

        expect(fake.contexts[0].bufferSources[0]).toMatchObject({ loopStart: 2, loopEnd: 30 });
    });

    it("stops a one-shot at its end time", async () => {
        vi.useFakeTimers();
        try {
            const channel = sound.createChannel("sfx");
            const token = await channel.play(await sound.load("line.mp3"), { startTime: 1, endTime: 4 });

            vi.advanceTimersByTime(3000);

            expect(token.isPlaying()).toBe(false);
            expect(fake.contexts[0].bufferSources[0].stopped).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps the loop region across a seek", async () => {
        const channel = sound.createChannel("bgm");
        const token = await channel.play(await sound.load("theme.mp3"), {
            loop: true, startTime: 2, loopStart: 12, endTime: 30,
        });

        token.seek(20);

        const context = fake.contexts[0];
        expect(context.bufferSources).toHaveLength(2);
        expect(context.bufferSources[1]).toMatchObject({ loop: true, loopStart: 12, loopEnd: 30 });
        expect(context.bufferSources[1].starts).toEqual([{ when: 0, offset: 20 }]);
    });

    it("reads the play head where a seek put it, and from there on", async () => {
        const channel = sound.createChannel("voice");
        const context = fake.contexts[0];
        context.currentTime = 0.07;
        const token = await channel.play(await sound.load("line.wav"));
        context.currentTime = 0.13;

        token.seek(2.5);

        // The new session starts at 2.5 s into the clip, now - not 2.5 s before now.
        expect(context.bufferSources[1].starts).toEqual([{ when: 0, offset: 2.5 }]);
        expect(token.getCurrentTime()).toBeCloseTo(2.5, 9);
        context.currentTime = 1.13;
        expect(token.getCurrentTime()).toBeCloseTo(3.5, 9);
    });

    it("counts the time after a seek at the token's rate", async () => {
        const channel = sound.createChannel("voice");
        const context = fake.contexts[0];
        const token = await channel.play(await sound.load("line.wav"), { rate: 2 });
        context.currentTime = 1;

        token.seek(4);
        context.currentTime = 1.5;

        expect(token.getCurrentTime()).toBeCloseTo(5, 9);
    });

    it("pauses and resumes where a seek left the play head", async () => {
        const channel = sound.createChannel("voice");
        const context = fake.contexts[0];
        const token = await channel.play(await sound.load("line.wav"));
        context.currentTime = 0.5;

        token.seek(10);
        context.currentTime = 1.5;
        token.pause();

        expect(token.getCurrentTime()).toBeCloseTo(11, 9);
        token.resume();
        expect(context.bufferSources[2].starts).toEqual([{ when: 0, offset: expect.closeTo(11, 9) }]);
    });
});
