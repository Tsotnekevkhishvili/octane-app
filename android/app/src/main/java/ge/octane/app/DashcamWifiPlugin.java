package ge.octane.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaScannerConnection;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import android.os.Environment;
import android.os.PatternMatcher;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Octane App — ვიდეორეგისტრატორის (დეშ ქემის) WiFi და ფაილები.
 *
 * ObdWifi-ს მსგავსად (WifiNetworkSpecifier), ოღონდ დეშ ქემის ქსელისთვის და პაროლით.
 * ObdWifi-ს არ ეხება: JS ჯერ OBD-ს თიშავს, მერე უკავშირდება კამერას.
 *
 *   isSupported()                       → { supported }   (Android 10+)
 *   connect({ ssid?, prefix?, pattern?, password? })  → სისტემური ფანჯარა, მერე აპი „ებმება“ კამერის ქსელს → { ssid }
 *   wifiInfo()                          → { ssid, ip, gateway }   (დიაგნოსტიკისთვის)
 *   shareMany({ paths, mime, title })   → რამდენიმე ფაილის გაგზავნა
 *   openLive({ url, title })            → RTSP ცოცხალი ხედი სრულ ეკრანზე (DashcamLiveActivity)
 *   bindToWifi()                        → ხელით შეერთებულ WiFi-ზე „მიბმა“ (ძველი Android)
 *   disconnect()
 *   request({ url, timeout })           → { status, data }   (CORS-ის გარეშე)
 *   download({ url, fileName })         → { path }   + "downloadProgress" { loaded, total }
 *   saveToGallery({ path, mime, fileName })
 *   share({ path, mime, title })        → სისტემური გაზიარების მენიუ
 *   deleteLocal({ path })
 *   trim({ path, startMs, endMs, fileName }) → { path, startMs, endMs, shiftMs, audioDropped, size }
 */
@CapacitorPlugin(
        name = "DashcamWifi",
        permissions = {
                @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
        }
)
public class DashcamWifiPlugin extends Plugin {

    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback callback;
    private Network camNetwork;
    // ქსელის ოპერაციები (გადმოწერა დიდხანს გრძელდება) - ცალკე ნაკადებზე, რომ სხვა პლაგინები არ შეფერხდეს
    private final ExecutorService io = Executors.newFixedThreadPool(3);

    // ლოკალური „შუამავალი“ - WebView კამერის ფაილებს (ესკიზები, ვიდეოები) მისი გავლით ხსნის
    private DashcamProxy proxy;

    @Override
    public void load() {
        cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        proxy = new DashcamProxy(this::open);
    }

    /** → { base: "http://127.0.0.1:PORT" } ; WebView-ში ფაილის მისამართი: base + "/http/" + host + path */
    @PluginMethod
    public void proxyBase(PluginCall call) {
        int port = proxy != null ? proxy.start() : 0;
        if (port <= 0) { call.reject("PROXY_FAILED"); return; }
        JSObject r = new JSObject();
        r.put("base", "http://127.0.0.1:" + port);
        call.resolve(r);
    }

