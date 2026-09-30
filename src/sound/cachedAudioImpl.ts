import { CachedAudio } from "./types";

/**
 * What a cached clip needs from the cache that owns it: to be taken out of the table once its
 * buffer is gone, so that the next load of the same path decodes afresh instead of finding a dead
 * entry.
 */
export interface CachedAudioOwner {
    evict(entry: CachedAudioImpl): void;
}

/**
 * A decoded clip and the two counts that keep it alive.
 *
 * `references` are held by callers - every {@link Sound.load} hands one out and every
 * {@link CachedAudio.retain} adds one - and `playing` is the number of tokens currently playing
 * the buffer. The buffer is dropped when both reach zero, which is checked every time either one
 * is decremented; it is never dropped on the strength of the counts alone, so a clip that was
 * loaded and never touched again stays until something gives it back.
 *
 * A source node keeps its own reference to the `AudioBuffer` it was given, so dropping the
 * cache's does not cut off a token that is still playing: `forceUnload` and a finished grace
 * delay both leave running tokens alone and only prevent new ones.
 */
export class CachedAudioImpl implements CachedAudio {
    private audioBuffer: AudioBuffer | null;
    private references = 0;
    private playing = 0;
    /**
     * Set by `unload()`: drop the buffer the moment the last token stops, grace delay or not.
     */
    private dropWhenIdle = false;
    private releaseTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        audioBuffer: AudioBuffer,
        private readonly owner: CachedAudioOwner,
        private readonly releaseDelay: number,
    ) {
        this.audioBuffer = audioBuffer;
    }

    retain(): this {
        this.references++;
        // A new reference is somebody wanting the clip, which countermands a pending unload.
        this.dropWhenIdle = false;
        this.cancelPendingRelease();
        return this;
    }

    release(): void {
        if (this.references > 0) {
            this.references--;
        }
        this.reconsider();
    }

    /**
     * A token started playing the buffer.
     * @internal
     */
    addRef(): void {
        this.playing++;
        this.cancelPendingRelease();
    }

    /**
     * A token stopped playing the buffer.
     * @internal
     */
    releaseRef(): void {
        if (this.playing > 0) {
            this.playing--;
        }
        this.reconsider();
    }

    getReferenceCount(): number {
        return this.references;
    }

    getPlayingCount(): number {
        return this.playing;
    }

    async unload(): Promise<void> {
        this.references = 0;
        this.dropWhenIdle = true;
        this.reconsider();
    }

    async forceUnload(): Promise<void> {
        this.drop();
    }

    isAlive(): boolean {
        return this.audioBuffer !== null;
    }

    raw(): AudioBuffer {
        if (!this.audioBuffer) {
            throw new Error("CachedAudio has been unloaded.");
        }
        return this.audioBuffer;
    }

    /**
     * Bytes of decoded PCM this clip holds, or 0 once released.
     */
    byteLength(): number {
        if (!this.audioBuffer) {
            return 0;
        }
        return this.audioBuffer.length * this.audioBuffer.numberOfChannels * 4;
    }

    /**
     * Decoded, and held by nobody: the state in which the buffer may go.
     */
    private isIdle(): boolean {
        return this.audioBuffer !== null && this.references === 0 && this.playing === 0;
    }

    /**
     * Drop the buffer if nothing holds the clip any more - after the grace delay, when there is
     * one and the clip was not unloaded outright.
     */
    private reconsider(): void {
        if (!this.isIdle()) {
            return;
        }
        if (this.releaseDelay > 0 && !this.dropWhenIdle) {
            if (!this.releaseTimer) {
                this.releaseTimer = setTimeout(() => {
                    this.releaseTimer = null;
                    // Re-checked rather than assumed: a retain or a new token cancels the timer,
                    // but one that raced the callback must still not drop a held clip.
                    if (this.isIdle()) {
                        this.drop();
                    }
                }, this.releaseDelay);
            }
            return;
        }
        this.drop();
    }

    private cancelPendingRelease(): void {
        if (this.releaseTimer) {
            clearTimeout(this.releaseTimer);
            this.releaseTimer = null;
        }
    }

    private drop(): void {
        this.cancelPendingRelease();
        if (!this.audioBuffer) {
            return;
        }
        this.audioBuffer = null;
        this.references = 0;
        this.playing = 0;
        this.owner.evict(this);
    }
}
