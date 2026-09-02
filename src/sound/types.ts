import type { SoundToken } from "./soundToken";
import type { Channel } from "./channel";

export interface SoundOptions {
    /**
     * The volume of the sound context.
     * @default 1
     * @range [0, 1]
     */
    volume?: number;
    /**
     * The latency hint of the sound context.
     * @default "interactive"
     * @enum ["balanced", "interactive", "playback"]
     */
    latencyHint?: "balanced" | "interactive" | "playback";
    /**
     * The sample rate of the sound context.
     * @default 44100
     * @range [1, Infinity]
     */
    sampleRate?: number;
    /**
     * The maximum number of channels that can be created. This includes the master channel and all the sub-channels.
     * If the maximum number of channels is reached, creating a new channel will throw an error.
     * @default 128
     * @range [1, Infinity]
     */
    maxChannels?: number;
    /**
     * Whether to silence non-critical warnings (such as best-effort disconnect/stop failures).
     * @default false
     */
    silent?: boolean;
    /**
     * How long a decoded clip stays in the cache once nothing holds it any more, in milliseconds.
     *
     * A clip is held while a caller keeps a reference to it (see {@link Sound.load} and
     * {@link CachedAudio.retain}) and while a token is playing it. When the last of those goes, the
     * decoded buffer is dropped after this delay. A short delay keeps a clip that is replayed in
     * quick succession from being fetched and decoded again each time; `0` drops it at once.
     * @default 0
     * @range [0, Infinity]
     */
    cacheReleaseDelay?: number;
}

export interface ChannelOptions {
    /**
     * The volume of the channel.
     * @default 1
     * @range [0, 1]
     */
    volume?: number;
    /**
     * The limit of the number of tokens that can play at the same time.
     * @default Infinity
     * @range [1, Infinity]
     */
    limit?: number;
}

export interface PlayOptions {
    /**
     * The volume of the token.
     * @default 1
     * @range [0, 1]
     */
    volume?: number;
    /**
     * The start time of the token. The token will start playing from the start time.
     * @default 0
     * @range [0, Infinity]
     */
    startTime?: number;
    /**
     * The end time of the token. When the token reaches the end time, it will be stopped automatically.
     * When the `loop` option is true, the token will loop back to the start time (or to
     * {@link PlayOptions.loopStart}) instead of stopping.
     *
     * A streamed source (`load: "stream"`) has no loop region: with `loop` it repeats the whole file
     * and the end time is ignored.
     * @default Infinity
     * @range (startTime, Infinity]
     */
    endTime?: number;
    /**
     * Where each repeat of a looping token returns to, in seconds.
     *
     * Only consulted together with `loop` and {@link PlayOptions.endTime}: the first pass starts at
     * `startTime`, every repeat after that starts here. Leaving it out makes each repeat return to
     * `startTime`, which is the behaviour of a clip that has no separate intro. A value outside
     * `[startTime, endTime)` describes no playable region and falls back to `startTime`.
     * @default startTime
     */
    loopStart?: number;
    /**
     * The rate of the token.
     * @default 1
     * @range (0, Infinity]
     */
    rate?: number;
    /**
     * Specify the loading mode.
     * @default "auto"
     * @enum ["stream", "full", "auto"]
     * - "stream": Use `<audio>` element to play the audio.
     * - "full": Load the entire audio file into memory.
     * - "auto": Automatically determine the loading mode based on the audio file's size. If it fails to determine the loading mode, it will use "stream" by default. For more details, please refer to [Behavior](https://github.com/NarraLeaf/Sound/blob/master/doc/behavior.md).
     */
    load?: "stream" | "full" | "auto";
    /**
     * Loop the token.
     * @default false
     */
    loop?: boolean;
}

export interface StopOptions {
    /**
     * The duration of the fade out. When specified, the token will fade out to 0 over the duration.
     * @default 0
     * @range [0, Infinity]
     */
    fadeDuration?: number;
}