    /** ეკრანის მობრუნება: „portrait“ - აპი მხოლოდ ვერტიკალურად; „auto“ - სრულეკრანიანი ვიდეოსთვის */
    @PluginMethod
    public void setOrientation(PluginCall call) {
        final boolean auto = "auto".equals(call.getString("mode", "portrait"));
        onUi(() -> {
            if (getActivity() != null) getActivity().setRequestedOrientation(auto
                    ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                    : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            call.resolve();
        });
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        call.resolve(r);
    }

    // ═══════════ 📶 WiFi ═══════════

    @PluginMethod
    public void connect(final PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("UNSUPPORTED");
            return;
        }
        releaseInternal();

        String ssid = call.getString("ssid", "");
        String prefix = call.getString("prefix", "");
        String pattern = call.getString("pattern", ".*");
        String password = call.getString("password", "");

        WifiNetworkSpecifier.Builder b = new WifiNetworkSpecifier.Builder();
        if (ssid != null && !ssid.trim().isEmpty()) {
            b.setSsid(ssid.trim());
        } else if (prefix != null && !prefix.isEmpty()) {
            // მაგ. „HiDvr_“ → HiDvr_15C628, HiDvr_A1B2C3 ... (ზუსტი სახელის ცოდნა არ სჭირდება)
            b.setSsidPattern(new PatternMatcher(prefix, PatternMatcher.PATTERN_PREFIX));
        } else {
            b.setSsidPattern(new PatternMatcher(pattern, PatternMatcher.PATTERN_SIMPLE_GLOB));
        }
        // დეშ ქემების უმეტესობას WPA2 პაროლი აქვს (ხშირად 12345678). ცარიელი = ღია ქსელი.
        if (password != null && password.length() >= 8) {
            b.setWpa2Passphrase(password);
        }

        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(b.build())
                .build();

        final boolean[] answered = {false};

        callback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                camNetwork = network;
                cm.bindProcessToNetwork(network);
                if (!answered[0]) {
                    answered[0] = true;
                    JSObject r = new JSObject();
                    r.put("connected", true);
                    r.put("ssid", currentSsid());
                    call.resolve(r);
                }
            }

            @Override
            public void onUnavailable() {
                callback = null;
                if (!answered[0]) {
                    answered[0] = true;
                    call.reject("UNAVAILABLE");
                }
            }

