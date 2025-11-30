import { AudioSourceController } from "./audioSourceController";
import { FadeTokenImpl } from "./fadeTokenImpl";
import { StopOptions, FadeToken } from "./types";

export class SoundToken {
    // Audio nodes and connections
    private sourceController: AudioSourceController;
    private gainNode: GainNode;
    private audioContext: AudioContext;
    private outputNode: AudioNode;

    // Playback state
    private _isPlaying = false;
    private _isPaused = false;
    private _isMuted = false;
    private volume = 1;
    private rate = 1;
    private startTime = 0;
    private pauseTime = 0;
    private duration = 0;

    // Fade system
    private currentFade: FadeTokenImpl | null = null;

    constructor(
        audioContext: AudioContext,
        source: AudioBufferSourceNode | HTMLAudioElement,
        options: {
            volume?: number;
            rate?: number;
            startTime?: number;
            duration?: number;
        } = {},
        outputNode?: AudioNode
    ) {
        this.audioContext = audioContext;
        this.volume = options.volume ?? 1;
        this.rate = options.rate ?? 1;
        this.startTime = options.startTime ?? 0;
        this.duration = options.duration ?? 0;
        this.outputNode = outputNode ?? audioContext.destination;

        // Create gain node for volume control
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = this.volume;
        this.gainNode.connect(this.outputNode);

        // Create source controller and set initial source
        this.sourceController = new AudioSourceController(audioContext, this.gainNode);
        this.sourceController.setSource(source);

        // -------------- Auto start playback -----------------
        const offset = this.startTime;
        this.sourceController.start(0, offset);
        this._isPlaying = true;

        // If duration >0 schedule stop
        if (this.duration > 0) {
            setTimeout(() => {
                if (this._isPlaying) {
                    this.stop();
                }
            }, this.duration * 1000);
        }
    }

    private emit(event: string): void {
        // Emit through source controller
        this.sourceController.emit(event);
        // Handle internal state changes
        if (event === "ended") {
            this._isPlaying = false;
            // Clean up resources on natural end
            try {
                this.gainNode.disconnect();
            } catch {
                // Ignore disconnect errors
            }
        }
    }

    // Volume control methods
    setVolume(volume: number): this {
        // Cancel any ongoing fade
        if (this.currentFade) {
            this.currentFade.cancel();
            this.currentFade = null;
        }

        volume = Math.max(0, Math.min(1, volume));
        this.volume = volume;

        if (!this._isMuted) {
            // Cancel any pending automation before setting new value
            this.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.gainNode.gain.value = volume;
        }

        return this;
    }

    getVolume(): number {
        return this.volume;
    }

    mute(): this;
    mute(muted: boolean): this;
    mute(muted?: boolean): this {
        const shouldMute = muted !== undefined ? muted : true;
        this._isMuted = shouldMute;

        if (this.currentFade && !this.currentFade.isFinished() && !this.currentFade.isCancelled()) {
            // Skip to the end of fade immediately instead of cancelling
            const targetVolume = this.currentFade.getTargetVolume();
            this.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.volume = targetVolume;
            this.gainNode.gain.value = shouldMute ? 0 : targetVolume;
            this.currentFade.finish();
            this.currentFade = null;
        } else {
            // No ongoing fade, just set the volume
            this.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.gainNode.gain.value = shouldMute ? 0 : this.volume;
        }

        return this;
    }

    unmute(): this {
        return this.mute(false);
    }

    isMuted(): boolean {
        return this._isMuted;
    }

    // Playback control methods
    pause(): this {
        if (!this._isPlaying || this._isPaused) return this;

        const source = this.sourceController.getSource();
        if (source instanceof HTMLAudioElement) {
            source.pause();
            this.pauseTime = source.currentTime;
        } else if (source instanceof AudioBufferSourceNode) {
            // For AudioBufferSourceNode, we need to track time manually
            this.pauseTime = this.audioContext.currentTime - this.startTime;
            this.sourceController.stop();
        }

        this._isPlaying = false;
        this._isPaused = true;
        this.emit('pause');
        return this;
    }

    resume(): this {
        if (!this._isPaused) return this;

        const source = this.sourceController.getSource();
        if (source instanceof HTMLAudioElement) {
            source.play().catch(() => {
                // If play fails (e.g., due to browser autoplay policy), rollback state
                this._isPlaying = false;
                this._isPaused = true;
            });
        } else if (source instanceof AudioBufferSourceNode) {
            // Create a new source node and resume from pause time
            const newSource = this.audioContext.createBufferSource();
            newSource.buffer = source.buffer;
            newSource.playbackRate.value = this.rate;
            // Preserve loop settings
            newSource.loop = source.loop;
            newSource.loopStart = source.loopStart;
            newSource.loopEnd = source.loopEnd;

            this.sourceController.refreshSource(newSource);
            this.startTime = this.audioContext.currentTime - this.pauseTime;
            this.sourceController.start(0, this.pauseTime);
        }

        this._isPlaying = true;
        this._isPaused = false;
        this.emit('resume');
        return this;
    }

