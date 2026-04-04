/**
 * A generic iterator that yields the index, total count, and item for any finite iterable.
 *
 * @template T - The type of items in the iterable.
 * @param iterable - The iterable to process.
 * @returns A generator that yields an object with index, total, and item.
 */
export default function* indexedIterator<T>(
    iterable: Iterable<T>
): Generator<{ index: number; total: number; item: T }> {
    const array = Array.from(iterable); // Convert the iterable to an array
    const total = array.length; // Get the total count of items
    for (let index = 0; index < total; index++) {
        yield { index, total, item: array[index] }; // Yield index, total, and item
    }
}
