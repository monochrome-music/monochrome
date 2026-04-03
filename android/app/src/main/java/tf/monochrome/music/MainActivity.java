package tf.monochrome.music;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import com.getcapacitor.BridgeActivity;
import com.monochrome.android.MusicService;

public class MainActivity extends BridgeActivity {

    private MusicService musicService;
    private boolean serviceBound = false;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            musicService = ((MusicService.LocalBinder) binder).getService();
            serviceBound = true;
            // Give MusicService access to Capacitor's WebView so it can trigger JS
            if (getBridge() != null) {
                musicService.attachWebView(getBridge().getWebView());
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            serviceBound = false;
            musicService = null;
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent serviceIntent = new Intent(this, MusicService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    @Override
    protected void onDestroy() {
        if (serviceBound) {
            if (musicService != null) musicService.detachWebView();
            unbindService(serviceConnection);
            serviceBound = false;
        }
        super.onDestroy();
    }
}
