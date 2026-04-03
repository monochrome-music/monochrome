import { InvisibleDictionary, baseCodecFrom } from './BaseCodec';
import { v7 } from 'uuid';

export const InvisibleCodec = baseCodecFrom(InvisibleDictionary);

export function doTimed<T>(message: string, callback: () => T): T {
    if (import.meta.env.DEV) {
        const hiddenId = InvisibleCodec.encode(v7());
        console.time(message + hiddenId);
        try {
            const output = callback();
            return output;
        } finally {
            console.timeEnd(message + hiddenId);
        }
    } else {
        return callback();
    }
}

export function doTimedAsync<T, R = T extends Promise<T> ? Promise<T> : T>(
    message: string,
    callback: () => R,
    throwError: boolean = false
): R {
    if (import.meta.env.DEV) {
        return new Promise((resolve, reject) => {
            (async () => {
                const hiddenId = InvisibleCodec.encode(v7());
                console.time(message + hiddenId);
                try {
                    const output = await callback();
                    resolve(output);
                } catch (err) {
                    console.error(`Error in timed operation "${message}":`, err);
                    if (throwError) {
                        if (err instanceof Error) {
                            reject(err);
                        } else {
                            reject(new Error(String(err)));
                        }
                    } else {
                        resolve(undefined as R);
                    }
                } finally {
                    console.timeEnd(message + hiddenId);
                }
            })().catch(reject);
        }) as R;
    } else {
        return callback();
    }
}
