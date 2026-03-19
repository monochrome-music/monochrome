/**
 * Converts a ReadableStream into an async iterable iterator.
 * @template T The type of data chunks yielded from the stream.
 * @param stream The ReadableStream to convert into an async iterable.
 * @yields Chunks of data from the stream as they become available.
 * @example
 * ```typescript
 * const response = await fetch('https://example.com/data');
 * for await (const chunk of readableStreamIterator(response.body)) {
 *   console.log(chunk);
 * }
 * ```
 */
export async function* readableStreamIterator<T>(stream: ReadableStream<T>): AsyncIterableIterator<T> {
    const reader = stream.getReader();

    while (true) {
        const { value, done } = await reader.read();

        if (value) {
            yield value;
        }

        if (done) {
            break;
        }
    }
}
