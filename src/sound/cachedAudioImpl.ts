import { CachedAudio } from "./types";

/**
 * Implementation of CachedAudio interface using class-based approach to avoid closure risks.
 * Supports reference counting to track active usage.
 */
export class CachedAudioImpl implements CachedAudio {
    private readonly audioBuffer: AudioBuffer;
    private alive: boolean = true;
    private refCount: number = 0;

    constructor(audioBuffer: AudioBuffer) {
        this.audioBuffer = audioBuffer;
    }

    /**
     * Increment the reference count. Called when a token starts using this audio.
     */
    addRef(): void {
        this.refCount++;
    }

    /**
     * Decrement the reference count. Called when a token stops using this audio.
     */
    releaseRef(): void {
        if (this.refCount > 0) {
            this.refCount--;
        }
    }

    /**
     * Get the current reference count.
     */
    getRefCount(): number {
        return this.refCount;
    }

    /**
     * Unload the cached audio. Will fail silently if tokens are still playing.
     */
    async unload(): Promise<void> {
        // Only unload if no tokens are using it
        if (this.refCount > 0) {
            // Silently fail - tokens are still using this audio
            return;
        }
        this.alive = false;
    }

    /**
     * Force unload the cached audio, even if tokens are still playing.
     */
    async forceUnload(): Promise<void> {
        this.alive = false;
        this.refCount = 0;
    }

    /**
     * Check if the cached audio is still valid.
     */
    isAlive(): boolean {
        return this.alive;
    }

    /**
     * Get the raw audio buffer.
     */
    raw(): AudioBuffer {
        if (!this.alive) {
            throw new Error("CachedAudio has been unloaded.");
        }
        return this.audioBuffer;
    }
}
