package ge.octane.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import android.os.PatternMatcher;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Octane App - სკანერის WiFi-სთან ავტომატური დაკავშირება (Android 10+).
 *
 * ტელეფონს ვთხოვთ დაუკავშირდეს ქსელს, რომლის სახელშიც "OBD" წერია.
 * Android აჩვენებს ერთ სისტემურ ფანჯარას, მომხმარებელი ირჩევს სკანერს -
 * და "ინტერნეტი არ არის, დარჩეთ?" შეტყობინება აღარ ამოდის.
 * შემდეგ მთელ აპს ამ ქსელზე "ვაბამთ", რომ არსებული TCP კოდი
 * (chrome.sockets.tcp → 192.168.0.10:35000) უცვლელად იმუშაოს.
 */
@CapacitorPlugin(name = "ObdWifi")
public class ObdWifiPlugin extends Plugin {

    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback callback;
    private Network obdNetwork;

    @Override
    public void load() {
        cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        call.resolve(r);
    }

    @PluginMethod
    public void connect(final PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("UNSUPPORTED");
            return;
        }
        releaseInternal();

        String pattern = call.getString("pattern", ".*OBD.*");
        WifiNetworkSpecifier spec = new WifiNetworkSpecifier.Builder()
                .setSsidPattern(new PatternMatcher(pattern, PatternMatcher.PATTERN_SIMPLE_GLOB))
                .build();

        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(spec)
                .build();

        final boolean[] answered = {false};

        callback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                obdNetwork = network;
                cm.bindProcessToNetwork(network);
                if (!answered[0]) {
                    answered[0] = true;
                    JSObject r = new JSObject();
                    r.put("connected", true);
                    call.resolve(r);
                }
            }

            @Override
            public void onUnavailable() {
                // მომხმარებელმა გააუქმა, ან 60 წამში სკანერი ვერ მოიძებნა
                callback = null;
                if (!answered[0]) {
                    answered[0] = true;
                    call.reject("UNAVAILABLE");
                }
            }

            @Override
            public void onLost(Network network) {
                if (network.equals(obdNetwork)) {
                    cm.bindProcessToNetwork(null);
                    obdNetwork = null;
                    notifyListeners("lost", new JSObject());
                }
            }
        };

        cm.requestNetwork(request, callback, 60000);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        releaseInternal();
        call.resolve();
    }

    private void releaseInternal() {
        if (cm == null) return;
        cm.bindProcessToNetwork(null);
        if (callback != null) {
            try { cm.unregisterNetworkCallback(callback); } catch (Exception ignored) {}
            callback = null;
        }
        obdNetwork = null;
    }

    @Override
    protected void handleOnDestroy() {
        releaseInternal();
    }
}
