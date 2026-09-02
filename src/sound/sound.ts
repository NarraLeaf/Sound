import { Channel } from "./channel";
import { SoundToken } from "./soundToken";
import { AudioCache } from "./audioCache";
import {
    SoundOptions,
    ChannelOptions,
    PlayOptions,
    CachedAudio,
    CacheStats,
    IAudioProvider
} from "./types";
import { setSilentLogging, warn } from "./logger";

/**
 * Threshold for auto load mode decision (10 MB in bytes).
 */
const AUTO_LOAD_THRESHOLD = 10 * 1024 * 1024;

/**
 * Default options for Sound instances.
 */
const DEFAULT_SOUND_OPTIONS: Required<SoundOptions> = {
    volume: 1,
    latencyHint: "interactive",
    sampleRate: 44100,
    maxChannels: 128,
    silent: false,
    cacheReleaseDelay: 0,
};

/**
 * Sound is the main class that manages the audio context, channels, and audio playback.
 * It uses a master channel internally to manage volume and sub-channels.
 */
export class Sound implements IAudioProvider {
    private readonly audioContext: AudioContext;
    private readonly options: Required<SoundOptions>;
    private readonly masterChannel: Channel;
    private readonly registeredChannels: Set<Channel> = new Set();
    private readonly audioCache: AudioCache;

    private isReady: boolean = false;
    private readyPromise: Promise<void> | null = null;
    private destroyed: boolean = false;
    private unlockHandler: (() => void) | null = null;

    constructor(options?: Partial<SoundOptions>) {
        this.options = { ...DEFAULT_SOUND_OPTIONS, ...options };

        // Configure global logging behavior
        setSilentLogging(!!this.options.silent);

        this.audioContext = new AudioContext({
            latencyHint: this.options.latencyHint,
            sampleRate: this.options.sampleRate,
        });

        this.audioCache = new AudioCache(this.audioContext, this.options.cacheReleaseDelay);

        // Create master channel (it doesn't count towards channel limit)
        this.masterChannel = new Channel("__master__", this, { volume: this.options.volume }, null);

        this.initialize();
    }

    /**
     * Wait for the audio context to be ready.
     */
    public async onceReady(): Promise<this> {
        if (!this.readyPromise) {
            return this;
        }
        await this.readyPromise;
        return this;
    }

    /**
     * Initialize the audio context and wait for user interaction if needed.
     */
    private initialize(): void {
        if (this.isReady) {
            return;
        }
        this.readyPromise = this.waitForUnlock();
    }

