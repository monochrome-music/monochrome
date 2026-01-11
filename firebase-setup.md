# Setting Up Firebase Sync for Monochrome

Follow these steps to enable cross-device synchronization for your library, history, and settings using your own Firebase project.

## 1. Create a Firebase Project

1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Click **Add project** and give it a name (e.g., "Monochrome Sync").
3.  (Optional) Disable Gemini and Google Analytics if you want to keep it simple.
4.  Click **Create project**.

## 2. Enable Authentication

1.  In the left sidebar, click **Build** > **Authentication**.
2.  Click **Get Started**.
3.  Go to the **Sign-in method** tab.
4.  Select **Google** and enable it.
5.  Set your project support email and click **Save**.

### 2.1 Authorized Domains (CRITICAL)

Firebase will block login attempts from unknown domains.

1.  In the **Authentication** section, go to the **Settings** tab.
2.  Click **Authorized domains** in the left sub-menu.
3.  Click **Add domain**.
4.  Add your hosting domain (e.g., `julienmaille.github.io`).
    - _Note: `localhost` and `127.0.0.1` are usually added by default for local testing._

## 3. Enable Realtime Database

1.  In the left sidebar, click **Build** > **Realtime Database**.
2.  Click **Create Database**.
3.  Choose a location near you and click **Next**.
4.  Select **Start in test mode** (we will change the rules in the next step) and click **Enable**.

## 4. Set Security Rules

1.  In the Realtime Database section, go to the **Rules** tab.
2.  Replace the existing rules with the following to ensure users can only see their own data:

    ```json
    {
        "rules": {
            "users": {
                "$uid": {
                    ".read": "$uid === auth.uid",
                    ".write": "$uid === auth.uid"
                }
            },
            "public_playlists": {
                ".read": true,
                "$playlistId": {
                    ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid)"
                }
            }
        }
    }
    ```

    - **Note:** The `public_playlists` rule allows anyone to read the playlists. The write rule ensures that only authenticated users can publish, and only the owner (creator) of a playlist can modify or delete it.

3.  Click **Publish**.

## 5. Get Your Configuration

1.  Click the gear icon (⚙️) next to "Project Overview" and select **Project settings**.
2.  In the **General** tab, scroll down to "Your apps" and click the **Web icon (`</>`)**.
3.  Register the app (e.g., "Monochrome App").
4.  You will see a `firebaseConfig` object. It looks like this:
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
5.  **Copy only the part with the curly braces `{ ... }`**.

## 6. Configure Monochrome

1.  Open the Monochrome app and go to **Settings**.
2.  Find the **Firebase Configuration** section.
3.  Paste the JSON object you copied into the textarea.
4.  Click **Save & Reload**.
5.  Under **Sync & Backup**, click **Connect with Google** and sign in.

**Your library is now synced to the cloud!** Log in on any other device with the same configuration to see your music everywhere.
