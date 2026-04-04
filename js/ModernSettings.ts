import { db } from './db';

/**
 * A dynamically typed settings container that lazily loads and persists values.
 *
 * Properties are registered using {@link addProperty}. Each property becomes a real
 * getter/setter on the instance and is automatically persisted through the backing
 * `db` implementation.
 *
 * All asynchronous reads/writes are tracked internally. Use {@link waitPending}
 * to await completion of any pending operations.
 *
 * @template C The accumulated shape of the settings object.
 */
class ModernSettings<C extends object = object> {
    /** Internal map of pending async operations keyed by unique symbols. */
    #pending: Record<symbol, Promise<void>> = {};

    /** Whether new properties are prevented from being added. */
    #finalized: boolean = false;

    constructor() {}

    /**
     * Waits until all pending asynchronous operations complete.
     *
     * This includes:
     * - Initial property loading
     * - Any pending writes triggered by property setters
     *
     * This method loops until the pending operation list is empty, ensuring
     * that operations scheduled during awaiting are also handled.
     */
    public async waitPending() {
        while (true) {
            const promises = Object.getOwnPropertySymbols(this.#pending).map((s) => this.#pending[s]);

            if (promises.length) {
                await Promise.all(promises);
            } else {
                break;
            }
        }
    }

    /**
     * Registers a promise as a pending operation.
     *
     * The promise is automatically removed from the pending list once settled.
     *
     * @param callback Function producing the promise to track.
     * @returns The created promise.
     */
    #addPending<C extends Promise<void>>(callback: () => C): C {
        const sym = Symbol();

        return (this.#pending[sym] = callback().finally(() => {
            delete this.#pending[sym];
        }) as C);
    }

    #checkKey(key: string) {
        if (this.#finalized) {
            throw new Error("Can't add a key after finalization.");
        }

        if (Object.keys(this).includes(key)) {
            throw new Error("Can't add a key that already exists.");
        }
    }

    /**
     * Adds a new dynamically typed property to the settings instance.
     *
     * The property will:
     * - Load its value asynchronously from the backing database.
     * - Fall back to `defaultValue` if no value exists.
     * - Persist any updates automatically when set.
     *
     * The method returns the same instance but **with the new property added to
     * the TypeScript type**, allowing fluent chaining with full type safety.
     *
     * Example:
     * ```ts
     * const settings = new ModernSettings()
     *   .addProperty<boolean>("darkMode", false)
     *   .addProperty<string>("username", "")
     *   .finalize();
     *
     * await settings.waitPending();
     *
     * settings.darkMode = true;
     * console.log(settings.username);
     * ```
     *
     * @template T Property value type.
     * @template K Property key name.
     *
     * @param key The property name to define on the settings object.
     * @param defaultValue Value used if the setting is not present in storage.
     * @param options Optional configuration.
     *
     * @param options.backingKey
     * Optional storage key. Defaults to the property name.
     *
     * @param options.legacy
     * Optional migration configuration for moving a value from `localStorage`
     * into the database-backed settings store.
     *
     * @param options.legacy.key
     * Legacy key to read from `localStorage`. Defaults to the same key used for storage.
     *
     * @param options.legacy.transformer
     * Function used to convert the legacy string value into the correct type.
     *
     * @returns The same instance typed with the new property included.
     *
     * @throws If called after {@link finalize}.
     * @throws If a property with the same name already exists.
     */
    public addProperty<T, K extends string>(
        key: K,
        defaultValue: T,
        options?: {
            backingKey?: string;
            getter?: (value: T, settings: C & Record<K, T>) => T;
            setter?: (value: T, settings: C & Record<K, T>) => T;
            legacy?: {
                key?: string;
                transformer: (value: string) => T;
            };
        }
    ) {
        const { backingKey, legacy, getter, setter } = options ?? {};

        this.#checkKey(key);

        const typed = this as unknown as ModernSettings<C & Record<K, T>>;

        let value: T;

        this.#addPending(async () => {
            if (legacy?.key != null || legacy?.transformer != null) {
                {
                    const legacyValue = localStorage.getItem(legacy?.key ?? backingKey ?? key);

                    if (legacyValue !== null) {
                        await db.saveSetting(backingKey ?? key, legacy.transformer(legacyValue));
                        localStorage.removeItem(legacy?.key ?? backingKey ?? key);
                    }
                }
            }

            try {
                value = ((await db.getSetting(backingKey ?? key)) as T) ?? defaultValue;
            } catch {
                value = defaultValue;
            }
        }).catch(console.trace);

        Object.defineProperty(this, key, {
            get: () => (getter ? getter(value, typed as ModernSettings<C> & C & Record<K, T>) : value),
            set: (newValue: T) => {
                value = setter ? setter(newValue, typed as ModernSettings<C> & C & Record<K, T>) : newValue;
                void this.#addPending(() => db.saveSetting(backingKey ?? key, value));
            },
            enumerable: true,
        });

        return typed;
    }

    public addGetter<K extends string, R>(key: K, getter: (settings: ModernSettings<C>) => R) {
        this.#checkKey(key);
        const typed = this as unknown as ModernSettings<C & Readonly<Record<K, R>>> & C & Readonly<Record<K, R>>;

        Object.defineProperty(this, key, {
            get: () => getter(typed),
            enumerable: true,
        });

        return typed;
    }

    /**
     * Prevents further properties from being added.
     *
     * This is typically called once all `addProperty` calls are complete,
     * ensuring the settings schema is fixed.
     *
     * @returns The settings instance.
     */
    public finalize() {
        this.#finalized = true;
        return this;
    }
}

