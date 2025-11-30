import { SoundToken } from "./soundToken";
import { FadeToken } from "./types";

export class FadeTokenImpl implements FadeToken {
    private _finished: Promise<void>;
    private resolveFinished!: () => void;
    private cancelled = false;
    private finishedInternal = false;

    constructor(
        private token: SoundToken,
        private endVolume: number
    ) {
        this._finished = new Promise<void>((resolve) => {
            this.resolveFinished = resolve;
        });
    }

    get finished(): Promise<void> {
        return this._finished;
    }

    cancel(): void {
        if (this.cancelled || this.finishedInternal) return;
        this.cancelled = true;
        this.resolveFinished();
    }

    finish(): void {
        if (this.finishedInternal) return;
        this.finishedInternal = true;
        this.token.setVolume(this.endVolume);
        this.resolveFinished();
    }

    isCancelled(): boolean {
        return this.cancelled;
    }

    isFinished(): boolean {
        return this.finishedInternal;
    }

    getTargetVolume(): number {
        return this.endVolume;
    }
}
