package com.kazuma.firstgame;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * True fullscreen: the status and navigation bars are hidden and the WebView
 * draws edge to edge, so the game gets the whole panel on a phone. The bars
 * come back as a transient overlay on a swipe from the edge and hide again on
 * their own, which is why we re-apply on every focus gain - leaving the app,
 * an ad overlay, or the interstitial all hand focus back with the bars shown.
 *
 * The page compensates for the notch/gesture area itself via viewport-fit=cover
 * and the safe-area-inset-* paddings in styles.css.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        goImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    private void goImmersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (c != null) {
            c.hide(WindowInsetsCompat.Type.systemBars());
            c.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }
}
