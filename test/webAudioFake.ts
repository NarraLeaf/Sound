/**
 * Enough of the Web Audio and media-element surface for the library to run under node.
 *
 * The library tells its two kinds of source apart with `instanceof AudioBufferSourceNode` and
 * `instanceof HTMLAudioElement`, and builds a stream source with `new Audio(path)`, so the fake
 * installs those four names on `globalThis` and makes `Audio` produce an `HTMLAudioElement`. Every
 * fake records what was done to it and can be told to finish, which is what the tests drive.
 */
import { vi } from "vitest";

type Listener = (event: { type: string }) => void;

class FakeEventTarget {
    private readonly listeners = new Map<string, Listener[]>();

    addEventListener(type: string, listener: Listener): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    removeEventListener(type: string, listener: Listener): void {
        const list = this.listeners.get(type);
        if (!list) return;
        const index = list.indexOf(listener);
        if (index !== -1) list.splice(index, 1);
    }

    dispatch(type: string): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener({ type });
        }
    }
}

export class FakeAudioParam {
    public value = 1;
    public cancelScheduledValues = vi.fn();
    public setTargetAtTime = vi.fn();
    public readonly ramps: Array<{ from: number; to: number; endTime: number }> = [];
    private pendingFrom = 1;

    setValueAtTime(value: number): void {
        this.value = value;
        this.pendingFrom = value;
    }

    linearRampToValueAtTime(value: number, endTime: number): void {
        this.ramps.push({ from: this.pendingFrom, to: value, endTime });
        this.value = value;
    }
}

export class FakeAudioNode extends FakeEventTarget {
    public readonly connections: FakeAudioNode[] = [];

    connect(node: FakeAudioNode): FakeAudioNode {
        this.connections.push(node);
        return node;
    }

    disconnect(): void {
        this.connections.length = 0;
    }
}

export class FakeGainNode extends FakeAudioNode {
    public readonly gain = new FakeAudioParam();
}

/**
 * A decoded buffer. `length` is frames; the fake decoder makes one frame per byte of input, so a
 * test can predict `decodedBytes` from the size it gave `fetch`.
 */
export class FakeAudioBuffer {
    constructor(
        public readonly length: number,
        public readonly numberOfChannels: number,
        public readonly sampleRate: number = 44100,
    ) {}

    get duration(): number {
        return this.length / this.sampleRate;
    }
}

export class FakeAudioBufferSourceNode extends FakeAudioNode {
    public buffer: FakeAudioBuffer | null = null;
    public loop = false;
    public loopStart = 0;
    public loopEnd = 0;
    public readonly playbackRate = { value: 1 };
    public readonly starts: Array<{ when: number; offset: number }> = [];
    public stopped = false;

    start(when: number = 0, offset: number = 0): void {
        this.starts.push({ when, offset });
    }

    stop(): void {
        this.stopped = true;
    }

    /** Reach the end of the buffer, as the browser would. */
    end(): void {
        this.dispatch("ended");
    }
}

export class FakeMediaElementSourceNode extends FakeAudioNode {
    constructor(public readonly mediaElement: FakeHTMLAudioElement) {
        super();
    }
}

export class FakeHTMLAudioElement extends FakeEventTarget {
    public src = "";
    public currentTime = 0;
    public duration = NaN;
    public loop = false;
    public playbackRate = 1;
    public preservesPitch = true;
    public crossOrigin: string | null = null;
    public paused = true;
    public playCalls = 0;
    public loadCalls = 0;
    /** The play head at the moment of each `play()`, which is where playback started from. */
    public readonly playedFrom: number[] = [];
    public playRejection: Error | null = null;

    play(): Promise<void> {
        this.playCalls++;
        this.playedFrom.push(this.currentTime);
        if (this.playRejection) {
            return Promise.reject(this.playRejection);
        }
        this.paused = false;
        return Promise.resolve();
    }

    pause(): void {
        this.paused = true;
    }

    load(): void {
        this.loadCalls++;
    }

    /** Reach the end of the file, as the browser would for a non-looping element. */
    end(): void {
        this.paused = true;
        this.dispatch("ended");
    }
}

