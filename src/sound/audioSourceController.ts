export interface EventListener {
    callback: Function;
    once: boolean;
}

/**
 * Manages the lifecycle of audio source nodes, including creation, connection,
 * destruction, and automatic event listener management.
 */
export class AudioSourceController {
    private currentSource: AudioBufferSourceNode | HTMLAudioElement | null = null;
    private mediaElementSource: MediaElementAudioSourceNode | null = null;
    private endedHandler: ((ev: Event) => void) | null = null;
    private gainNode: GainNode;
    private audioContext: AudioContext;
    private eventListeners: Map<string, EventListener[]> = new Map();

    constructor(
        audioContext: AudioContext,
        gainNode: GainNode
    ) {
        this.audioContext = audioContext;
        this.gainNode = gainNode;
    }

    /**
     * Set the source node and establish connections and event listeners.
     */
    setSource(source: AudioBufferSourceNode | HTMLAudioElement): void {
        // Disconnect previous source if exists
        this.disconnectSource();

        this.currentSource = source;

        // Connect to gain node
        if (source instanceof AudioBufferSourceNode) {
            source.connect(this.gainNode);
        } else if (source instanceof HTMLAudioElement) {
            // HTMLAudioElement connection: create MediaElementSource and connect to gain node
            this.mediaElementSource = this.audioContext.createMediaElementSource(source);
            this.mediaElementSource.connect(this.gainNode);
        }

        // Setup event listeners
        this.setupEventListeners();
    }

    /**
     * Get the current source node.
     */
    getSource(): AudioBufferSourceNode | HTMLAudioElement | null {
        return this.currentSource;
    }

    /**
     * Refresh the source node with a new one, preserving connections and event listeners.
     */
    refreshSource(newSource: AudioBufferSourceNode | HTMLAudioElement): void {
        // Store current event listeners before disconnecting
        const currentListeners = new Map(this.eventListeners);

        // Disconnect current source
        this.disconnectSource();

        // Set new source
        this.currentSource = newSource;

        // Reconnect based on source type
        if (newSource instanceof AudioBufferSourceNode) {
            newSource.connect(this.gainNode);
        } else if (newSource instanceof HTMLAudioElement) {
            // HTMLAudioElement connection: create MediaElementSource and connect to gain node
            this.mediaElementSource = this.audioContext.createMediaElementSource(newSource);
            this.mediaElementSource.connect(this.gainNode);
        }

        // Restore event listeners map and setup new listeners
        this.eventListeners = currentListeners;
        this.setupEventListeners();
    }

    /**
     * Disconnect the current source node and clear event listeners.
     */
    disconnectSource(): void {
        if (this.currentSource) {
            // Remove all event listeners first
            this.removeAllEventListeners();

            if (this.currentSource instanceof AudioBufferSourceNode) {
                try {
                    this.currentSource.disconnect();
                } catch {
                    // Ignore disconnect errors
                }
            } else if (this.currentSource instanceof HTMLAudioElement) {
                // Clean up HTMLAudioElement resources
                this.currentSource.pause();
                this.currentSource.src = "";
                this.currentSource.load(); // Force release of media resources
            }

            if (this.mediaElementSource) {
                try {
                    this.mediaElementSource.disconnect();
                } catch {
                    // Ignore disconnect errors
                }
                this.mediaElementSource = null;
            }

            this.currentSource = null;
        }
    }

    /**
     * Setup event listeners for the current source node.
     */
    private setupEventListeners(): void {
        if (!this.currentSource) return;

        // Store handler so we can remove later
        this.endedHandler = (ev: Event) => {
            this.emit('ended');
        };

        if (this.currentSource instanceof HTMLAudioElement) {
            this.currentSource.addEventListener('ended', this.endedHandler);
        } else if (this.currentSource instanceof AudioBufferSourceNode) {
            this.currentSource.addEventListener('ended', this.endedHandler);
        }
    }

    /**
     * Remove all event listeners from the current source node.
     */
    private removeAllEventListeners(): void {
        if (!this.currentSource || !this.endedHandler) return;

        // Remove 'ended' event from both HTMLAudioElement and AudioBufferSourceNode
        if (this.currentSource instanceof HTMLAudioElement) {
            this.currentSource.removeEventListener('ended', this.endedHandler);
        } else if (this.currentSource instanceof AudioBufferSourceNode) {
            this.currentSource.removeEventListener('ended', this.endedHandler);
        }
        this.endedHandler = null;
    }

    /**
     * Emit an event to all registered listeners.
     */
    emit(event: string): void {
        const listeners = this.eventListeners.get(event);
        if (!listeners) return;

        // Create a copy to avoid issues during iteration
        const listenersToCall = [...listeners];

        listenersToCall.forEach((listener, index) => {
            try {
                listener.callback();
            } catch (error) {
                console.error(`Error in event listener for '${event}':`, error);
            }

            // Remove once listeners
            if (listener.once) {
                listeners.splice(listeners.indexOf(listener), 1);
            }
        });
    }

    /**
     * Add an event listener.
     */
    on(event: string, callback: Function): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event)!.push({ callback, once: false });
    }

    /**
     * Remove an event listener.
     */
    off(event: string, callback: Function): void {
        const listeners = this.eventListeners.get(event);
        if (!listeners) return;

        const index = listeners.findIndex(listener => listener.callback === callback);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }

    /**
     * Add a one-time event listener.
     */
    once(event: string, callback: Function): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event)!.push({ callback, once: true });
    }

    /**
     * Stop the current source node.
     */
    stop(): void {
        if (this.currentSource) {
            if (this.currentSource instanceof HTMLAudioElement) {
                this.currentSource.pause();
                this.currentSource.currentTime = 0;
            } else if (this.currentSource instanceof AudioBufferSourceNode) {
                try {
                    this.currentSource.stop();
                } catch {
                    // Ignore stop errors (e.g., if already stopped)
                }
            }
        }
    }

    /**
     * Destroy the controller and release all resources.
     */
    destroy(): void {
        this.disconnectSource();
        this.eventListeners.clear();
    }

    /**
     * Start the current source node.
     */
    start(when: number = 0, offset: number = 0): void {
        if (this.currentSource instanceof AudioBufferSourceNode) {
            this.currentSource.start(when, offset);
        } else if (this.currentSource instanceof HTMLAudioElement) {
            this.currentSource.play();
        }
    }

    /**
     * Pause the current source node.
     */
    pause(): void {
        if (this.currentSource instanceof HTMLAudioElement) {
            this.currentSource.pause();
        } else if (this.currentSource instanceof AudioBufferSourceNode) {
            // For AudioBufferSourceNode, pausing requires stopping and recreating
            this.stop();
        }
    }
}
