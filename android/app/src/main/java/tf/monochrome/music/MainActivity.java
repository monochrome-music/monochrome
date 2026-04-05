package tf.monochrome.music;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
