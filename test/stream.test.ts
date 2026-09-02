import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sound } from "../src/index";
import { FakeWebAudio, installWebAudioFake } from "./webAudioFake";

/**
 * A token played through an `<audio>` element rather than a decoded buffer.
 *
 * The stream path existed before 0.2.0 but nothing exercised it: the only consumer always played
 * decoded clips. These pin that an explicit `load: "stream"` never fetches, that the element is
 * wired into the token's gain (so channels, fades and mutes reach it), and that every control on
 * the token does what it does for a buffer.
 */
describe("a streamed token", () => {
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

    it("plays an explicit stream through an element, with no request of its own", async () => {
        const channel = sound.createChannel("bgm");

        const token = await channel.play("app://assets/theme.mp3", { load: "stream", volume: 0.5 });

        expect(fake.requests).toEqual([]);
        expect(fake.elements).toHaveLength(1);
        const element = fake.elements[0];
        expect(element.src).toBe("app://assets/theme.mp3");
        expect(element.playCalls).toBe(1);
        expect(element.preservesPitch).toBe(false);
        // Element -> media source -> token gain -> channel gain: the channel's volume reaches it.
        const context = fake.contexts[0];
        expect(context.mediaSources[0].mediaElement).toBe(element);
        const tokenGain = context.mediaSources[0].connections[0];
        expect(tokenGain).toBe(context.gains[context.gains.length - 1]);
        expect(tokenGain.connections[0]).toBe(channel.getGainNode());
        expect(token.getVolume()).toBe(0.5);
        expect(sound.getCacheStats().entries).toBe(0);
    });

    it("starts from the requested offset, at the requested rate, looping when asked", async () => {
        const channel = sound.createChannel("bgm");

        await channel.play("theme.mp3", { load: "stream", startTime: 12, rate: 1.25, loop: true });

        const element = fake.elements[0];
        expect(element.playedFrom).toEqual([12]);
        expect(element.playbackRate).toBe(1.25);
        expect(element.loop).toBe(true);
    });

    it("does not arm a stop timer for a looping stream, whatever end time was given", async () => {
        vi.useFakeTimers();
        try {
            const channel = sound.createChannel("bgm");
            const token = await channel.play("theme.mp3", { load: "stream", loop: true, endTime: 30 });

            vi.advanceTimersByTime(60_000);

            expect(token.isPlaying()).toBe(true);
            expect(fake.elements[0].paused).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("stops a one-shot stream at its end time", async () => {
        vi.useFakeTimers();
        try {
            const channel = sound.createChannel("sfx");
            const token = await channel.play("line.mp3", { load: "stream", startTime: 1, endTime: 4 });

            vi.advanceTimersByTime(3000);

            expect(token.isPlaying()).toBe(false);
            expect(fake.elements[0].paused).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("pauses, resumes and seeks through the element's play head", async () => {
        const channel = sound.createChannel("bgm");
        const token = await channel.play("theme.mp3", { load: "stream" });
        const element = fake.elements[0];
        const events: string[] = [];
        token.on("pause", () => events.push("pause"));
        token.on("resume", () => events.push("resume"));
        token.on("seek", () => events.push("seek"));

        element.currentTime = 7.5;
        token.pause();
        expect(element.paused).toBe(true);
        expect(token.isPaused()).toBe(true);
        expect(token.getCurrentTime()).toBe(7.5);

        token.seek(20);
        expect(element.currentTime).toBe(20);

        token.resume();
        expect(element.paused).toBe(false);
        expect(token.isPlaying()).toBe(true);
        expect(element.playedFrom).toEqual([0, 20]);
        expect(events).toEqual(["pause", "seek", "resume"]);
    });

    it("changes rate on the element and reports the element's duration", async () => {
        const channel = sound.createChannel("bgm");
        const token = await channel.play("theme.mp3", { load: "stream" });
        const element = fake.elements[0];

        token.setRate(0.5);
        expect(element.playbackRate).toBe(0.5);
        expect(token.getRate()).toBe(0.5);

        element.duration = 245;
        expect(token.getDuration()).toBe(245);
    });

    it("fades and mutes through the token gain like any other token", async () => {
        const channel = sound.createChannel("bgm");
        const token = await channel.play("theme.mp3", { load: "stream", volume: 0 });
        const context = fake.contexts[0];
        const gain = context.gains[context.gains.length - 1].gain;

        const fade = token.fade(0, 1, 1000);
        expect(gain.ramps).toEqual([{ from: 0, to: 1, endTime: 1 }]);
        fade.finish();
        expect(token.getVolume()).toBe(1);

        token.mute();
        expect(gain.value).toBe(0);
        token.unmute();
        expect(gain.value).toBe(1);
    });

    it("reports the end of the file and lets the channel forget the token", async () => {
        const channel = sound.createChannel("sfx");
        const token = await channel.play("line.mp3", { load: "stream" });
        const ended = vi.fn();
        token.once("ended", ended);

        fake.elements[0].end();

        expect(ended).toHaveBeenCalledTimes(1);
        expect(token.isPlaying()).toBe(false);
        expect(channel.getTokens()).toEqual([]);
    });

    it("releases the element's media on stop", async () => {
        const channel = sound.createChannel("bgm");
        const token = await channel.play("theme.mp3", { load: "stream" });
        const element = fake.elements[0];
        const stopped = vi.fn();
        token.once("stop", stopped);

        token.stop();

        expect(stopped).toHaveBeenCalledTimes(1);
        expect(element.paused).toBe(true);
        expect(element.src).toBe("");
        expect(element.loadCalls).toBe(1);
        expect(channel.getTokens()).toEqual([]);
    });

    it("stops with a fade-out before releasing the element", async () => {
        vi.useFakeTimers();
        try {
            const channel = sound.createChannel("bgm");
            const token = await channel.play("theme.mp3", { load: "stream", volume: 1 });
            const element = fake.elements[0];

            token.stop({ fadeDuration: 300 });
            expect(element.paused).toBe(false);

            await vi.advanceTimersByTimeAsync(300);
            expect(element.paused).toBe(true);
            expect(token.isPlaying()).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps a rejected play() from surfacing as an unhandled rejection", async () => {
        const channel = sound.createChannel("bgm");
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            // Every element the fake produces from here on refuses to play.
            const originalPlay = fake.elements.length;
            const token = await channel.play("theme.mp3", { load: "stream" });
            expect(fake.elements.length).toBe(originalPlay + 1);
            fake.elements[0].playRejection = new Error("NotAllowedError");
            token.pause();
            token.resume();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });
});

describe("the auto load mode", () => {
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

    it("asks an http server for the size and decodes a small file", async () => {
        fake.sizes.set("https://cdn.example/hit.wav", 200_000);
        const channel = sound.createChannel("sfx");

        await channel.play("https://cdn.example/hit.wav");

        expect(fake.requests.map(request => request.method)).toEqual(["HEAD", "GET"]);
        expect(fake.elements).toHaveLength(0);
        expect(sound.getCacheStats().entries).toBe(1);
    });

    it("streams a large http file", async () => {
        fake.sizes.set("https://cdn.example/theme.mp3", 12 * 1024 * 1024);
        const channel = sound.createChannel("bgm");

        await channel.play("https://cdn.example/theme.mp3");

        expect(fake.requests.map(request => request.method)).toEqual(["HEAD"]);
        expect(fake.elements).toHaveLength(1);
    });

    it("streams when the server refuses HEAD", async () => {
        fake.headRefused.add("https://cdn.example/theme.mp3");
        const channel = sound.createChannel("bgm");

        await channel.play("https://cdn.example/theme.mp3");

        expect(fake.elements).toHaveLength(1);
    });

    it("never sends HEAD to a custom scheme, and streams", async () => {
        const channel = sound.createChannel("bgm");

        await channel.play("app://assets/theme.mp3");
        await channel.play("nlgame://asset/abc123?v=1");

        expect(fake.requests).toEqual([]);
        expect(fake.elements).toHaveLength(2);
    });

    it("decodes a data: URL without asking anything", async () => {
        const channel = sound.createChannel("sfx");
        const url = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgA";

        await channel.play(url);

        expect(fake.requests.map(request => request.method)).toEqual(["GET"]);
        expect(fake.elements).toHaveLength(0);
        expect(sound.getCacheStats().entries).toBe(1);
    });
});
