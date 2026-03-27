// js/accounts/rbac.js
// Role-Based Access Control (RBAC) System for Monochrome
// Roles: owner > admin > user

import { Databases, ID, Query, Teams } from 'appwrite';
import { client } from './config.js';
import { authManager } from './auth.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  USER: 'user',
};

const DATABASE_ID = 'database-monochrome';
const AUDIT_COLLECTION = 'audit_logs';
const USERS_COLLECTION = 'DB_users';

// Owner UID — set this to the Appwrite $id of the account owner
// Loaded at runtime via window.__OWNER_UID__ or hardcoded fallback
const getOwnerUid = () =>
  window.__OWNER_UID__ ||
  localStorage.getItem('monochrome-owner-uid') ||
  null;

// ─── Role Resolution ──────────────────────────────────────────────────────────

const databases = new Databases(client);

/**
 * Returns the role of a given user.
 * Priority: owner > admin label > user
 */
export async function getUserRole(user) {
  if (!user) return null;

  // 1. Check owner
  const ownerUid = getOwnerUid();
  if (ownerUid && user.$id === ownerUid) return ROLES.OWNER;

  // 2. Check Appwrite labels
  if (Array.isArray(user.labels)) {
    if (user.labels.includes('owner')) return ROLES.OWNER;
    if (user.labels.includes('admin')) return ROLES.ADMIN;
  }

  // 3. Check DB_users role field (fallback for older setups)
  try {
    const result = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
      Query.equal('user_id', user.$id),
      Query.limit(1),
    ]);

    if (result.documents.length > 0) {
      const doc = result.documents[0];
      if (doc.role === 'owner') return ROLES.OWNER;
      if (doc.role === 'admin') return ROLES.ADMIN;
    }
  } catch {}

  return ROLES.USER;
}

/**
 * Returns true if the given role has permission for the action.
 * Permission hierarchy: owner > admin > user
 */
export function hasPermission(role, requiredRole) {
  const hierarchy = [ROLES.USER, ROLES.ADMIN, ROLES.OWNER];
  return hierarchy.indexOf(role) >= hierarchy.indexOf(requiredRole);
}

// ─── RBAC Manager ─────────────────────────────────────────────────────────────

