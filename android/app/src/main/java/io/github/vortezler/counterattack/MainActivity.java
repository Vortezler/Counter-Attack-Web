package io.github.vortezler.counterattack;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

/**
 * Hosts the WebGL game edge to edge in landscape. The status and navigation bars stay hidden
 * (a swipe from an edge shows them briefly) so no system UI covers the game or catches touches,
 * and the screen stays awake during a match.
 *
 * The page draws under any camera cutout. Older Android WebViews report zero for the CSS
 * safe-area insets, so the cutout size is also published as --cutout-* custom properties.
 */
public class MainActivity extends BridgeActivity {

    private Insets cutout = Insets.NONE;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            Insets next = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            if (!next.equals(cutout)) {
                cutout = next;
                publishCutout();
            }
            return ViewCompat.onApplyWindowInsets(view, insets);
        });
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    publishCutout();
                }
            }
        );
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Android restores the bars after dialogs, the notification shade or app switching.
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void publishCutout() {
        if (bridge == null || bridge.getWebView() == null) return;
        float density = getResources().getDisplayMetrics().density;
        String script = String.format(
            Locale.US,
            "(function(d){if(!d)return;var s=d.style;s.setProperty('--cutout-top','%.1fpx');" +
            "s.setProperty('--cutout-right','%.1fpx');s.setProperty('--cutout-bottom','%.1fpx');" +
            "s.setProperty('--cutout-left','%.1fpx');dispatchEvent(new Event('resize'));})(document.documentElement)",
            cutout.top / density,
            cutout.right / density,
            cutout.bottom / density,
            cutout.left / density
        );
        bridge.executeOnMainThread(() -> bridge.getWebView().evaluateJavascript(script, null));
    }
}
