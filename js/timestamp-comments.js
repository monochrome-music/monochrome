// js/timestamp-comments.js
// SoundCloud-style timestamped comments on tracks
// Stores comments locally with IndexedDB, displays as markers on the seekbar

import { openDB } from './db.js';

const DB_STORE = 'timestamp-comments';

export class TimestampComments {
  constructor() {
    this.comments = [];
    this.currentTrackId = null;
    this.dbReady = false;
  }

  async init() {
    try {
      this.db = await this._getDB();
      this.dbReady = true;
    } catch (e) {
      console.warn('[TimestampComments] DB init failed, using memory:', e);
      this.db = null;
    }
  }

  async _getDB() {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('aether-comments', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          const store = db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('trackId', 'trackId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async loadComments(trackId) {
    this.currentTrackId = trackId;
    if (!this.db) {
      this.comments = [];
      return this.comments;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const index = store.index('trackId');
      const req = index.getAll(trackId);
      req.onsuccess = () => {
        this.comments = req.result || [];
        this.comments.sort((a, b) => a.timestamp - b.timestamp);
        this._dispatchEvent('comments-loaded');
        resolve(this.comments);
      };
      req.onerror = () => {
        this.comments = [];
        resolve([]);
      };
    });
  }

  async addComment(trackId, timestamp, text, username = 'You') {
    const comment = {
      trackId,
      timestamp,
      text: text.trim(),
      username,
      createdAt: Date.now(),
    };
    if (!comment.text) return null;
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        const req = store.add(comment);
        req.onsuccess = () => {
          comment.id = req.result;
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      comment.id = Date.now();
    }
    this.comments.push(comment);
    this.comments.sort((a, b) => a.timestamp - b.timestamp);
    this._dispatchEvent('comment-added', comment);
    return comment;
  }

  async deleteComment(commentId) {
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        const req = store.delete(commentId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
    this.comments = this.comments.filter(c => c.id !== commentId);
    this._dispatchEvent('comment-deleted', { id: commentId });
  }

  getCommentsAtTime(time, tolerance = 2) {
    return this.comments.filter(c =>
      Math.abs(c.timestamp - time) <= tolerance
    );
  }

  getCommentMarkers(duration) {
    if (!duration || duration <= 0) return [];
    return this.comments.map(c => ({
      id: c.id,
      position: (c.timestamp / duration) * 100,
      timestamp: c.timestamp,
      text: c.text,
      username: c.username,
    }));
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async clearTrackComments(trackId) {
    if (this.db) {
      const comments = await this.loadComments(trackId);
      const tx = this.db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      for (const c of comments) {
        store.delete(c.id);
      }
    }
    this.comments = [];
    this._dispatchEvent('comments-cleared');
  }

  _dispatchEvent(name, detail = null) {
    window.dispatchEvent(new CustomEvent(`timestamp-${name}`, {
      detail: detail || { trackId: this.currentTrackId, comments: this.comments }
    }));
  }

  destroy() {
    this.comments = [];
    this.currentTrackId = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
