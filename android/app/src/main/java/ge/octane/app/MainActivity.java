package ge.octane.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ObdWifiPlugin.class);
        registerPlugin(DashcamWifiPlugin.class);
        super.onCreate(savedInstanceState);
        // ტელეფონის დიდი შრიფტის პარამეტრი აპის ტექსტს არ ადიდებს - დიზაინი ყველა ტელეფონზე ერთნაირად ეტევა
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setTextZoom(100);
        }

        // ღია დიზაინი: საათის/ნავიგაციის ზოლი აპის ფონის ფერისაა, ხატულები - მუქი
        int bg = android.graphics.Color.parseColor("#EDEFF2");
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        androidx.core.view.WindowInsetsControllerCompat ic =
                androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        ic.setAppearanceLightStatusBars(true);
        ic.setAppearanceLightNavigationBars(true);

        // უკან ღილაკი: ჯერ აპი ხურავს ღია ფანჯარას / გვერდს (window.octaneBack, dashcam.js), მერე - აპს
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || getBridge().getWebView() == null) { exitApp(); return; }
                getBridge().getWebView().evaluateJavascript(
                        "(function(){try{return window.octaneBack&&window.octaneBack()?1:0}catch(e){return 0}})()",
                        v -> { if (!"1".equals(v)) exitApp(); });
            }

            private void exitApp() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
