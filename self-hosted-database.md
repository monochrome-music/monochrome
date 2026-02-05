# Self-Hosted Database Setup Guide

This guide will show you how to set up your own authentication system and database for Monochrome accounts.

> ⚠️ **Note:** You will need to enter the same configurations on each device where you want to use your custom database.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Setup Firebase Authentication](#step-1-setup-firebase-authentication)
- [Step 2: PocketBase Setup](#step-2-pocketbase-setup)
- [Step 3: Cloudflare Tunnel Setup](#step-3-cloudflare-tunnel-setup)
- [Step 4: Getting Configurations](#step-4-getting-configurations)
- [Step 5: Linking with Monochrome](#step-5-linking-with-monochrome)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- A computer to host the database (can also use a VPS)
- A [Firebase](https://firebase.google.com) account (for authentication only)
- [PocketBase](https://pocketbase.io) installed on your host machine
- A domain name (free options available at [DigitalPlat](https://domain.digitalplat.org/))

> 💡 **This guide assumes you're setting everything up on your local machine. The process is identical for a VPS.**

---

## Step 1: Setup Firebase Authentication

### 1.1 Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. On the left sidebar, click **Build** → **Authentication**
4. Click **Get Started**

### 1.2 Enable Sign-in Methods

1. Go to the **Sign-in method** tab
2. Enable **Google** and **Email** providers
3. Set your project support email
4. Click **Save**

### 1.3 Authorize Your Domain

Firebase requires authorized domains for authentication:

1. In **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain**
3. Add your hosting domain:
    - If using the official Monochrome site: `monochrome.samidy.com` or your preferred mirror (e.g., `monochrome.tf`)
    - If self-hosting the website: add your custom domain

> 💡 `localhost` is usually added by default for local testing. You can leave this enabled.

---

## Step 2: PocketBase Setup

### 2.1 Install and Configure

1. Download [PocketBase](https://pocketbase.io) and follow their setup guide
2. Access the PocketBase Admin UI (typically at `http://127.0.0.1:8090/_/`)

### 2.2 Create Collections

Create two collections: `DB_users` and `public_playlists` (do NOT use the default "users" collection)

#### DB_users Fields

| Field Name          | Type       | Description               |
| ------------------- | ---------- | ------------------------- |
| `firebase_id`       | Plain Text | Links to Firebase user ID |
| `lastUpdated`       | Number     | Timestamp of last update  |
| `history`           | JSON       | User listening history    |
| `library`           | JSON       | User's saved library      |
| `user_playlists`    | JSON       | User's custom playlists   |
| `user_folders`      | JSON       | User's playlist folders   |
| `deleted_playlists` | JSON       | Soft-deleted playlists    |

#### public_playlists Fields

| Field Name       | Type       | Description                |
| ---------------- | ---------- | -------------------------- |
| `firebase_id`    | Plain Text | Creator's Firebase user ID |
| `addedAt`        | Number     | Creation timestamp         |
| `numberOfTracks` | Number     | Total track count          |
| `OriginalId`     | Plain Text | Original playlist ID       |
| `publishedAt`    | Number     | Publication timestamp      |
| `title`          | Plain Text | Playlist title             |
| `uid`            | Plain Text | Unique identifier          |
| `uuid`           | Plain Text | UUID for the playlist      |
| `tracks`         | JSON       | Playlist tracks data       |
| `image`          | URL        | Playlist cover image       |

### 2.3 Configure API Rules

Set the API rules for both collections to allow read/write access:

**DB_users API Rules:**

- List/Search Rule: `firebase_id = @request.query.f_id`
- View Rule: `firebase_id = @request.query.f_id`
- Create Rule: `firebase_id = @request.query.f_id`
- Update Rule: `firebase_id = @request.query.f_id`
- Delete Rule: `firebase_id = @request.query.f_id`

**public_playlists API Rules:**

- List/Search Rule: `uuid = @request.query.p_id`
- View Rule: `id != ""`
- Create Rule: `firebase_id = @request.query.f_id`
- Update Rule: `uid = @request.query.f_id`
- Delete Rule: `uid = @request.query.f_id`

---

## Step 3: Cloudflare Tunnel Setup

To make your PocketBase instance accessible from other devices securely:

### 3.1 Create a Cloudflare Account

1. Sign up at the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Set up **Zero Trust** (free plan available)

### 3.2 Create a Tunnel

1. In the Cloudflare dashboard, go to **Zero Trust** → **Networks** → **Connectors**
2. Select **Cloudflared**
3. Give your tunnel a name (e.g., `monochrome-database`)
4. Follow the installation guide for your operating system

### 3.3 Configure Hostname

1. In the tunnel setup, add a **Public Hostname**
2. **Subdomain:** Choose a subdomain (e.g., `db` for `db.yourdomain.com`)
3. **Domain:** Select your domain from the dropdown
4. **Service:** Select **HTTP**
5. **URL:** Enter your PocketBase local address (e.g., `127.0.0.1:8090`)

> ⚠️ **Note:** Cloudflare requires a valid domain. Free `.pages.dev` domains won't work for this. Get a free domain at [DigitalPlat](https://domain.digitalplat.org/).

6. Save the configuration

Your database will now be accessible at your chosen domain!

---

## Step 4: Getting Configurations

### 4.1 Get Firebase Configuration

1. In the [Firebase Console](https://console.firebase.google.com), open your project
2. Click the **⚙️ Settings** icon next to "Project Overview"
3. Select **Project settings**
4. In the **General** tab, scroll to "Your apps"
5. Click the **Web icon** (`</>`)
6. Register your app (e.g., "Monochrome Auth")
7. Copy the `firebaseConfig` object:

```javascript
const firebaseConfig = {
    apiKey: 'AIzaSy...',
    authDomain: 'your-project.firebaseapp.com',
    databaseURL: 'https://your-project.firebaseio.com',
    projectId: 'your-project',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '...',
    appId: '...',
};
```

> ⚠️ **Copy only the object content inside the curly braces `{ ... }`**

### 4.2 Get Database URL

Simply copy your PocketBase domain from Cloudflare (e.g., `https://db.yourdomain.com`)

---

## Step 5: Linking with Monochrome

Now configure Monochrome to use your custom backend:

1. Open Monochrome in your browser
2. Go to **Settings** (gear icon)
3. Click **ADVANCED: Custom Account Database**
4. Enter your configurations:
    - **Database Config:** Your PocketBase domain (e.g., `https://db.yourdomain.com`)
    - **Authentication Config:** The Firebase config JSON object from Step 4.1
5. Click **Save**

✅ **Done!** Your Monochrome instance is now connected to your custom database.

> 📝 **Important:** Repeat Step 5 on every device where you want to use your custom database.

---

## Troubleshooting

### Cannot sign in

- Ensure your domain is added to Firebase's authorized domains
- Check that the Firebase config JSON is correctly formatted

### Database connection errors

- Verify your Cloudflare tunnel is running
- Check that PocketBase is accessible at your domain
- Ensure API rules are configured correctly

### Data not syncing

- Make sure you're signed in with the same account on all devices
- Check the browser console for error messages
- Verify your database collections have the correct fields

---

## Security Tips

- Keep your Firebase API key secure (it's okay to expose it for client-side auth, but don't share it unnecessarily)
- Regularly backup your PocketBase database
- Use strong, unique passwords for your Cloudflare and Firebase accounts
- Consider enabling 2FA on all accounts

---

## Need Help?

- Join our [Discord community](https://monochrome.tf/discord) (if available)
- Open an issue on [GitHub](https://github.com/SamidyFR/monochrome/issues)
- Check existing [GitHub issues](https://github.com/SamidyFR/monochrome/issues) for solutions
