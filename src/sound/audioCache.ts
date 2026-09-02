import { CachedAudioImpl, CachedAudioOwner } from "./cachedAudioImpl";
import { CachedAudio, CacheStats } from "./types";

/**
 * The decoded clips of one {@link Sound} instance, keyed by the path they were loaded from.
 *
 * A path is fetched and decoded at most once at a time: a second load while the first is in
 * flight shares its promise. What keeps a decoded clip in the table is described on
 * {@link CachedAudioImpl}; the table itself only knows how to hand a clip out and how to forget
 * one that has released its buffer.
 */
export class AudioCache implements CachedAudioOwner {
    private readonly cache = new Map<string, CachedAudioImpl>();
    private readonly loadingPromises = new Map<string, Promise<CachedAudioImpl>>();
    private readonly audioContext: AudioContext;
    private readonly releaseDelay: number;
    /**
     * Bumped by `clear()`. A load that was in flight when the cache was cleared belongs to a
     * generation that no longer exists, and must not put its result back into the table.
     */
    private generation = 0;

    constructor(audioContext: AudioContext, releaseDelay: number = 0) {
        this.audioContext = audioContext;
        this.releaseDelay = Math.max(0, releaseDelay);
    }

    /**
     * Fetch and decode `path` if it is not decoded already, and hand the caller a reference to it.
     *
     * The reference is the caller's to give back: {@link CachedAudio.release} when done with it, or
     * {@link AudioCache.unload} to drop the clip outright.
     */
    async load(path: string): Promise<CachedAudio> {
        const entry = await this.acquire(path);
        return entry.retain();
    }

    /**
     * Fetch and decode `path` if needed, without taking a reference.
     *
     * For a token about to play the clip: the token's own playing count is what holds the buffer
     * while it runs, and when it stops the clip is dropped unless someone else holds a reference.
     * That is what keeps a play-by-path from pinning every clip it ever touched.
     */
    async acquire(path: string): Promise<CachedAudioImpl> {
        const cached = this.cache.get(path);
        if (cached && cached.isAlive()) {
            return cached;
        }

        const loadingPromise = this.loadingPromises.get(path);
        if (loadingPromise) {
            return loadingPromise;
        }

        const generation = this.generation;
        const promise = this.doLoad(path);
        this.loadingPromises.set(path, promise);

        try {
            const result = await promise;
            if (generation !== this.generation) {
                // Cleared while decoding: the table this was headed for is gone, and so is the
                // buffer. The caller gets a handle it cannot play, which is the truthful answer.
                await result.forceUnload();
                return result;
            }
            this.cache.set(path, result);
            return result;
        } finally {
            if (this.loadingPromises.get(path) === promise) {
                this.loadingPromises.delete(path);
            }
        }
    }

    private async doLoad(path: string): Promise<CachedAudioImpl> {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        return new CachedAudioImpl(audioBuffer, this, this.releaseDelay);
    }

    /**
     * The decoded clip for `path`, if there is one.
     */
    get(path: string): CachedAudio | null {
        const cached = this.cache.get(path);
        return cached && cached.isAlive() ? cached : null;
    }

    /**
     * Give back one reference on the clip for `path`. `false` when nothing is cached under it.
     */
    release(path: string): boolean {
        const cached = this.cache.get(path);
        if (!cached) {
            return false;
        }
        cached.release();
        return true;
    }

    /**
     * Drop every reference on the clip for `path` and release it as soon as no token is playing
     * it. `false` when nothing is cached under it.
     */
    async unload(path: string): Promise<boolean> {
        const cached = this.cache.get(path);
        if (!cached) {
            return false;
        }
        await cached.unload();
        return true;
    }

    /**
     * Forget an entry whose buffer is gone. Called by the entry itself, and only for the entry the
     * path still maps to: a path reloaded after a drop maps to a newer entry that must stay.
     * @internal
     */
    evict(entry: CachedAudioImpl): void {
        for (const [path, cached] of this.cache) {
            if (cached === entry) {
                this.cache.delete(path);
                return;
            }
        }
    }

    /**
     * Release every clip immediately, whether or not anything is playing it.
     */
    clear(): void {
        this.generation++;
        // `forceUnload` evicts through `evict()`, so iterate over a copy.
        for (const cachedAudio of Array.from(this.cache.values())) {
            void cachedAudio.forceUnload();
        }
        this.cache.clear();
        this.loadingPromises.clear();
    }

    /**
     * What the cache is holding right now.
     */
    getStats(): CacheStats {
        let decodedBytes = 0;
        for (const cachedAudio of this.cache.values()) {
            decodedBytes += cachedAudio.byteLength();
        }
        return {
            entries: this.cache.size,
            loading: this.loadingPromises.size,
            decodedBytes,
        };
    }
}