            @Override
            public void onLost(Network network) {
                if (network.equals(camNetwork)) {
                    unbindIfOurs();
                    camNetwork = null;
                    notifyListeners("lost", new JSObject());
                }
            }
        };

        cm.requestNetwork(request, callback, 60000);
    }

    /** ტელეფონი უკვე ხელით არის შეერთებული კამერის WiFi-სთან → აპის ტრაფიკი ამ ქსელზე გადავიყვანოთ */
    @PluginMethod
    public void bindToWifi(PluginCall call) {
        if (cm == null) { call.reject("NO_CM"); return; }
        Network wifi = null;
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities c = cm.getNetworkCapabilities(n);
            if (c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) { wifi = n; break; }
        }
        if (wifi == null) { call.reject("NO_WIFI"); return; }
        camNetwork = wifi;
        cm.bindProcessToNetwork(wifi);
        JSObject r = new JSObject();
        r.put("connected", true);
        call.resolve(r);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        releaseInternal();
        call.resolve();
    }

    /** WiFi-ს სახელი (თუ Android ამის წაკითხვის ნებას იძლევა), ტელეფონის და „როუტერის“ (კამერის) მისამართი */
    @PluginMethod
    public void wifiInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ssid", currentSsid());
        String ip = "", gateway = "";
        try {
            Network n = camNetwork;
            if (n == null && cm != null) {
                for (Network x : cm.getAllNetworks()) {
                    NetworkCapabilities c = cm.getNetworkCapabilities(x);
                    if (c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) { n = x; break; }
                }
            }
            android.net.LinkProperties lp = n != null ? cm.getLinkProperties(n) : null;
            if (lp != null) {
                for (android.net.LinkAddress a : lp.getLinkAddresses()) {
                    if (a.getAddress() instanceof java.net.Inet4Address) { ip = a.getAddress().getHostAddress(); break; }
                }
                for (android.net.RouteInfo ri : lp.getRoutes()) {
                    if (ri.getGateway() instanceof java.net.Inet4Address && !ri.getGateway().isAnyLocalAddress()) { gateway = ri.getGateway().getHostAddress(); break; }
                }
                if (gateway.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && lp.getDhcpServerAddress() != null) {
                    gateway = lp.getDhcpServerAddress().getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        r.put("ip", ip);
        r.put("gateway", gateway);
        call.resolve(r);
    }

    private String currentSsid() {
        try {
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            String s = wm != null && wm.getConnectionInfo() != null ? wm.getConnectionInfo().getSSID() : "";
            if (s == null || s.contains("unknown ssid")) return "";
            return s.replace("\"", "");
        } catch (Exception e) {
            return "";
        }
    }

    private void unbindIfOurs() {
        if (cm == null) return;
        Network bound = cm.getBoundNetworkForProcess();
        if (bound == null || bound.equals(camNetwork)) cm.bindProcessToNetwork(null);
    }

    private void releaseInternal() {
        if (cm == null) return;
        unbindIfOurs();
        if (callback != null) {
            try { cm.unregisterNetworkCallback(callback); } catch (Exception ignored) {}
            callback = null;
        }
        camNetwork = null;
    }

    @Override
    protected void handleOnDestroy() {
        releaseInternal();
        io.shutdownNow();
        if (proxy != null) proxy.stop();
    }

    // ═══════════ 🌐 HTTP ═══════════

    private HttpURLConnection open(String url, int timeoutMs) throws Exception {
        URL u = new URL(url);
        HttpURLConnection c = (HttpURLConnection) (camNetwork != null ? camNetwork.openConnection(u) : u.openConnection());
        c.setConnectTimeout(timeoutMs);
        c.setReadTimeout(timeoutMs);
        c.setUseCaches(false);
        c.setInstanceFollowRedirects(true);
        return c;
    }

    @PluginMethod
    public void request(final PluginCall call) {
        final String url = call.getString("url");
        final int timeout = call.getInt("timeout", 6000);
        if (url == null) { call.reject("NO_URL"); return; }
        io.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = open(url, timeout);
                int status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] b = new byte[8192];
                    int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                    in.close();
                }
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("data", buf.toString("UTF-8"));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("REQUEST_FAILED: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    // ═══════════ ⬇️ გადმოწერა ტელეფონში ═══════════

    private File downloadsDir() {
        File d = new File(getContext().getFilesDir(), "dashcam");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String safeName(String name) {
        if (name == null || name.isEmpty()) name = "video_" + System.currentTimeMillis() + ".mp4";
        return name.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        final String fileName = safeName(call.getString("fileName"));
        if (url == null) { call.reject("NO_URL"); return; }
        io.execute(() -> {
            File out = new File(downloadsDir(), fileName);
            File part = new File(downloadsDir(), fileName + ".part");
            HttpURLConnection c = null;
            try {
                c = open(url, 20000);
                int status = c.getResponseCode();
                if (status >= 400) throw new Exception("HTTP " + status);
                long total = c.getContentLengthLong();
                long loaded = 0, lastNotify = 0;
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                    byte[] b = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(b)) > 0) {
                        os.write(b, 0, n);
                        loaded += n;
                        long now = System.currentTimeMillis();
                        if (now - lastNotify > 300) {
                            lastNotify = now;
                            JSObject p = new JSObject();
                            p.put("fileName", fileName);
                            p.put("loaded", loaded);
                            p.put("total", total);
                            notifyListeners("downloadProgress", p);
                        }
                    }
                }
                if (total > 0 && loaded < total) throw new Exception("INCOMPLETE");
                if (out.exists()) out.delete();
                if (!part.renameTo(out)) throw new Exception("RENAME");
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("size", loaded);
                call.resolve(r);
            } catch (Exception e) {
                part.delete();
                call.reject("DOWNLOAD_FAILED: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @PluginMethod
    public void deleteLocal(PluginCall call) {
        String path = call.getString("path");
        File f = path != null ? new File(path) : null;
        if (f != null && f.getAbsolutePath().startsWith(downloadsDir().getAbsolutePath())) f.delete();
        call.resolve();
    }

    // ═══════════ 🖼️ გალერეაში შენახვა ═══════════

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        // Android 9 და ქვემოთ საჭიროა მეხსიერების ნებართვა
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermsCallback");
            return;
        }
        doSaveToGallery(call);
    }

    @PermissionCallback
    private void storagePermsCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doSaveToGallery(call);
        else call.reject("PERMISSION_DENIED");
    }

    private void doSaveToGallery(final PluginCall call) {
        final String path = call.getString("path");
        final String mime = call.getString("mime", "video/mp4");
        final String fileName = safeName(call.getString("fileName", path != null ? new File(path).getName() : null));
        if (path == null || !new File(path).exists()) { call.reject("NO_FILE"); return; }
        final boolean isImage = mime != null && mime.startsWith("image/");
        if (isImage || !Boolean.TRUE.equals(call.getBoolean("compat", true))) { insertIntoGallery(call, path, mime, fileName, isImage); return; }
        // ვიდეო, რომელსაც ტელეფონის გალერეა ვერ აჩვენებს (მაგ. 1296P) → ჯერ 1080p-ად გადაგვყავს
        io.execute(() -> {
            if (!VideoCompat.needsTranscode(path)) { insertIntoGallery(call, path, mime, fileName, false); return; }
            final String base = fileName.lastIndexOf('.') > 0 ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
            File out = new File(getContext().getCacheDir(), "compat_" + base + ".mp4");
            VideoCompat.transcode(getContext(), path, out,
                    pct -> { JSObject p = new JSObject(); p.put("percent", pct); notifyListeners("compatProgress", p); },
                    (res, err) -> {
                        if (res == null) { call.reject("TRANSCODE_FAILED: " + err); return; }
                        // დროებითი ფაილი cache-შია - Android თავად წმენდს
                        insertIntoGallery(call, res.getAbsolutePath(), "video/mp4", base + ".mp4", false);
                    });
        });
    }

    /** ვიდეოს/ფოტოს ინფორმაცია: { mime, width, height, durationMs, phoneCanPlay } */
    @PluginMethod
    public void probe(PluginCall call) {
        final String path = call.getString("path");
        if (path == null) { call.reject("NO_FILE"); return; }
        io.execute(() -> {
            Object[] v = VideoCompat.probe(path);
            if (v == null) { call.reject("PROBE_FAILED"); return; }
            JSObject r = new JSObject();
            r.put("mime", v[0]);
            r.put("width", v[1]);
            r.put("height", v[2]);
            r.put("durationMs", v[3]);
            r.put("phoneCanPlay", VideoCompat.hardwareCanPlay((String) v[0], (Integer) v[1], (Integer) v[2]));
            call.resolve(r);
        });
    }

    /** ჩანაწერის ყურება ExoPlayer-ით (DashcamPlayerActivity): { url | path, title, startMs?, endMs? } */
    @PluginMethod
    public void openVideo(PluginCall call) {
        String url = call.getString("url", call.getString("path"));
        if (url == null || url.isEmpty()) { call.reject("NO_URL"); return; }
        onUi(this::releaseLivePlayer);
        Intent i = new Intent(getContext(), DashcamPlayerActivity.class);
        i.putExtra("url", url);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("startMs", (long) call.getInt("startMs", 0));
        i.putExtra("endMs", (long) call.getInt("endMs", -1));
        getActivity().startActivity(i);
        call.resolve();
    }

    private void insertIntoGallery(final PluginCall call, final String path, final String mime, final String fileName, final boolean isImage) {
        io.execute(() -> {
            try {
                File src = new File(path);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, (isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES) + "/Octane DashCam");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri collection = isImage
                            ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                            : MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    Uri item = cr.insert(collection, v);
                    if (item == null) throw new Exception("INSERT");
                    try (InputStream in = new FileInputStream(src); OutputStream os = cr.openOutputStream(item)) {
                        copy(in, os);
                    }
                    v.clear();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(item, v, null, null);
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES), "Octane DashCam");
                    if (!dir.exists()) dir.mkdirs();
                    File dst = new File(dir, fileName);
                    try (InputStream in = new FileInputStream(src); OutputStream os = new FileOutputStream(dst)) {
                        copy(in, os);
                    }
                    MediaScannerConnection.scanFile(getContext(), new String[]{ dst.getAbsolutePath() }, new String[]{ mime }, null);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("GALLERY_FAILED: " + e.getMessage());
            }
        });
    }

    private static void copy(InputStream in, OutputStream os) throws Exception {
        if (os == null) throw new Exception("NO_STREAM");
        byte[] b = new byte[64 * 1024];
        int n;
        while ((n = in.read(b)) > 0) os.write(b, 0, n);
    }

    // ═══════════ ✂️ ვიდეოს მოჭრა (MediaExtractor + MediaMuxer, ხელახალი კოდირების გარეშე) ═══════════
    // კადრები ისე გადაიწერება, როგორც არის - სწრაფია და ხარისხი არ იკარგება.
    // დასაწყისი უახლოეს წინა „საკვანძო კადრზე“ გადაიწევს (shiftMs).
    // ხმა, რომელსაც MP4 ვერ იღებს (მაგ. PCM), გამოიტოვება (audioDropped).

    @PluginMethod
    public void trim(final PluginCall call) {
        final String path = call.getString("path");
        final long startUs = Math.max(0L, call.getDouble("startMs", 0d).longValue()) * 1000L;
        final long endUs = call.getDouble("endMs", 0d).longValue() * 1000L;
        if (path == null || !new File(path).exists()) { call.reject("NO_FILE"); return; }
        if (endUs <= startUs) { call.reject("BAD_RANGE"); return; }

        String base = call.getString("fileName", new File(path).getName());
        base = safeName(base).replaceAll("\\.[A-Za-z0-9]+$", "");
        final File out = new File(downloadsDir(), base + "_cut_" + (startUs / 1000000L) + "-" + (endUs / 1000000L) + ".mp4");

        io.execute(() -> {
            MediaExtractor ex = new MediaExtractor();
            MediaMuxer mux = null;
            boolean muxStarted = false;
            try {
                ex.setDataSource(path);
                int count = ex.getTrackCount();
                int[] map = new int[count];
                boolean[] isVideo = new boolean[count];
                boolean hasVideo = false, audioDropped = false;
                int maxSize = 1024 * 1024;
                mux = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

                for (int i = 0; i < count; i++) {
                    map[i] = -1;
                    MediaFormat f = ex.getTrackFormat(i);
                    String mime = f.getString(MediaFormat.KEY_MIME);
                    if (mime == null) continue;
                    boolean video = mime.startsWith("video/");
                    boolean audio = mime.startsWith("audio/");
                    if (!video && !audio) continue;
                    if (video && hasVideo) continue; // მხოლოდ ერთი ვიდეო-ტრეკი
                    try {
                        map[i] = mux.addTrack(f);
                    } catch (Exception e) {
                        if (video) throw new Exception("VIDEO_FORMAT");
                        audioDropped = true;
                        continue;
                    }
                    isVideo[i] = video;
                    if (video) {
                        hasVideo = true;
                        if (f.containsKey("rotation-degrees")) mux.setOrientationHint(f.getInteger("rotation-degrees"));
                    }
                    if (f.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) maxSize = Math.max(maxSize, f.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));
                    ex.selectTrack(i);
                }
                if (!hasVideo) throw new Exception("NO_VIDEO");

                ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                mux.start();
                muxStarted = true;

                ByteBuffer buf = ByteBuffer.allocate(maxSize);
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                long firstVideoUs = -1, lastUs = 0;
                int active = 0;
                for (int m : map) if (m >= 0) active++;

                while (active > 0) {
                    int ti = ex.getSampleTrackIndex();
                    if (ti < 0) break;
                    long t = ex.getSampleTime();
                    if (map[ti] < 0) { ex.advance(); continue; }
                    if (t > endUs) { ex.unselectTrack(ti); map[ti] = -1; active--; continue; }
                    if (isVideo[ti] && firstVideoUs < 0) firstVideoUs = t;
                    // ხმის ნიმუშები, რომლებიც პირველ ვიდეო-კადრამდეა, გამოვტოვოთ
                    if (firstVideoUs < 0 || t < firstVideoUs) { ex.advance(); continue; }

                    info.offset = 0;
                    info.size = ex.readSampleData(buf, 0);
                    if (info.size < 0) break;
                    info.presentationTimeUs = t - firstVideoUs;
                    info.flags = (ex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                    mux.writeSampleData(map[ti], buf, info);
                    if (t > lastUs) lastUs = t;
                    ex.advance();
                }
                if (firstVideoUs < 0) throw new Exception("EMPTY");

                mux.stop();
                muxStarted = false;
                mux.release();
                mux = null;

                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("startMs", firstVideoUs / 1000L);
                r.put("endMs", lastUs / 1000L);
                r.put("shiftMs", Math.max(0L, (startUs - firstVideoUs) / 1000L));
                r.put("audioDropped", audioDropped);
                r.put("size", out.length());
                call.resolve(r);
            } catch (Exception e) {
                out.delete();
                call.reject("TRIM_FAILED: " + e.getMessage());
            } finally {
                try { ex.release(); } catch (Exception ignored) {}
                if (mux != null) {
                    try { if (muxStarted) mux.stop(); } catch (Exception ignored) {}
                    try { mux.release(); } catch (Exception ignored) {}
                }
            }
        });
    }

    // ═══════════ 🏷️ ბრენდირება: ვერტიკალური ჩარჩო (გაზიარება) / „Octane App“ წარწერა (გადმოწერა) ═══════════
    // { path, overlay (PNG base64, width×height), width, height, fileName, suffix } → { path, size }

    @PluginMethod
    public void brand(final PluginCall call) {
        final String path = call.getString("path");
        final String b64 = call.getString("overlay");
        final int w = call.getInt("width", 0), h = call.getInt("height", 0);
        if (path == null || !new File(path).exists()) { call.reject("NO_FILE"); return; }
        if (b64 == null || w <= 0 || h <= 0) { call.reject("BAD_OVERLAY"); return; }
        final Bitmap bmp;
        try {
            byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) { call.reject("BAD_OVERLAY"); return; }
        if (bmp == null) { call.reject("BAD_OVERLAY"); return; }

        String base = safeName(call.getString("fileName", new File(path).getName())).replaceAll("\\.[A-Za-z0-9]+$", "");
        final File out = new File(getContext().getCacheDir(), base + "_" + safeName(call.getString("suffix", "octane")) + ".mp4");
        VideoCompat.brand(getContext(), path, out, bmp, w, h,
                pct -> { JSObject p = new JSObject(); p.put("percent", pct); notifyListeners("compatProgress", p); },
                (res, err) -> {
                    if (res == null) { call.reject("BRAND_FAILED: " + err); return; }
                    JSObject r = new JSObject();
                    r.put("path", res.getAbsolutePath());
                    r.put("size", res.length());
                    call.resolve(r);
                });
    }

    // ═══════════ 📤 გაზიარება (Messenger, WhatsApp, Viber, Telegram...) ═══════════

    @PluginMethod
    public void share(PluginCall call) {
        String path = call.getString("path");
        String mime = call.getString("mime", "video/mp4");
        String title = call.getString("title", "გაზიარება");
        if (path == null || !new File(path).exists()) { call.reject("NO_FILE"); return; }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", new File(path));
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("SHARE_FAILED: " + e.getMessage());
        }
    }

    // ═══════════ 📺 ცოცხალი ხედი აპის ეკრანზევე (WebView-ის ზემოთ, ბარათის ადგილზე) ═══════════
    // JS აგზავნის ბარათის კოორდინატებს (CSS px). TextureView ჩანს მხოლოდ პირველი კადრის შემდეგ,
    // მანამდე ქვემოთ HTML-ის მინიშნება ჩანს. შეხებას არ „იჭერს“ - ღილაკები ჩვეულებრივ მუშაობს.

    private android.widget.FrameLayout liveLayer;
    private android.view.TextureView liveView;
    private androidx.media3.exoplayer.ExoPlayer livePlayer;
    private String liveUrl;
    private float[] liveRect = new float[4];
    private float liveRadius = 0f;   // ბარათის მომრგვალება (CSS px)
    private boolean liveWanted = false, liveShown = true, liveFirstFrame = false;
    private int liveRetries = 0;

    private void onUi(Runnable r) { if (getActivity() != null) getActivity().runOnUiThread(r); }

    private void ensureLiveLayer() {
        if (liveLayer != null) return;
        android.view.View wv = getBridge().getWebView();
        android.view.ViewGroup parent = (android.view.ViewGroup) wv.getParent();
        liveLayer = new android.widget.FrameLayout(getContext());
        liveLayer.setClickable(false);
        liveLayer.setFocusable(false);
        liveView = new android.view.TextureView(getContext());
        liveView.setAlpha(0f);
        liveLayer.addView(liveView, new android.widget.FrameLayout.LayoutParams(1, 1));
        parent.addView(liveLayer, new android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void applyLiveRect() {
        if (liveView == null) return;
        android.view.View wv = getBridge().getWebView();
        float d = getContext().getResources().getDisplayMetrics().density;
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(
                Math.max(1, Math.round(liveRect[2] * d)), Math.max(1, Math.round(liveRect[3] * d)));
        lp.leftMargin = wv.getLeft() + Math.round(liveRect[0] * d);
        lp.topMargin = wv.getTop() + Math.round(liveRect[1] * d);
        liveView.setLayoutParams(lp);
        // ვიდეო ბარათის მომრგვალებულ კუთხეებს მიჰყვება
        final float rad = liveRadius * d;
        liveView.setOutlineProvider(new android.view.ViewOutlineProvider() {
            @Override
            public void getOutline(android.view.View v, android.graphics.Outline o) { o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), rad); }
        });
        liveView.setClipToOutline(rad > 0);
        liveView.invalidateOutline();
        liveView.setVisibility(liveShown ? android.view.View.VISIBLE : android.view.View.INVISIBLE);
    }

    private void liveState(String s) {
        JSObject o = new JSObject();
        o.put("state", s);
        notifyListeners("liveState", o);
    }

    private void createLivePlayer() {
        releaseLivePlayer();
        if (liveUrl == null || liveView == null) return;
        liveFirstFrame = false;
        liveView.setAlpha(0f);
        androidx.media3.exoplayer.DefaultLoadControl load = new androidx.media3.exoplayer.DefaultLoadControl.Builder()
                .setBufferDurationsMs(500, 2000, 250, 250).build();
        livePlayer = new androidx.media3.exoplayer.ExoPlayer.Builder(getContext()).setLoadControl(load).build();
        livePlayer.setVideoTextureView(liveView);
        livePlayer.setVolume(0f);
        livePlayer.setMediaSource(new androidx.media3.exoplayer.rtsp.RtspMediaSource.Factory()
                .setForceUseRtpTcp(true).setTimeoutMs(8000)
                .createMediaSource(androidx.media3.common.MediaItem.fromUri(liveUrl)));
        livePlayer.addListener(new androidx.media3.common.Player.Listener() {
            @Override
            public void onRenderedFirstFrame() {
                liveFirstFrame = true;
                liveRetries = 0;
                if (liveView != null) liveView.setAlpha(1f);
                liveState("playing");
            }

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException error) {
                if (liveView != null) liveView.setAlpha(0f);
                // კამერას ჩაწერის ჩართვის/რეჟიმის შეცვლის შემდეგ ნაკადის მომზადებას რამდენიმე წამი სჭირდება -
                // შეცდომას მაშინვე არ ვაჩვენებთ, ჯერ თავიდან ვცდით
                if (liveWanted && liveRetries < 6) {
                    liveRetries++;
                    liveState("loading");
                    if (liveView != null) liveView.postDelayed(() -> { if (liveWanted) createLivePlayer(); }, 1500);
                } else {
                    liveState("error");
                }
            }
        });
        liveState("loading");
        livePlayer.setPlayWhenReady(true);
        livePlayer.prepare();
    }

    private void releaseLivePlayer() {
        if (livePlayer != null) { livePlayer.release(); livePlayer = null; }
        if (liveView != null) liveView.setAlpha(0f);
    }

    private void readRect(PluginCall call) {
        liveRect[0] = call.getFloat("x", liveRect[0]);
        liveRect[1] = call.getFloat("y", liveRect[1]);
        liveRect[2] = call.getFloat("w", liveRect[2]);
        liveRect[3] = call.getFloat("h", liveRect[3]);
        liveRadius = call.getFloat("radius", liveRadius);
    }

    @PluginMethod
    public void liveInlineStart(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("NO_URL"); return; }
        readRect(call);
        onUi(() -> {
            ensureLiveLayer();
            liveUrl = url;
            liveWanted = true;
            liveShown = true;
            liveRetries = 0;
            applyLiveRect();
            createLivePlayer();
            call.resolve();
        });
    }

    @PluginMethod
    public void liveInlineRect(PluginCall call) {
        readRect(call);
        onUi(() -> { applyLiveRect(); call.resolve(); });
    }

    @PluginMethod
    public void liveInlineVisible(PluginCall call) {
        boolean v = Boolean.TRUE.equals(call.getBoolean("visible", true));
        onUi(() -> { liveShown = v; applyLiveRect(); call.resolve(); });
    }

    @PluginMethod
    public void liveInlineStop(PluginCall call) {
        onUi(() -> {
            liveWanted = false;
            releaseLivePlayer();
            if (liveView != null) liveView.setVisibility(android.view.View.INVISIBLE);
            call.resolve();
        });
    }

    // აპი ფონზე გადავიდა ან სრულეკრანიანი ხედი გაიხსნა - ნაკადი ვათავისუფლებთ, დაბრუნებისას ვაგრძელებთ
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        onUi(this::releaseLivePlayer);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        onUi(() -> { if (liveWanted) createLivePlayer(); });
    }

    /** ცოცხალი ხედი (RTSP) სრულ ეკრანზე - DashcamLiveActivity */
    @PluginMethod
    public void openLive(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("NO_URL"); return; }
        onUi(this::releaseLivePlayer);   // კამერა ერთდროულად ერთ ნაკადს აძლევს
        Intent i = new Intent(getContext(), DashcamLiveActivity.class);
        i.putExtra("url", url);
        i.putExtra("title", call.getString("title", ""));
        getActivity().startActivity(i);
        call.resolve();
    }

    /** რამდენიმე ფაილის ერთად გაგზავნა */
    @PluginMethod
    public void shareMany(PluginCall call) {
        String mime = call.getString("mime", "*/*");
        String title = call.getString("title", "გაზიარება");
        try {
            com.getcapacitor.JSArray arr = call.getArray("paths");
            java.util.ArrayList<Uri> uris = new java.util.ArrayList<>();
            for (int i = 0; arr != null && i < arr.length(); i++) {
                File f = new File(arr.getString(i));
                if (f.exists()) uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f));
            }
            if (uris.isEmpty()) { call.reject("NO_FILE"); return; }
            Intent send = new Intent(Intent.ACTION_SEND_MULTIPLE);
            send.setType(mime);
            send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("SHARE_FAILED: " + e.getMessage());
        }
    }
}
