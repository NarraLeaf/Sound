import { Channel } from "./channel";
import { SoundToken } from "./soundToken";
import { CachedAudioImpl } from "./cachedAudioImpl";
import {
    SoundOptions,
    ChannelOptions,
    PlayOptions,
    CachedAudio,
    IAudioProvider
} from "./types";
import { setSilentLogging, warn } from "./logger";

/**
 * Threshold for auto load mode decision (10 MB in bytes).
 */
const AUTO_LOAD_THRESHOLD = 10 * 1024 * 1024;

/**
 * Audio cache manager for a Sound instance to avoid duplicate downloads and decoding.
 */
class AudioCache {
    private readonly cache = new Map<string, CachedAudio>();
    private readonly loadingPromises = new Map<string, Promise<CachedAudio>>();
    private readonly audioContext: AudioContext;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
    }

    async load(path: string): Promise<CachedAudio> {
        // Check if already cached
        const cached = this.cache.get(path);
        if (cached && cached.isAlive()) {
            return cached;
        }

        // Check if currently loading
        const loadingPromise = this.loadingPromises.get(path);
        if (loadingPromise) {
            return loadingPromise;
        }

        // Start loading
        const promise = this.doLoad(path);
        this.loadingPromises.set(path, promise);

        try {
            const result = await promise;
            this.cache.set(path, result);
            return result;
        } finally {
            this.loadingPromises.delete(path);
        }
    }

    private async doLoad(path: string): Promise<CachedAudio> {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        return new CachedAudioImpl(audioBuffer);
    }

    /**
     * Clear all cached audio data.
     */
    clear(): void {
        // Force unload all cached audio
        for (const cachedAudio of this.cache.values()) {
            cachedAudio.forceUnload();
        }
        this.cache.clear();
        this.loadingPromises.clear();
    }

    /**
     * Get cache statistics.
     */
    getStats(): { cached: number; loading: number } {
        return {
            cached: this.cache.size,
            loading: this.loadingPromises.size,
        };
    }
}

/**
 * Default options for Sound instances.
 */
const DEFAULT_SOUND_OPTIONS: Required<SoundOptions> = {
    volume: 1,
    latencyHint: "interactive",
    sampleRate: 44100,
    maxChannels: 128,
    silent: false,
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

        this.audioCache = new AudioCache(this.audioContext);

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
                // "full" mode - use cached audio buffer
                cachedAudioRef = await this.audioCache.load(source);
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

        // Create the token with custom output node
        const token = new SoundToken(this.audioContext, audioSource, {
            volume,
            rate,
            startTime,
            duration: endTime ? endTime - startTime : 0,
        }, outputNode);

        // Configure looping
        if (audioSource instanceof AudioBufferSourceNode) {
            audioSource.loop = loop;
            if (loop && endTime !== undefined) {
                audioSource.loopStart = startTime;
                audioSource.loopEnd = endTime;
            }
        } else if (audioSource instanceof HTMLAudioElement) {
            audioSource.loop = loop;
        }

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
     * Resolve the load mode based on the specified mode and file size.
     * For "auto" mode, sends a HEAD request to determine file size.
     * Files < 10MB use "full" mode, otherwise "stream" mode.
     */
    private async resolveLoadMode(
        path: string,
        mode: "stream" | "full" | "auto"
    ): Promise<"stream" | "full"> {
        if (mode === "stream" || mode === "full") {
            return mode;
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
     * Create a streaming audio source using HTMLAudioElement.
     */
    private createStreamSource(path: string): HTMLAudioElement {
        const audio = new Audio(path);
        audio.crossOrigin = "anonymous";
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

    // ==================== Sound Public API ====================

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
     * Load an audio file and cache it.
     * @param path - The path to the audio file.
     */
    public async load(path: string): Promise<CachedAudio> {
        this.ensureNotDestroyed();
        this.ensureReady();
        return this.audioCache.load(path);
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
