export class AbortError extends Error {
    constructor(cause: string = 'The task was aborted.') {
        super(cause);
        this.name = 'AbortError';
    }
}