export enum BulkDownloadMethod {
    Zip = 'zip',
    Folder = 'folder',
    Individual = 'individual',
    LocalMedia = 'local',
}

export const modernSettings = new ModernSettings()
    .addProperty('bulkDownloadFolder', null as FileSystemDirectoryHandle | null)
    .addProperty('forceZipBlob', false, {
        legacy: {
            key: 'bulk-download-force-zip-blob',
            transformer: Boolean,
        },
    })
    .addProperty('rememberBulkDownloadFolder', false, {
        legacy: {
            key: 'bulk-download-remember-folder',
            transformer: Boolean,
        },
    })
    .addProperty('downloadSinglesToFolder', false, {
        legacy: {
            key: 'bulk-download-single-to-folder',
            transformer: Boolean,
        },
    })
    .addProperty('force-individual-downloads', false, {
        legacy: {
            transformer: Boolean,
        },
    })
    .addProperty('bulkDownloadMethod', 'zip' as BulkDownloadMethod, {
        getter: (stored, settings) => {
            try {
                if (stored && Object.values(BulkDownloadMethod).includes(stored)) {
                    return stored;
                }

                const legacy = settings['force-individual-downloads'];
                if (legacy) {
                    settings['force-individual-downloads'] = false;
                    return (settings.bulkDownloadMethod = BulkDownloadMethod.Individual);
                }

                return BulkDownloadMethod.Zip;
            } catch {
                return BulkDownloadMethod.Zip;
            }
        },
    })
    .addProperty('folderTemplate', '', {
        getter: (stored) => stored || '{albumTitle} - {albumArtist}',
        legacy: {
            key: 'zip-folder-template',
            transformer: String,
        },
    })
    .addProperty('filenameTemplate', '', {
        getter: (stored) => stored || '{trackNumber} - {artist} - {title}',
        legacy: {
            key: 'filename-template',
            transformer: String,
        },
    })
    .addProperty('writeArtistsSeparately', false)
    .finalize() as ModernSettings & {
    /** The last used directory handle for bulk downloads */
    bulkDownloadFolder: FileSystemDirectoryHandle | null;

    /** Force ZIP blobs for bulk downloads even if file system APIs are available */
    forceZipBlob: boolean;

    /** Whether the Folder Picker should remember the last-used directory handle */
    rememberBulkDownloadFolder: boolean;

    /**
     * Whether single-track downloads should be routed to the configured
     * folder (saved Folder Picker handle or Local Media Folder path)
     * instead of triggering a browser download.
     */
    downloadSinglesToFolder: boolean;

    /** The selected bulk download method */
    bulkDownloadMethod: BulkDownloadMethod;

    /** Path template for bulk downloads */
    folderTemplate: string;

    /** Filename template for downloads */
    filenameTemplate: string;

    /** Whether to write multiple artists to downloaded files */
    writeArtistsSeparately: boolean;
};