export const rbacManager = {
  _role: null,
  _listeners: [],

  async init() {
    authManager.onAuthStateChanged(async (user) => {
      if (user) {
        this._role = await getUserRole(user);
      } else {
        this._role = null;
      }
      this._listeners.forEach((fn) => fn(this._role));
      this._updateRoleUI();
    });

    // If already signed in
    if (authManager.user) {
      this._role = await getUserRole(authManager.user);
      this._updateRoleUI();
    }
  },

  getRole() {
    return this._role;
  },

  isOwner() {
    return this._role === ROLES.OWNER;
  },

  isAdmin() {
    return this._role === ROLES.ADMIN || this._role === ROLES.OWNER;
  },

  isUser() {
    return this._role !== null;
  },

  onRoleChanged(fn) {
    this._listeners.push(fn);
  },

  // ── Admin Actions ────────────────────────────────────────────────────────────

  /** Promote a user to admin (Owner only) */
  async promoteToAdmin(targetUserId) {
    if (!this.isOwner())
      throw new Error('Only Owner can promote users to Admin.');

    // Update the role field in DB_users
    const result = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
      Query.equal('user_id', targetUserId),
      Query.limit(1),
    ]);

    if (!result.documents.length) throw new Error('User not found.');
    const doc = result.documents[0];

    await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, doc.$id, {
      role: 'admin',
    });

    await this.logAudit('promote_admin', { targetUserId });
  },

  /** Demote admin back to user (Owner only) */
  async demoteFromAdmin(targetUserId) {
    if (!this.isOwner())
      throw new Error('Only Owner can demote Admins.');

    const result = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
      Query.equal('user_id', targetUserId),
      Query.limit(1),
    ]);

    if (!result.documents.length) throw new Error('User not found.');
    const doc = result.documents[0];

    await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, doc.$id, {
      role: 'user',
    });

    await this.logAudit('demote_admin', { targetUserId });
  },

  /** Ban / unban a user (Admin+) */
  async setBanStatus(targetUserId, isBanned) {
    if (!this.isAdmin())
      throw new Error('Only Admin or Owner can ban users.');

    const result = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
      Query.equal('user_id', targetUserId),
      Query.limit(1),
    ]);

    if (!result.documents.length) throw new Error('User not found.');
    const doc = result.documents[0];

    await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, doc.$id, {
      is_banned: isBanned,
      banned_at: isBanned ? new Date().toISOString() : null,
    });

    await this.logAudit(isBanned ? 'ban_user' : 'unban_user', { targetUserId });
  },

  /** Soft-delete a user playlist (Admin+) */
  async softDeletePlaylist(playlistId) {
    if (!this.isAdmin())
      throw new Error('Only Admin or Owner can delete playlists.');

    // Update public_playlists collection with is_deleted = true
    const PUBLIC_COLLECTION = 'public_playlists';
    const result = await databases.listDocuments(DATABASE_ID, PUBLIC_COLLECTION, [
      Query.equal('uuid', playlistId),
      Query.limit(1),
    ]);

    if (result.documents.length > 0) {
      await databases.updateDocument(
        DATABASE_ID,
        PUBLIC_COLLECTION,
        result.documents[0].$id,
        {
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: authManager.user?.$id,
        }
      );
    }

    await this.logAudit('soft_delete_playlist', { playlistId });
  },

  /** Restore a soft-deleted playlist (Admin+) */
  async restorePlaylist(playlistId) {
    if (!this.isAdmin())
      throw new Error('Only Admin or Owner can restore playlists.');

    const PUBLIC_COLLECTION = 'public_playlists';
    const result = await databases.listDocuments(DATABASE_ID, PUBLIC_COLLECTION, [
      Query.equal('uuid', playlistId),
      Query.limit(1),
    ]);

    if (result.documents.length > 0) {
      await databases.updateDocument(
        DATABASE_ID,
        PUBLIC_COLLECTION,
        result.documents[0].$id,
        {
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
        }
      );
    }

    await this.logAudit('restore_playlist', { playlistId });
  },

  /** Get all users (Admin+) — paginated */
  async getAllUsers(page = 1, perPage = 25, search = '') {
    if (!this.isAdmin())
      throw new Error('Only Admin or Owner can view all users.');

    const queries = [
      Query.limit(perPage),
      Query.offset((page - 1) * perPage),
      Query.orderDesc('$createdAt'),
    ];

    if (search) queries.push(Query.search('username', search));

    const result = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION,
      queries
    );

    return result;
  },

  /** Get audit logs (Admin+) */
  async getAuditLogs(page = 1, perPage = 50) {
    if (!this.isAdmin())
      throw new Error('Only Admin or Owner can view audit logs.');

    try {
      const result = await databases.listDocuments(
        DATABASE_ID,
        AUDIT_COLLECTION,
        [
          Query.limit(perPage),
          Query.offset((page - 1) * perPage),
          Query.orderDesc('$createdAt'),
        ]
      );

      return result;
    } catch {
      return { documents: [], total: 0 };
    }
  },

  // ── Audit Trail ──────────────────────────────────────────────────────────────

  /** Write an audit log entry */
  async logAudit(action, meta = {}) {
    const user = authManager.user;
    if (!user) return;

    const payload = {
      actor_id: user.$id,
      actor_email: user.email || '',
      action,
      meta: JSON.stringify(meta),
      timestamp: new Date().toISOString(),
    };

    try {
      await databases.createDocument(
        DATABASE_ID,
        AUDIT_COLLECTION,
        ID.unique(),
        payload
      );
    } catch (e) {
      // Audit table may not exist yet in Appwrite — fail silently
      console.warn('[RBAC] Audit log failed (collection may not exist yet):', e.message);
    }
  },

  // ── UI Helpers ───────────────────────────────────────────────────────────────

  _updateRoleUI() {
    const role = this._role;

    // Show/hide Admin Panel sidebar link
    const adminLinks = document.querySelectorAll('.admin-only');
    adminLinks.forEach((el) => {
      el.style.display = role === ROLES.ADMIN || role === ROLES.OWNER ? '' : 'none';
    });

    // Show/hide Owner-only elements
    const ownerLinks = document.querySelectorAll('.owner-only');
    ownerLinks.forEach((el) => {
      el.style.display = role === ROLES.OWNER ? '' : 'none';
    });

    // Update role badge on profile icon
    this._updateRoleBadge(role);
  },

  _updateRoleBadge(role) {
    // Remove existing badge
    const existing = document.querySelector('.role-badge');
    if (existing) existing.remove();

    if (!role || role === ROLES.USER) return;

    const avatarBtn = document.querySelector(
      '#profile-avatar-btn, .avatar-btn, #nav-profile'
    );
    if (!avatarBtn) return;

    const badge = document.createElement('span');
    badge.className = `role-badge role-badge--${role}`;
    badge.title = role.charAt(0).toUpperCase() + role.slice(1);

    avatarBtn.style.position = 'relative';
    avatarBtn.appendChild(badge);
  },
};

// Auto-init when module is loaded
rbacManager.init();

export default rbacManager;
