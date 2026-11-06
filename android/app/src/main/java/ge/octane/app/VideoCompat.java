package ge.octane.app;

import android.content.Context;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;

import java.io.File;
import java.util.Collections;

/**
 * Octane App — ვიდეოს „თავსებადობა“ ტელეფონთან.
 *
 * დეშ ქემები ხშირად იწერენ 1296P-ზე (2304×1296). იაფი ტელეფონების აპარატული დეკოდერი ამ ზომას
 * ვერ ხსნის: ტელეფონის გალერეაში მწვანე ეკრანი ჩანს, WebView-ში - შავი (მხოლოდ ხმა).
 * ამიტომ გალერეაში შენახვამდე ვამოწმებთ და, საჭიროების შემთხვევაში, 1080p H.264-ად გადაგვყავს
 * (Media3 Transformer - ისე, როგორც GoLook აკეთებს „transcode“-ით).
 */
public final class VideoCompat {

    public interface Progress { void on(int percent); }
    public interface Done { void on(File out, String error); }

    private VideoCompat() {}

    /** → { mime, width, height, durationMs } ან null */
    public static Object[] probe(String path) {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(path);
            long dur = 0;
            Object[] video = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (f.containsKey(MediaFormat.KEY_DURATION)) dur = Math.max(dur, f.getLong(MediaFormat.KEY_DURATION) / 1000);
                if (mime != null && mime.startsWith("video/") && video == null) {
                    video = new Object[]{ mime, f.getInteger(MediaFormat.KEY_WIDTH), f.getInteger(MediaFormat.KEY_HEIGHT), 0L };
                }
            }
            if (video != null) video[3] = dur;
            return video;
        } catch (Exception e) {
            return null;
        } finally {
            ex.release();
        }
    }

    private static boolean isHardware(MediaCodecInfo c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return c.isHardwareAccelerated();
        String n = c.getName().toLowerCase();
        return !(n.startsWith("omx.google.") || n.startsWith("c2.android.") || n.contains(".sw."));
    }

    /** ტელეფონის აპარატულ დეკოდერს (რომელსაც გალერეის აპები იყენებს) შეუძლია ამ ვიდეოს ჩვენება? */
    public static boolean hardwareCanPlay(String mime, int w, int h) {
        try {
            for (MediaCodecInfo c : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
                if (c.isEncoder() || !isHardware(c)) continue;
                for (String t : c.getSupportedTypes()) {
                    if (!t.equalsIgnoreCase(mime)) continue;
                    MediaCodecInfo.VideoCapabilities vc = c.getCapabilitiesForType(t).getVideoCapabilities();
                    if (vc != null && (vc.isSizeSupported(w, h) || vc.isSizeSupported(h, w))) return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    public static boolean needsTranscode(String path) {
        Object[] v = probe(path);
        if (v == null) return false;
        return !hardwareCanPlay((String) v[0], (Integer) v[1], (Integer) v[2]);
    }

    /** ვიდეო → 1080p (ან ნაკლები) H.264. მუშაობს მთავარ ნაკადზე (Transformer ამას მოითხოვს). */
    public static void transcode(Context ctx, String in, File out, Progress progress, Done done) {
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            try {
                if (out.exists()) out.delete();
                Object[] v = probe(in);
                int h = v != null ? Math.min((Integer) v[1], (Integer) v[2]) : 1080;
                final Transformer[] holder = new Transformer[1];
                final boolean[] finished = {false};
                Transformer t = new Transformer.Builder(ctx)
                        .setVideoMimeType(MimeTypes.VIDEO_H264)
                        .addListener(new Transformer.Listener() {
                            @Override
                            public void onCompleted(Composition composition, ExportResult result) {
                                finished[0] = true;
                                done.on(out, null);
                            }

                            @Override
                            public void onError(Composition composition, ExportResult result, ExportException e) {
                                finished[0] = true;
                                out.delete();
                                done.on(null, e.getMessage());
                            }
                        })
                        .build();
                holder[0] = t;
                EditedMediaItem item = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(new File(in))))
                        .setEffects(new Effects(Collections.emptyList(),
                                h > 1080 ? Collections.singletonList(Presentation.createForHeight(1080)) : Collections.emptyList()))
                        .build();
                t.start(item, out.getAbsolutePath());

                ProgressHolder ph = new ProgressHolder();
                main.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (finished[0]) return;
                        if (holder[0].getProgress(ph) == Transformer.PROGRESS_STATE_AVAILABLE) progress.on(ph.progress);
                        main.postDelayed(this, 500);
                    }
                }, 500);
            } catch (Exception e) {
                done.on(null, e.getMessage());
            }
        });
    }
}
