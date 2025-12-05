
let silent = false;

export function setSilentLogging(value: boolean): void {
    silent = value;
}

export function warn(message: string, error?: unknown): void {
    if (silent) return;
    if (error !== undefined) {
        // eslint-disable-next-line no-console
        console.warn(message, error);
    } else {
        // eslint-disable-next-line no-console
        console.warn(message);
    }
}
