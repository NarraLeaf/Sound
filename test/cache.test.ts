import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sound } from "../src/index";
import { FakeWebAudio, installWebAudioFake, settle } from "./webAudioFake";

/**
 * What keeps a decoded clip in memory, and what lets it go.
 *
 * Before 0.2.0 the cache was a map with no way out: every clip a `Sound` ever decoded stayed
 * decoded until `destroy()`, and `unload()` only flipped a flag while the buffer stayed reachable
 * from the entry. These pin the two counts that replace that - references held by callers, tokens
 * playing the clip - and the moment the buffer actually goes.
 */
describe("the audio cache", () => {
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

    it("decodes a path once however many times it is loaded, and counts each load as a reference", async () => {
        fake.sizes.set("theme.mp3", 4000);

        const first = await sound.load("theme.mp3");
        const second = await sound.load("theme.mp3");

        expect(second).toBe(first);
        expect(fake.contexts[0].decodeCalls).toBe(1);
        expect(first.getReferenceCount()).toBe(2);
        // One frame per byte, stereo, four bytes per sample.
        expect(sound.getCacheStats()).toEqual({ entries: 1, loading: 0, decodedBytes: 4000 * 2 * 4 });
    });

    it("drops the buffer and the entry when the last reference is released", async () => {
        const clip = await sound.load("theme.mp3");
        await sound.load("theme.mp3");

        clip.release();
        expect(clip.isAlive()).toBe(true);
        expect(sound.getCacheStats().entries).toBe(1);

        clip.release();
        expect(clip.isAlive()).toBe(false);
        expect(() => clip.raw()).toThrow(/unloaded/);
        expect(sound.getCached("theme.mp3")).toBeNull();
        expect(sound.getCacheStats()).toEqual({ entries: 0, loading: 0, decodedBytes: 0 });
    });

    it("decodes again after a drop and hands out a new handle", async () => {
        const first = await sound.load("theme.mp3");
        first.release();

        const second = await sound.load("theme.mp3");

        expect(second).not.toBe(first);
        expect(second.isAlive()).toBe(true);
        expect(first.isAlive()).toBe(false);
        expect(fake.contexts[0].decodeCalls).toBe(2);
    });

    it("keeps a released clip while a token is still playing it, and drops it when the token stops", async () => {
        const channel = sound.createChannel("sfx");
        const clip = await sound.load("hit.wav");
        const token = await channel.play(clip);

        clip.release();

        // Nothing holds a reference, but the token does hold the buffer.
        expect(clip.getReferenceCount()).toBe(0);
        expect(clip.getPlayingCount()).toBe(1);
        expect(clip.isAlive()).toBe(true);

        token.stop();
        expect(clip.isAlive()).toBe(false);
        expect(sound.getCacheStats().entries).toBe(0);
    });

    it("releases on the natural end of the clip as well as on stop", async () => {
        const channel = sound.createChannel("sfx");
        const clip = await sound.load("hit.wav");
        await channel.play(clip);
        clip.release();

        fake.contexts[0].bufferSources[0].end();

        expect(clip.isAlive()).toBe(false);
    });

    it("keeps a clip the caller still references after every token playing it has stopped", async () => {
        const channel = sound.createChannel("sfx");
        const clip = await sound.load("hit.wav");
        const token = await channel.play(clip);

        token.stop();

        expect(clip.isAlive()).toBe(true);
        expect(clip.getPlayingCount()).toBe(0);
        expect(clip.getReferenceCount()).toBe(1);
    });

    it("gives a play-by-path no reference of its own, so the clip goes when the token does", async () => {
        const channel = sound.createChannel("sfx");
        const token = await channel.play("hit.wav", { load: "full" });

        expect(sound.getCacheStats().entries).toBe(1);
        const clip = sound.getCached("hit.wav")!;
        expect(clip.getReferenceCount()).toBe(0);
        expect(clip.getPlayingCount()).toBe(1);

        token.stop();

        expect(sound.getCacheStats().entries).toBe(0);
    });

    it("lets unload() drop every reference at once, deferred until the clip stops playing", async () => {
        const channel = sound.createChannel("sfx");
        const clip = await sound.load("hit.wav");
        clip.retain();
        const token = await channel.play(clip);

        await clip.unload();

        // Resolved at once, but the buffer stays until the token is done with it.
        expect(clip.getReferenceCount()).toBe(0);
        expect(clip.isAlive()).toBe(true);

        token.stop();
        expect(clip.isAlive()).toBe(false);
    });

    it("lets forceUnload() drop the buffer under a playing token", async () => {
        const channel = sound.createChannel("sfx");
        const clip = await sound.load("hit.wav");
        const token = await channel.play(clip);

        await clip.forceUnload();

        expect(clip.isAlive()).toBe(false);
        expect(sound.getCacheStats().entries).toBe(0);
        // The token keeps its own reference to the buffer through the source node.
        expect(token.isPlaying()).toBe(true);
        expect(fake.contexts[0].bufferSources[0].buffer).not.toBeNull();
    });

    it("releases and unloads by path through the Sound instance", async () => {
        const clip = await sound.load("theme.mp3");

        expect(sound.release("theme.mp3")).toBe(true);
        expect(clip.isAlive()).toBe(false);
        expect(sound.release("theme.mp3")).toBe(false);

        await sound.load("theme.mp3");
        expect(await sound.unload("theme.mp3")).toBe(true);
        expect(sound.getCacheStats().entries).toBe(0);
        expect(await sound.unload("theme.mp3")).toBe(false);
    });

    it("counts a load taken while the clip is still decoding", async () => {
        const first = sound.load("theme.mp3");
        const second = sound.load("theme.mp3");
        const [a, b] = await Promise.all([first, second]);

        expect(a).toBe(b);
        expect(a.getReferenceCount()).toBe(2);
        expect(fake.contexts[0].decodeCalls).toBe(1);
    });

    it("counts loads and decoding in the stats while a clip is in flight", async () => {
        const pending = sound.load("theme.mp3");
        expect(sound.getCacheStats()).toEqual({ entries: 0, loading: 1, decodedBytes: 0 });
        await pending;
        expect(sound.getCacheStats().loading).toBe(0);
    });

    it("drops every clip on destroy, whatever holds it", async () => {
        const channel = sound.createChannel("sfx");
        const clip = await sound.load("hit.wav");
        clip.retain();
        await channel.play(clip);

        sound.destroy();

        expect(clip.isAlive()).toBe(false);
        expect(sound.getCacheStats()).toEqual({ entries: 0, loading: 0, decodedBytes: 0 });
    });
});

