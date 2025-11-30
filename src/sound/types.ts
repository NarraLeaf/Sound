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
     * When the `loop` option is true, the token will loop back to the start time.
     * @default Infinity
     * @range (startTime, Infinity]
     */
    endTime?: number;
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
 * Represents a cached audio buffer that can be played multiple times.
 */
export interface CachedAudio {
    /**
     * Unload the cached audio. Will fail silently if tokens are still playing.
     */
    unload(): Promise<void>;
    /**
     * Force unload the cached audio, even if tokens are still playing.
     */
    forceUnload(): Promise<void>;
    /**
     * Check if the cached audio is still valid.
     */
    isAlive(): boolean;
    /**
     * Get the raw audio buffer.
     */
    raw(): AudioBuffer;
    /**
     * Increment the reference count. Called when a token starts using this audio.
     * @internal
     */
    addRef?(): void;
    /**
     * Decrement the reference count. Called when a token stops using this audio.
     * @internal
     */
    releaseRef?(): void;
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

