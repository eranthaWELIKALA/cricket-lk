package com.eranthawelikala.cricketlk;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // What the WebView can't do on its own (share, save, print): see mobile/web/native-bridge.js.
        registerPlugin(CricketNativePlugin.class);
        // Draw behind the system bars on every Android version (Android 15+ always does); the page
        // keeps clear of them with env(safe-area-inset-*) (SystemBars insetsHandling "native").
        // Light icons to start with, for the default dark theme; native-bridge.js follows the theme.
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
        super.onCreate(savedInstanceState);

        // The app handles back itself, through its page history (js/ui/router.js: closes the top sheet,
        // asks before leaving live scoring, ...). BridgeActivity has no back handling, so without this
        // back would close the app from any screen. At the first page (Home) it leaves the app as usual.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
