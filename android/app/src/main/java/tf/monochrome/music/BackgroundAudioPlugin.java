package tf.monochrome.music;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin that exposes start/stop controls for the foreground
 * AudioPlaybackService. Called from JS when audio playback begins or ends
 * so Android keeps the process alive in the background.
 */
@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), AudioPlaybackService.class);
            intent.setAction("START");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to start audio service: " + e.getMessage(), e);
        }
    }

    `@PluginMethod`
    public void stop(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), AudioPlaybackService.class);
            intent.setAction("STOP");
            // Use startService so onStartCommand receives the STOP action
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to stop audio service: " + e.getMessage(), e);
        }
    }
}
