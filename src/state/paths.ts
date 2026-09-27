/**
 * Path helpers. Vault paths always use "/" regardless of the host OS, so these
 * never touch node's `path` module.
 */

/** `true` when `path` is `ancestor` itself or lives underneath it. */
export function isSameOrDescendant(path: string, ancestor: string): boolean {
	if (ancestor === "/" || ancestor === "") return true;
	return path === ancestor || path.startsWith(ancestor + "/");
}

/**
 * Rewrites a path that was located at (or under) `oldPath` so it points at the
 * matching location under `newPath`. Returns `null` when unrelated.
 */
export function remapPath(path: string, oldPath: string, newPath: string): string | null {
	if (path === oldPath) return newPath;
	if (path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
	return null;
}

/** Parent folder path of a vault path; the root is represented as "/". */
export function parentPath(path: string): string {
	const index = path.lastIndexOf("/");
	return index <= 0 ? "/" : path.slice(0, index);
}

/** Joins a parent folder path with a child name, handling the vault root. */
export function joinPath(parent: string, name: string): string {
	return parent === "/" || parent === "" ? name : `${parent}/${name}`;
}

/**
 * The items of a set that no other item in it already contains.
 *
 * A folder travels with everything inside it, so a selection holding both a
 * folder and its contents means one thing to move, not several. Acting on the
 * contents separately would take them out of the folder they are in and
 * flatten what the user picked — which is what an expanded folder makes easy
 * to select by accident.
 */
export function outermost<T extends { path: string }>(files: T[]): T[] {
	return files.filter(
		(file) => !files.some((other) => other !== file && isSameOrDescendant(file.path, other.path)),
	);
}