describe("the cache release delay", () => {
    let fake: FakeWebAudio;
    let sound: Sound;

    beforeEach(async () => {
        vi.useFakeTimers();
        fake = installWebAudioFake();
        sound = await new Sound({ silent: true, cacheReleaseDelay: 500 }).onceReady();
    });

    afterEach(() => {
        sound.destroy();
        fake.restore();
        vi.useRealTimers();
    });

    it("keeps a clip for the delay after it is let go, so a quick replay does not decode again", async () => {
        const channel = sound.createChannel("sfx");
        const token = await channel.play("hit.wav", { load: "full" });
        token.stop();

        // Let go, but not gone yet.
        expect(sound.getCacheStats().entries).toBe(1);

        vi.advanceTimersByTime(499);
        const replay = channel.play("hit.wav", { load: "full" });
        await vi.advanceTimersByTimeAsync(0);
        await replay;
        expect(fake.contexts[0].decodeCalls).toBe(1);

        // A replay cancels the pending drop; the clip is held by the new token again.
        vi.advanceTimersByTime(1000);
        expect(sound.getCacheStats().entries).toBe(1);
    });

    it("drops the clip once the delay runs out with nothing holding it", async () => {
        const channel = sound.createChannel("sfx");
        const token = await channel.play("hit.wav", { load: "full" });
        token.stop();

        vi.advanceTimersByTime(500);

        expect(sound.getCacheStats().entries).toBe(0);
    });

    it("does not make unload() wait for the delay", async () => {
        const clip = await sound.load("hit.wav");

        await clip.unload();

        expect(clip.isAlive()).toBe(false);
    });

    it("does not make destroy() wait for the delay", async () => {
        const clip = await sound.load("hit.wav");
        clip.release();

        sound.destroy();

        expect(clip.isAlive()).toBe(false);
    });
});

describe("a load that outlives its Sound", () => {
    it("hands back a dead handle instead of resurrecting the cleared cache", async () => {
        const fake = installWebAudioFake();
        const sound = await new Sound({ silent: true }).onceReady();
        const pending = sound.load("theme.mp3");

        sound.destroy();
        const clip = await pending;
        await settle();

        expect(clip.isAlive()).toBe(false);
        expect(sound.getCacheStats().entries).toBe(0);
        fake.restore();
    });
});
