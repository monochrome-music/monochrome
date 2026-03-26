package tf.monochrome.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.session.MediaSessionCompat;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.MediaBrowserServiceCompat;

import java.util.ArrayList;
import java.util.List;

public class MediaPlaybackService extends MediaBrowserServiceCompat {
    private static final String CHANNEL_ID = "monochrome_media_playback";
    private static final int NOTIFICATION_ID = 101;
    private MediaSessionCompat mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();

        // Create MediaSession
        mediaSession = new MediaSessionCompat(this, "MonochromeMediaService");
        setSessionToken(mediaSession.getSessionToken());
        mediaSession.setActive(true);

        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Monochrome Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows what is currently playing");
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void showNotification() {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Monochrome Music")
                .setContentText("Listening to music")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        startForeground(NOTIFICATION_ID, notification);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        showNotification();
        return START_STICKY;
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        // Allow all apps (including Android Auto) to browse our root
        return new BrowserRoot("root", null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        // Return an empty list for now (Browsing library from car dash not yet implemented)
        result.sendResult(new ArrayList<>());
    }

    @Override
    public void onDestroy() {
        mediaSession.release();
        super.onDestroy();
    }
}
