/**
 * GuestbookStorage — abstract interface.
 *
 * Entry shape:
 * {
 *   id:         string,   // e.g. "2026-03-22-anna"
 *   name:       string,
 *   botschaft:  string,
 *   imagePaths: string[], // e.g. "images/2026-03-22-anna-1.jpg"
 *   createdAt:  string,   // ISO 8601
 *   updatedAt?: string,   // ISO 8601, set on edits
 * }
 *
 * listEntries()                                   → [{ id, createdAt }]
 * getEntry(id)                                    → full entry object
 * saveEntry(fields, files[])                      → id, persists new entry
 * updateEntry(id, fields, keepImagePaths, newFiles) → updated entry, edits in place
 * resolveImageUrl(path)                           → Promise<string> for <img src>
 */
class GuestbookStorage {
  async listEntries()                                       { throw new Error('Not implemented'); }
  async getEntry(id)                                        { throw new Error('Not implemented'); }
  async saveEntry(fields, imageFiles)                       { throw new Error('Not implemented'); }
  async updateEntry(id, fields, keepImagePaths, newFiles)   { throw new Error('Not implemented'); }
  async deleteEntry(id)                                     { throw new Error('Not implemented'); }
  async resolveImageUrl(path)                               { throw new Error('Not implemented'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub implementation
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_MAX_WIDTH = 800;  // px
const IMAGE_TARGET_KB = 200;  // KB

class GitHubStorage extends GuestbookStorage {
  #owner; #repo; #token;

  /**
   * @param {{ owner: string, repo: string, token: string }} config
   */
  constructor({ owner, repo, token }) {
    super();
    this.#owner = owner;
    this.#repo  = repo;
    this.#token = token;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Returns [{ id, createdAt }] sorted newest-first. */
  async listEntries() {
    // Cache-bust the listing — the freshness-sensitive call. Individual
    // entry/image fetches keep their normal cache behavior (with no-cache
    // revalidation in #apiCall).
    const files = await this.#apiCall('GET', `entries?t=${Date.now()}`).catch(err => {
      if (err.message.includes('404')) return []; // entries/ doesn't exist yet
      throw err;
    });
    return files
      .filter(f => f.name.endsWith('.json'))
      .map(f => ({ id: f.name.replace('.json', ''), createdAt: this.#idToDate(f.name) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Returns the full entry object for a given id. */
  async getEntry(id) {
    const file = await this.#apiCall('GET', `entries/${id}.json`);
    return JSON.parse(this.#decodeBase64Utf8(file.content));
  }

  /**
   * Compresses images, uploads everything, returns the new entry id.
   * @param {{ name, botschaft }} fields
   * @param {File[]} imageFiles
   */
  async saveEntry(fields, imageFiles = []) {
    const id        = this.#generateId(fields.name);
    const createdAt = new Date().toISOString();

    // 1. Compress + upload images sequentially (GitHub API rejects concurrent writes)
    const imagePaths = [];
    for (let i = 0; i < imageFiles.length; i++) {
      imagePaths.push(await this.#uploadImage(imageFiles[i], id, i + 1));
    }

    // 2. Build + upload entry JSON
    const entry = { id, ...fields, imagePaths, createdAt };
    await this.#putFile(
      `entries/${id}.json`,
      JSON.stringify(entry, null, 2),
      `Add guestbook entry: ${fields.name}`
    );

    return id;
  }

  /**
   * Updates an existing entry: replaces text fields, removes images not in
   * keepImagePaths, uploads new ones, and writes the entry JSON back.
   * Image indexes always increment from the previous max to avoid stale-cache
   * collisions with deleted-then-re-added slots.
   *
   * @param {string} id
   * @param {{ name, botschaft }} fields
   * @param {string[]} keepImagePaths  subset of the entry's current imagePaths
   * @param {File[]}   newImageFiles
   */
  async updateEntry(id, fields, keepImagePaths = [], newImageFiles = []) {
    const entryPath = `entries/${id}.json`;
    const existingFile = await this.#apiCall('GET', entryPath);
    const current = JSON.parse(this.#decodeBase64Utf8(existingFile.content));

    const removed = current.imagePaths.filter(p => !keepImagePaths.includes(p));
    for (const path of removed) {
      await this.#deleteFile(path, `Remove image from ${id}`);
    }

    const nextIndex = this.#nextImageIndex(current.imagePaths);
    const newPaths = [];
    for (let i = 0; i < newImageFiles.length; i++) {
      newPaths.push(await this.#uploadImage(newImageFiles[i], id, nextIndex + i));
    }

    const updated = {
      ...current,
      ...fields,
      imagePaths: [...keepImagePaths, ...newPaths],
      updatedAt: new Date().toISOString(),
    };
    await this.#putFile(entryPath, JSON.stringify(updated, null, 2),
      `Update guestbook entry: ${fields.name}`, existingFile.sha);

    return updated;
  }

  /** Deletes an entry and all its images. Tolerant of already-missing images. */
  async deleteEntry(id) {
    const entryPath = `entries/${id}.json`;
    const file      = await this.#apiCall('GET', entryPath);
    const current   = JSON.parse(this.#decodeBase64Utf8(file.content));

    for (const path of current.imagePaths ?? []) {
      await this.#deleteFile(path, `Remove image from deleted entry ${id}`)
        .catch(err => console.warn(`Could not delete ${path}:`, err));
    }

    await this.#apiCall('DELETE', entryPath, {
      message: `Delete guestbook entry: ${current.name}`,
      sha:     file.sha,
    });
  }

  /**
   * Fetches a repo-relative image path via API and returns a blob: URL.
   * @param {string} path  e.g. "images/2026-03-22-anna-1.jpg"
   * @returns {Promise<string>}
   */
  async resolveImageUrl(path) {
    const file  = await this.#apiCall('GET', path);
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Compresses, uploads, returns the repo-relative path. */
  async #uploadImage(file, entryId, index) {
    const compressed = await this.#compressImage(file);
    const path       = `images/${entryId}-${index}.jpg`;
    const b64        = await this.#blobToBase64(compressed);
    await this.#putFileBinary(path, b64, `Add image ${index} for ${entryId}`);
    return path;
  }

  async #compressImage(file) {
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale  = Math.min(1, IMAGE_MAX_WIDTH / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        const attempt = (quality) => {
          canvas.toBlob(blob => {
            if (blob.size > IMAGE_TARGET_KB * 1024 && quality > 0.3) {
              attempt(parseFloat((quality - 0.1).toFixed(1)));
            } else {
              resolve(blob);
            }
          }, 'image/jpeg', quality);
        };
        attempt(0.85);
      };
      img.src = url;
    });
  }

  #blobToBase64(blob) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  async #putFile(path, text, message, sha = null) {
    const content = btoa(unescape(encodeURIComponent(text))); // UTF-8 safe
    const body = sha ? { message, content, sha } : { message, content };
    await this.#apiCall('PUT', path, body);
  }

  async #putFileBinary(path, base64Content, message) {
    await this.#apiCall('PUT', path, { message, content: base64Content });
  }

  async #deleteFile(path, message) {
    const file = await this.#apiCall('GET', path);
    await this.#apiCall('DELETE', path, { message, sha: file.sha });
  }

  #decodeBase64Utf8(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  #nextImageIndex(imagePaths) {
    const max = imagePaths.reduce((m, p) => {
      const match = p.match(/-(\d+)\.jpg$/);
      return match ? Math.max(m, parseInt(match[1], 10)) : m;
    }, 0);
    return max + 1;
  }

  async #apiCall(method, path, body = null) {
    const url = `https://api.github.com/repos/${this.#owner}/${this.#repo}/contents/${path}`;
    const res = await fetch(url, {
      method,
      cache: 'no-cache', // revalidate with GitHub via ETag instead of trusting the 60s max-age
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept:        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${err.message ?? res.statusText}`);
    }
    return res.json();
  }

  #generateId(name) {
    const date   = new Date().toISOString().slice(0, 10);
    const slug   = name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    const rand   = Math.random().toString(36).slice(2, 6);
    return `${date}-${slug}-${rand}`;
  }

  #idToDate(filename) {
    const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? `${match[1]}T00:00:00.000Z` : new Date(0).toISOString();
  }
}
