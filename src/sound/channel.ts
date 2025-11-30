import { SoundToken } from "./soundToken";
import { ChannelOptions, PlayOptions, CachedAudio, IChannel, IAudioProvider } from "./types";

/**
 * Default options for Channel instances.
 */
const DEFAULT_CHANNEL_OPTIONS: Required<ChannelOptions> = {
    volume: 1,
    limit: Infinity,
};

/**
 * Channel manages a group of audio sources and sub-channels.
 * Channels can be nested to create a tree structure with cascading volume control.
 */
export class Channel implements IChannel {
    private readonly name: string;
    private readonly options: Required<ChannelOptions>;
    private readonly subChannels: Map<string, Channel> = new Map();
    private readonly tokens: Set<SoundToken> = new Set();
    private readonly audioProvider: IAudioProvider;
    private readonly parentChannel: Channel | null;
    
    private volume: number;
    private muted: boolean = false;
    private removed: boolean = false;
    private gainNode: GainNode;

    constructor(
        name: string,
        audioProvider: IAudioProvider,
        options?: ChannelOptions,
        parentChannel?: Channel | null
    ) {
        this.name = name;
        this.audioProvider = audioProvider;
        this.parentChannel = parentChannel ?? null;
        this.options = { ...DEFAULT_CHANNEL_OPTIONS, ...options };
        this.volume = this.options.volume;

        // Create gain node for this channel
        const audioContext = this.audioProvider.getAudioContext();
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = this.muted ? 0 : this.volume;

        // Connect to parent's gain node or destination
        this.connectToParent();
    }

    /**
     * Connect this channel's gain node to the parent's output.
     */
    private connectToParent(): void {
        if (this.parentChannel) {
            this.gainNode.connect(this.parentChannel.getGainNode());
        } else {
            // Root channel connects directly to destination
            this.gainNode.connect(this.audioProvider.getAudioContext().destination);
        }
    }

    /**
     * Get the gain node for this channel.
     * Used by child channels and tokens to connect to this channel.
     */
    public getGainNode(): GainNode {
        return this.gainNode;
    }

    /**
     * Ensure the channel is not removed before performing operations.
     */
    private ensureNotRemoved(): void {
        if (this.removed) {
            throw new Error(`Channel "${this.name}" has been removed and cannot be used.`);
        }
    }

    /**
     * Get the name of this channel.
     */
    public getName(): string {
        return this.name;
    }

    /**
     * Play a sound through this channel.
     * @param source - The path to the audio file or a CachedAudio instance.
     * @param options - Optional play options.
     */
    public async play(source: string | CachedAudio, options?: PlayOptions): Promise<SoundToken> {
        this.ensureNotRemoved();

        // Check if we've reached the token limit
        if (this.tokens.size >= this.options.limit) {
            const oldestToken = this.tokens.values().next().value;
            if (oldestToken) {
                oldestToken.stop();
            }
        }

        const token = await this.audioProvider.createToken(source, options, this.gainNode);
        this.tokens.add(token);

        // Listen for token end to clean up
        token.once("ended", () => this.tokens.delete(token));
        token.once("stop", () => this.tokens.delete(token));

        return token;
    }

    /**
     * Create a sub-channel under this channel.
     * @param name - The name of the sub-channel.
     * @param options - Optional channel options.
     */
    public createChannel(name: string, options?: ChannelOptions): Channel {
        this.ensureNotRemoved();

        if (this.subChannels.has(name)) {
            throw new Error(`Channel "${name}" already exists under "${this.name}".`);
        }

        // Check max channels limit through audio provider
        this.audioProvider.checkChannelLimit();

        const subChannel = new Channel(name, this.audioProvider, options, this);
        this.subChannels.set(name, subChannel);
        this.audioProvider.registerChannel(subChannel);

        return subChannel;
    }

    /**
     * Get a sub-channel by name.
     * @param name - The name of the sub-channel.
     */
    public getChannel(name: string): Channel | null {
        this.ensureNotRemoved();
        return this.subChannels.get(name) ?? null;
    }

    /**
     * Get all direct sub-channels of this channel.
     */
    public getChannels(): Channel[] {
        this.ensureNotRemoved();
        return Array.from(this.subChannels.values());
    }

    /**
     * Set the volume of this channel.
     * @param volume - The volume value between 0 and 1.
     */
    public setVolume(volume: number): this {
        this.ensureNotRemoved();
        this.volume = Math.max(0, Math.min(1, volume));
        
        if (!this.muted) {
            this.gainNode.gain.value = this.volume;
        }

        return this;
    }

    /**
     * Get the current volume of this channel.
     */
    public getVolume(): number {
        return this.volume;
    }

    /**
     * Mute or unmute this channel.
     * @param muted - Whether to mute the channel. Defaults to true if not provided.
     */
    public mute(): this;
    public mute(muted: boolean): this;
    public mute(muted?: boolean): this {
        this.ensureNotRemoved();
        this.muted = muted !== undefined ? muted : true;
        this.gainNode.gain.value = this.muted ? 0 : this.volume;
        return this;
    }

    /**
     * Unmute this channel.
     */
    public unmute(): this {
        return this.mute(false);
    }

    /**
     * Check if this channel is muted.
     */
    public isMuted(): boolean {
        return this.muted;
    }

    /**
     * Remove this channel and all its sub-channels.
     * All tokens will be stopped immediately.
     */
    public remove(): this {
        if (this.removed) return this;

        // Mark as removed first to prevent concurrent operations during cleanup
        this.removed = true;

        // Stop all tokens
        for (const token of this.tokens) {
            token.stop();
        }
        this.tokens.clear();

        // Create a copy of sub-channels to avoid concurrent modification during iteration
        const subChannelsToRemove = Array.from(this.subChannels.values());
        this.subChannels.clear();

        // Remove all sub-channels
        for (const subChannel of subChannelsToRemove) {
            subChannel.remove();
        }

        // Disconnect from parent
        try {
            this.gainNode.disconnect();
        } catch {
            // Ignore disconnect errors
        }

        // Unregister from audio provider
        this.audioProvider.unregisterChannel(this);

        // Remove from parent's sub-channels map
        if (this.parentChannel) {
            this.parentChannel.removeSubChannel(this.name);
        }

        return this;
    }

    /**
     * Remove a sub-channel from this channel's map.
     * @internal
     */
    private removeSubChannel(name: string): void {
        this.subChannels.delete(name);
    }

    /**
     * Get all tokens managed by this channel and its sub-channels.
     */
    public getTokens(): SoundToken[] {
        this.ensureNotRemoved();

        const allTokens: SoundToken[] = Array.from(this.tokens);

        // Recursively collect tokens from sub-channels
        for (const subChannel of this.subChannels.values()) {
            allTokens.push(...subChannel.getTokens());
        }

        return allTokens;
    }

    /**
     * Check if this channel has been removed.
     */
    public isRemoved(): boolean {
        return this.removed;
    }

    /**
     * Get the parent channel, if any.
     */
    public getParent(): Channel | null {
        return this.parentChannel;
    }

    /**
     * Get the options for this channel.
     */
    public getOptions(): Required<ChannelOptions> {
        return { ...this.options };
    }
}