export interface FadeToken {
    /**
     * Wait for the fade to complete.
     */
    finished: Promise<void>;
    /**
     * Cancel the fade.
     */
    cancel(): void;
    /**
     * Finish the fade immediately.
     */
    finish(): void;
    /**
     * Get the target volume of the fade.
     */
    getTargetVolume(): number;
}

/**
 * A decoded clip in the cache, and a reference to it.
 *
 * The clip stays decoded while any reference is held ({@link Sound.load} hands one out, and
 * {@link CachedAudio.retain} takes another) and while any token is playing it. Once the last
 * reference is released and the last token stops, the buffer is dropped and the entry leaves the
 * cache - after {@link SoundOptions.cacheReleaseDelay}, if one was set. A dropped clip is not
 * revived: {@link CachedAudio.isAlive} answers `false`, {@link CachedAudio.raw} throws, and loading
 * the same path again produces a new, independent handle.
 */
export interface CachedAudio {
    /**
     * Take one more reference to the clip. Pair it with a {@link CachedAudio.release}.
     */
    retain(): this;
    /**
     * Give back one reference. When none are left and no token is playing the clip, the decoded
     * buffer is dropped.
     */
    release(): void;
    /**
     * Drop every reference at once and release the clip as soon as no token is playing it.
     *
     * Resolves immediately either way: a clip that is still playing is released when the last
     * token playing it stops, not when this resolves.
     */
    unload(): Promise<void>;
    /**
     * Release the clip now, even if tokens are still playing it. Those tokens play on - a source
     * node holds its own reference to the buffer - but nothing new can be started from this handle.
     */
    forceUnload(): Promise<void>;
    /**
     * Check if the cached audio is still decoded.
     */
    isAlive(): boolean;
    /**
     * Get the raw audio buffer. Throws once the clip has been released.
     */
    raw(): AudioBuffer;
    /**
     * The number of references currently held on the clip.
     */
    getReferenceCount(): number;
    /**
     * The number of tokens currently playing the clip.
     */
    getPlayingCount(): number;
    /**
     * Increment the playing count. Called when a token starts using this audio.
     * @internal
     */
    addRef?(): void;
    /**
     * Decrement the playing count. Called when a token stops using this audio.
     * @internal
     */
    releaseRef?(): void;
}

/**
 * What the audio cache is holding right now.
 */
export interface CacheStats {
    /**
     * Clips currently decoded.
     */
    entries: number;
    /**
     * Clips currently being fetched or decoded.
     */
    loading: number;
    /**
     * Bytes of decoded PCM held by the entries: `length * numberOfChannels * 4` per clip, which is
     * what a `Float32Array` per channel costs.
     */
    decodedBytes: number;
}

/**
 * Interface for audio provider that manages audio context and token creation.
 * This allows for loose coupling between Channel and Sound classes.
 */
export interface IAudioProvider {
    /**
     * Get the audio context.
     */
    getAudioContext(): AudioContext;
    /**
     * Create a new sound token.
     */
    createToken(
        source: string | CachedAudio,
        options: PlayOptions | undefined,
        outputNode: GainNode
    ): Promise<SoundToken>;
    /**
     * Check if we can create more channels.
     */
    checkChannelLimit(): void;
    /**
     * Register a channel with the audio provider.
     */
    registerChannel(channel: Channel): void;
    /**
     * Unregister a channel from the audio provider.
     */
    unregisterChannel(channel: Channel): void;
}

/**
 * Interface for a channel that manages audio playback.
 */
export interface IChannel {
    getName(): string;
    play(source: string | CachedAudio, options?: PlayOptions): Promise<SoundToken>;
    createChannel(name: string, options?: ChannelOptions): IChannel;
    getChannel(name: string): IChannel | null;
    getChannels(): IChannel[];
    setVolume(volume: number): this;
    getVolume(): number;
    mute(): this;
    mute(muted: boolean): this;
    unmute(): this;
    isMuted(): boolean;
    remove(): this;
    getTokens(): SoundToken[];
}