    /**
     * Wait for user interaction to unlock the audio context.
     */
    private waitForUnlock(): Promise<void> {
        if (typeof document === "undefined") {
            // In non-browser environments, assume ready immediately
            this.isReady = true;
            return Promise.resolve();
        }

        if (this.audioContext.state === "running") {
            this.isReady = true;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const unlock = () => {
                // If already destroyed, do not attempt to resume
                if (this.destroyed) {
                    this.clearUnlockHandler();
                    resolve();
                    return;
                }

                this.audioContext.resume().then(() => {
                    if (this.audioContext.state === "running") {
                        this.clearUnlockHandler();
                        this.isReady = true;
                        resolve();
                    }
                }).catch((error) => {
                    warn("Failed to resume AudioContext while unlocking.", error);
                });
            };

            this.unlockHandler = unlock;

            document.addEventListener("click", unlock);
            document.addEventListener("touchstart", unlock);
            document.addEventListener("keydown", unlock);
        });
    }

    /**
     * Clear unlock event listeners if they have been registered.
     */
    private clearUnlockHandler(): void {
        if (!this.unlockHandler || typeof document === "undefined") return;

        const handler = this.unlockHandler;
        this.unlockHandler = null;

        document.removeEventListener("click", handler);
        document.removeEventListener("touchstart", handler);
        document.removeEventListener("keydown", handler);
    }

    /**
     * Ensure the sound instance is not destroyed.
     */
    private ensureNotDestroyed(): void {
        if (this.destroyed) {
            throw new Error("Sound instance has been destroyed and cannot be used.");
        }
    }

    /**
     * Ensure the audio context is ready (unlocked).
     * Throws if not yet ready.
     */
    private ensureReady(): void {
        if (!this.isReady) {
            throw new Error("Audio context is not ready. Call onceReady() and wait for it to resolve before creating channels or playing audio.");
        }
    }

    /**
     * Get the audio context.
     */
    public getAudioContext(): AudioContext {
        return this.audioContext;
    }

    /**
     * Create a new sound token for playback.
     */
    public async createToken(
        source: string | CachedAudio,
        options: PlayOptions | undefined,
        outputNode: GainNode
    ): Promise<SoundToken> {
        this.ensureNotDestroyed();
        this.ensureReady();

        const {
            volume = 1,
            rate = 1,
            startTime = 0,
            endTime,
            loopStart,
            load = "auto",
            loop = false,
        } = options ?? {};

        // Load the audio source
        let audioSource: AudioBufferSourceNode | HTMLAudioElement;

        let cachedAudioRef: CachedAudio | null = null;

        if (typeof source === "string") {
            const loadMode = await this.resolveLoadMode(source, load);

            if (loadMode === "stream") {
                audioSource = this.createStreamSource(source);
            } else {
                // "full" mode. No reference is taken for the caller: the token's playing count is
                // what holds the clip, so a play-by-path leaves nothing behind once it stops.
                cachedAudioRef = await this.audioCache.acquire(source);
                cachedAudioRef.addRef?.();
                const bufferSource = this.audioContext.createBufferSource();
                bufferSource.buffer = cachedAudioRef.raw();
                audioSource = bufferSource;
            }
        } else {
            // CachedAudio - create buffer source from cached data
            cachedAudioRef = source;
            cachedAudioRef.addRef?.();
            const bufferSource = this.audioContext.createBufferSource();
            bufferSource.buffer = source.raw();
            audioSource = bufferSource;
        }

        // Configure looping before the token starts the source, so the first pass already knows
        // where it repeats. A buffer source can repeat a region; an element can only repeat the
        // whole file, so for a streamed source the end time has nothing to say.
        const region = loop && endTime !== undefined && endTime > startTime
            ? { start: Sound.clampLoopStart(loopStart, startTime, endTime), end: endTime }
            : null;
        if (audioSource instanceof AudioBufferSourceNode) {
            audioSource.loop = loop;
            if (region) {
                audioSource.loopStart = region.start;
                audioSource.loopEnd = region.end;
            }
        } else if (audioSource instanceof HTMLAudioElement) {
            audioSource.loop = loop;
        }

        // Create the token with custom output node. A looping token has no out point for the stop
        // timer to enforce - the loop region (or the whole file) is what repeats - so the timer is
        // only armed for a one-shot; arming it regardless used to cut a looping token off after its
        // first pass.
        const token = new SoundToken(this.audioContext, audioSource, {
            volume,
            rate,
            startOffset: startTime,
            duration: !loop && endTime ? endTime - startTime : 0,
        }, outputNode);

        // Release cached audio reference when token ends (only once)
        if (cachedAudioRef) {
            let refReleased = false;
            const releaseRef = () => {
                if (!refReleased) {
                    refReleased = true;
                    cachedAudioRef!.releaseRef?.();
                }
            };
            token.once("ended", releaseRef);
            token.once("stop", releaseRef);
        }

        return token;
    }

    /**
     * Where a looping region repeats from: the requested loop start when it lies inside the region,
     * else the region's own start. An in point at or past the out point would describe a zero-length
     * or inverted loop - silence forever - so it is not honoured.
     */
    private static clampLoopStart(requested: number | undefined, startTime: number, endTime: number): number {
        if (requested === undefined || !Number.isFinite(requested)) {
            return startTime;
        }
        return requested >= startTime && requested < endTime ? requested : startTime;
    }

    /**
     * Resolve the load mode based on the specified mode and file size.
     *
     * For "auto" mode over http(s), a HEAD request decides: files under 10MB use "full" mode, the
     * rest stream. Nothing but http(s) is asked: a `data:` or `blob:` URL is already in memory, so
     * there is nothing to stream and decoding is the only cost; and a custom scheme - an
     * application's own protocol, `file:` - cannot be counted on to answer a HEAD at all, or may
     * answer it by serving the whole file. Those take the documented fallback, "stream", without
     * a request.
     */
    private async resolveLoadMode(
        path: string,
        mode: "stream" | "full" | "auto"
    ): Promise<"stream" | "full"> {
        if (mode === "stream" || mode === "full") {
            return mode;
        }

        const scheme = Sound.schemeOf(path);
        if (scheme === "data:" || scheme === "blob:") {
            return "full";
        }
        if (scheme !== null && scheme !== "http:" && scheme !== "https:") {
            return "stream";
        }

        // "auto" mode - determine based on file size
        try {
            const response = await fetch(path, { method: "HEAD" });
            if (!response.ok) {
                // Fallback to stream if HEAD request fails
                return "stream";
            }

            const contentLength = response.headers.get("Content-Length");
            if (!contentLength) {
                // No content length header, fallback to stream
                return "stream";
            }

            const size = parseInt(contentLength, 10);
            if (isNaN(size)) {
                return "stream";
            }

            // < 10MB use full mode, otherwise stream
            return size < AUTO_LOAD_THRESHOLD ? "full" : "stream";
        } catch (error) {
            // Network error or other issues, fallback to stream
            warn("Failed to resolve load mode via HEAD request, falling back to 'stream'.", error);
            return "stream";
        }
    }

    /**
     * The scheme a path resolves to, against the page when there is one. `null` when it cannot be
     * told - a relative path with no page to resolve it against - in which case it is treated as
     * ordinary http.
     */
    private static schemeOf(path: string): string | null {
        try {
            const base = typeof location !== "undefined" && location?.href ? location.href : undefined;
            return new URL(path, base).protocol;
        } catch {
            return null;
        }
    }

    /**
     * Create a streaming audio source using HTMLAudioElement.
     */
    private createStreamSource(path: string): HTMLAudioElement {
        const audio = new Audio(path);
        audio.crossOrigin = "anonymous";
        // A media element corrects pitch when its rate changes and a buffer source does not; the
        // two are the same clip to a caller, so the element is asked to behave like the buffer.
        if ("preservesPitch" in audio) {
            (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = false;
        }
        return audio;
    }

    /**
     * Check if we can create more channels.
     * Note: maxChannels includes the master channel, so we add 1 to the registered count.
     */
    public checkChannelLimit(): void {
        if (this.registeredChannels.size + 1 >= this.options.maxChannels) {
            throw new Error(
                `Maximum number of channels (${this.options.maxChannels}) reached.`
            );
        }
    }

    /**
     * Register a channel with the sound instance.
     */
    public registerChannel(channel: Channel): void {
        this.registeredChannels.add(channel);
    }

    /**
     * Unregister a channel from the sound instance.
     */
    public unregisterChannel(channel: Channel): void {
        this.registeredChannels.delete(channel);
    }

    /**
     * Set the master volume of all audio.
     * @param volume - The volume value between 0 and 1.
     */
    public setVolume(volume: number): this {
        this.ensureNotDestroyed();
        this.ensureReady();
        this.masterChannel.setVolume(volume);
        return this;
    }

    /**
     * Get the master volume.
     */
    public getVolume(): number {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.masterChannel.getVolume();
    }

    /**
     * Mute all audio.
     */
    public mute(): this;
    public mute(muted: boolean): this;
    public mute(muted?: boolean): this {
        this.ensureNotDestroyed();
        this.ensureReady();
        if (muted === undefined) {
            this.masterChannel.mute();
        } else {
            this.masterChannel.mute(muted);
        }
        return this;
    }

    /**
     * Unmute all audio.
     */
    public unmute(): this {
        this.ensureNotDestroyed();
        this.ensureReady();
        this.masterChannel.unmute();
        return this;
    }

    /**
     * Check if audio is muted.
     */
    public isMuted(): boolean {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.masterChannel.isMuted();
    }

    /**
     * Create a new channel.
     * @param name - The name of the channel.
     * @param options - Optional channel options.
     */
    public createChannel(name: string, options?: ChannelOptions): Channel {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.masterChannel.createChannel(name, options);
    }

    /**
     * Get a channel by name.
     * @param name - The name of the channel.
     */
    public getChannel(name: string): Channel | null {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.masterChannel.getChannel(name);
    }

    /**
     * Get all direct child channels of the master channel.
     */
    public getChannels(): Channel[] {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.masterChannel.getChannels();
    }

    /**
     * Load an audio file into the cache and take a reference to it.
     *
     * The clip stays decoded for as long as the reference is held; give it back with
     * {@link CachedAudio.release} (or {@link Sound.release}) when it is no longer needed, and it is
     * dropped once nothing else holds it and no token is playing it. Loading a path that is already
     * cached does not fetch or decode again; it hands out one more reference to the same clip.
     * @param path - The path to the audio file.
     */
    public async load(path: string): Promise<CachedAudio> {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.audioCache.load(path);
    }

    /**
     * Give back one reference on the clip cached under `path` - the counterpart of one
     * {@link Sound.load}. Returns `false` when nothing is cached under it.
     * @param path - The path the clip was loaded from.
     */
    public release(path: string): boolean {
        this.ensureNotDestroyed();
        return this.audioCache.release(path);
    }

    /**
     * Drop every reference on the clip cached under `path` and release it as soon as no token is
     * playing it. Returns `false` when nothing is cached under it.
     * @param path - The path the clip was loaded from.
     */
    public async unload(path: string): Promise<boolean> {
        this.ensureNotDestroyed();
        return this.audioCache.unload(path);
    }

    /**
     * The clip cached under `path`, or `null` when it is not decoded right now. Does not take a
     * reference.
     * @param path - The path the clip was loaded from.
     */
    public getCached(path: string): CachedAudio | null {
        this.ensureNotDestroyed();
        return this.audioCache.get(path);
    }

    /**
     * What the audio cache is holding: decoded clips, clips in flight, and the bytes of PCM the
     * decoded ones occupy.
     */
    public getCacheStats(): CacheStats {
        return this.audioCache.getStats();
    }

    /**
     * Play audio directly without using a channel.
     * The volume will only be affected by the master volume.
     * @param source - The path to the audio file or a CachedAudio instance.
     * @param options - Optional play options.
     */
    public async play(source: string | CachedAudio, options?: PlayOptions): Promise<SoundToken> {
        this.ensureNotDestroyed();
        this.ensureReady();

        // Stop and dispose all currently playing tokens to avoid reuse of old instances
        const existingTokens = this.masterChannel.getTokens();
        for (const token of existingTokens) {
            try {
                token.stop();
            } catch (error) {
                // Best-effort stop; continue creating new token
            }
        }

        return this.masterChannel.play(source, options);
    }

    /**
     * Get all currently playing tokens.
     */
    public getTokens(): SoundToken[] {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.masterChannel.getTokens();
    }

    /**
     * Destroy the sound instance and release all resources.
     */
    public destroy(): void {
        if (this.destroyed) return;

        // Mark as destroyed first to prevent concurrent operations
        this.destroyed = true;

        // Clear unlock handler and related event listeners if any
        this.clearUnlockHandler();

        // Clear the audio cache to free memory
        this.audioCache.clear();

        // Remove master channel (which will remove all sub-channels and stop all tokens)
        this.masterChannel.remove();
        this.registeredChannels.clear();

        // Close the audio context
        this.audioContext.close().catch((error) => {
            warn("Failed to close AudioContext during destroy().", error);
        });
    }

    /**
     * Check if the sound instance has been destroyed.
     */
    public isDestroyed(): boolean {
        return this.destroyed;
    }
}