export class FakeAudioContext extends FakeEventTarget {
    public currentTime = 0;
    public state: "suspended" | "running" | "closed" = "running";
    public readonly destination = new FakeAudioNode();
    public readonly gains: FakeGainNode[] = [];
    public readonly bufferSources: FakeAudioBufferSourceNode[] = [];
    public readonly mediaSources: FakeMediaElementSourceNode[] = [];
    public decodeCalls = 0;
    public closed = false;

    // The library passes `{latencyHint, sampleRate}`; nothing here reads them.
    constructor(_options?: unknown) {
        super();
    }

    createGain(): FakeGainNode {
        const gain = new FakeGainNode();
        this.gains.push(gain);
        return gain;
    }

    createBufferSource(): FakeAudioBufferSourceNode {
        const node = new FakeAudioBufferSourceNode();
        this.bufferSources.push(node);
        return node;
    }

    createMediaElementSource(element: FakeHTMLAudioElement): FakeMediaElementSourceNode {
        const node = new FakeMediaElementSourceNode(element);
        this.mediaSources.push(node);
        return node;
    }

    decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
        this.decodeCalls++;
        // One frame per byte, stereo: `decodedBytes` for a clip is `byteLength * 2 * 4`.
        return Promise.resolve(new FakeAudioBuffer(data.byteLength, 2));
    }

    resume(): Promise<void> {
        this.state = "running";
        return Promise.resolve();
    }

    close(): Promise<void> {
        this.closed = true;
        this.state = "closed";
        return Promise.resolve();
    }
}

export type FetchRecord = { url: string; method: string };

export type FakeWebAudio = {
    /** Every context the library created, in order. */
    contexts: FakeAudioContext[];
    /** Every element `new Audio()` produced, in order. */
    elements: FakeHTMLAudioElement[];
    /** Every request `fetch` saw. */
    requests: FetchRecord[];
    /** Bytes `fetch` answers a GET for, by url; anything absent answers 1000 bytes. */
    sizes: Map<string, number>;
    /** Urls whose HEAD is refused with a 405, the way a handler that does not implement it would. */
    headRefused: Set<string>;
    restore(): void;
};

/**
 * Install the fake on `globalThis` for the duration of a test. `location` is left undefined, so a
 * relative path resolves to no scheme and is treated as http.
 */
export function installWebAudioFake(): FakeWebAudio {
    const fake: FakeWebAudio = {
        contexts: [],
        elements: [],
        requests: [],
        sizes: new Map(),
        headRefused: new Set(),
        restore,
    };

    class AudioContext extends FakeAudioContext {
        constructor(options?: unknown) {
            super(options);
            fake.contexts.push(this);
        }
    }

    class Audio extends FakeHTMLAudioElement {
        constructor(src?: string) {
            super();
            this.src = src ?? "";
            fake.elements.push(this);
        }
    }

    const fetch = vi.fn((url: string, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        fake.requests.push({ url, method });
        const size = fake.sizes.get(url) ?? 1000;
        if (method === "HEAD") {
            if (fake.headRefused.has(url)) {
                return Promise.resolve(new Response(null, { status: 405 }));
            }
            return Promise.resolve(new Response(null, {
                status: 200,
                headers: { "Content-Length": String(size) },
            }));
        }
        return Promise.resolve(new Response(new ArrayBuffer(size), { status: 200 }));
    });

    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = {
        AudioContext: globals.AudioContext,
        AudioBufferSourceNode: globals.AudioBufferSourceNode,
        HTMLAudioElement: globals.HTMLAudioElement,
        Audio: globals.Audio,
        fetch: globals.fetch,
    };
    globals.AudioContext = AudioContext;
    globals.AudioBufferSourceNode = FakeAudioBufferSourceNode;
    globals.HTMLAudioElement = FakeHTMLAudioElement;
    globals.Audio = Audio;
    globals.fetch = fetch;

    function restore(): void {
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete globals[name];
            } else {
                globals[name] = value;
            }
        }
    }

    return fake;
}

/** Let the promise chains inside the library settle. */
export async function settle(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        await Promise.resolve();
    }
}
