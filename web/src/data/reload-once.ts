/** sessionStorage key set while the page reloads once after a `schemaVersion` mismatch. */
export const RELOAD_FLAG = 'bgtsearch.schema-reload';

export interface ReloadServices {
	/** Returns the session storage; may throw (blocked storage, private mode). */
	storage: () => Storage;
	reload: () => void;
}

export const defaultReloadServices: ReloadServices = {
	storage: () => sessionStorage,
	reload: () => location.reload(),
};

/**
 * Reloads the page once per session to pick up a newer app build. Returns true when it reloads;
 * false when the flag is already set or storage throws (the caller then shows the load error).
 */
export function reloadOnce({ storage, reload }: ReloadServices = defaultReloadServices): boolean {
	try {
		const store = storage();
		if (store.getItem(RELOAD_FLAG) !== null) return false;
		store.setItem(RELOAD_FLAG, '1');
	} catch {
		return false;
	}
	reload();
	return true;
}

/** Clears the flag after a successful load, so a later mismatch may reload again. */
export function clearReloadFlag(storage: ReloadServices['storage'] = defaultReloadServices.storage): void {
	try {
		storage().removeItem(RELOAD_FLAG);
	} catch {
		// Storage unavailable: nothing to clear.
	}
}
