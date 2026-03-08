import { InvisibleDictionary, baseCodecFrom } from './BaseCodec';
import { v7 } from 'uuid';

export const InvisibleCodec = baseCodecFrom(InvisibleDictionary);

export function doTimed<T>(message: string, callback: () => T): T {
    const hiddenId = InvisibleCodec.encode(v7());
    console.time(message + hiddenId);
    try {
        const output = callback();
        return output;
    } finally {
        console.timeEnd(message + hiddenId);
    }
}

export async function doTimedAsync<T>(message: string, callback: () => T): Promise<Awaited<T>> {
    const hiddenId = InvisibleCodec.encode(v7());
    console.time(message + hiddenId);
    try {
        const output = await callback();
        return output;
    } finally {
        console.timeEnd(message + hiddenId);
    }
}