    isPlaying(): boolean {
        return this._isPlaying;
    }

    isPaused(): boolean {
        return this._isPaused;
    }

    stop(options: StopOptions = {}): this {
        const { fadeDuration = 0 } = options;

        if (fadeDuration > 0) {
            // Stop with fade out
            this.fade(this.getVolume(), 0, fadeDuration).finished.then(() => {
                this.doStop();
            });
        } else {
            this.doStop();
        }

        return this;
    }

    private doStop(): void {
        this.sourceController.stop();
        this._isPlaying = false;
        this._isPaused = false;
        this.emit('stop');

        // Clean up resources
        this.sourceController.destroy();
        try {
            this.gainNode.disconnect();
        } catch {
            // Ignore disconnect errors
        }
    }

    // Audio parameter control methods
    setRate(rate: number): this {
        rate = Math.max(0.001, rate); // Prevent division by zero
        this.rate = rate;

        const source = this.sourceController.getSource();
        if (source instanceof HTMLAudioElement) {
            source.playbackRate = rate;
        } else if (source instanceof AudioBufferSourceNode) {
            source.playbackRate.value = rate;
        }

        return this;
    }

    getRate(): number {
        return this.rate;
    }

    seek(time: number): this {
        time = Math.max(0, time);

        const source = this.sourceController.getSource();
        if (source instanceof HTMLAudioElement) {
            source.currentTime = time;
            this.emit('seek');
        } else if (source instanceof AudioBufferSourceNode) {
            const currentTime = this.getCurrentTime();
            if (Math.abs(time - currentTime) > 0.01) { // Only seek if difference is significant
                if (this._isPlaying) {
                    // Currently playing - recreate source and continue playing
                    this.sourceController.stop();
                    const newSource = this.audioContext.createBufferSource();
                    newSource.buffer = source.buffer;
                    newSource.playbackRate.value = this.rate;
                    newSource.loop = source.loop;
                    newSource.loopStart = source.loopStart;
                    newSource.loopEnd = source.loopEnd;
                    this.sourceController.refreshSource(newSource);
                    this.startTime = this.audioContext.currentTime - time;
                    this.sourceController.start(0, time);
                } else if (this._isPaused) {
                    // Paused - just update the pause time, will be used on resume
                    this.pauseTime = time;
                }
                this.emit('seek');
            }
        }

        return this;
    }

    getCurrentTime(): number {
        const source = this.sourceController.getSource();
        if (source instanceof HTMLAudioElement) {
            return source.currentTime;
        } else if (source instanceof AudioBufferSourceNode) {
            if (this._isPaused) {
                return this.pauseTime;
            } else if (this._isPlaying) {
                return this.audioContext.currentTime - this.startTime;
            }
        }
        return 0;
    }

    getDuration(): number {
        const source = this.sourceController.getSource();
        if (source instanceof HTMLAudioElement) {
            return source.duration || 0;
        } else if (source instanceof AudioBufferSourceNode && source.buffer) {
            return source.buffer.duration;
        }
        return this.duration;
    }

    // Fade effect method
    fade(from: number, to: number, duration: number): FadeToken {
        // Cancel any ongoing fade
        if (this.currentFade) {
            this.currentFade.cancel();
        }

        from = Math.max(0, Math.min(1, from));
        to = Math.max(0, Math.min(1, to));
        duration = Math.max(0, duration);

        // If duration is 0, set volume immediately
        if (duration === 0) {
            this.setVolume(to);
            const fadeToken = new FadeTokenImpl(this, to);
            fadeToken.finish();
            return fadeToken;
        }

        // Set initial volume
        this.volume = from;
        if (!this._isMuted) {
            this.gainNode.gain.value = from;
        }

        // Create fade token
        const fadeToken = new FadeTokenImpl(this, to);
        this.currentFade = fadeToken;

        // Start fade
        const startTime = this.audioContext.currentTime;
        this.gainNode.gain.setValueAtTime(from, startTime);
        this.gainNode.gain.linearRampToValueAtTime(to, startTime + duration / 1000);

        // Handle completion
        setTimeout(() => {
            if (!fadeToken.isCancelled() && !fadeToken.isFinished()) {
                this.volume = to;
                fadeToken.finish();
                this.currentFade = null;
            }
        }, duration);

        return fadeToken;
    }

    // Event system methods
    on(event: string, callback: Function): this {
        this.sourceController.on(event, callback);
        return this;
    }

    off(event: string, callback: Function): this {
        this.sourceController.off(event, callback);
        return this;
    }

    once(event: string, callback: Function): this {
        this.sourceController.once(event, callback);
        return this;
    }
}
