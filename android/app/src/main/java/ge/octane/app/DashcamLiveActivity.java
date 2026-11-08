package ge.octane.app;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.rtsp.RtspMediaSource;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

/**
 * Octane App - ვიდეორეგისტრატორის ცოცხალი ხედი (RTSP), სრულ ეკრანზე.
 * WebView-ს RTSP-ს ჩვენება არ შეუძლია, ამიტომ ვიყენებთ ExoPlayer-ს (Media3).
 * HiDvr: rtsp://192.168.0.1:554/livestream/1, TCP-ით (ისე, როგორც GoLook-ში).
 * ქსელი უკვე მიბმულია კამერის WiFi-ზე DashcamWifiPlugin-ის მიერ.
 */
public class DashcamLiveActivity extends Activity {

    private ExoPlayer player;
    private TextView status;
    private String url;

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private Button pill(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setPadding(dp(18), 0, dp(18), 0);
        b.setMinHeight(dp(48));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0x99000000);
        bg.setCornerRadius(dp(24));
        b.setBackground(bg);
        return b;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);

        url = getIntent().getStringExtra("url");
        String title = getIntent().getStringExtra("title");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        PlayerView view = new PlayerView(this);
        view.setUseController(false);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setKeepContentOnPlayerReset(true);
        root.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(24), 0, dp(24), 0);
        status.setText("ცოცხალ ხედს ვრთავ...");
        root.addView(status, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(14), dp(14), dp(14), dp(14));

        Button close = pill("✕  დახურვა");
        close.setOnClickListener(v -> finish());
        top.addView(close);

        TextView name = new TextView(this);
        name.setTextColor(Color.WHITE);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        name.setPadding(dp(14), 0, dp(14), 0);
        name.setText("● LIVE  " + (title != null ? title : ""));
        top.addView(name);
        root.addView(top, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        Button retry = pill("↻  თავიდან ცდა");
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> { retry.setVisibility(View.GONE); start(view); });
        FrameLayout.LayoutParams rp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM);
        rp.bottomMargin = dp(40);
        root.addView(retry, rp);
        status.setTag(retry);

        setContentView(root);
        start(view);
    }

    private void start(PlayerView view) {
        release();
        if (url == null || url.isEmpty()) { showError(); return; }
        status.setVisibility(View.VISIBLE);
        status.setText("ცოცხალ ხედს ვრთავ...");

        // მცირე ბუფერი - რაც შეიძლება ნაკლები დაგვიანება
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(500, 2000, 250, 250)
                .build();
        player = new ExoPlayer.Builder(this).setLoadControl(load).build();
        player.setMediaSource(new RtspMediaSource.Factory()
                .setForceUseRtpTcp(true)
                .setTimeoutMs(8000)
                .createMediaSource(MediaItem.fromUri(url)));
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) status.setVisibility(View.GONE);
                else if (state == Player.STATE_BUFFERING) { status.setText("იტვირთება..."); status.setVisibility(View.VISIBLE); }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                showError();
            }
        });
        view.setPlayer(player);
        player.setPlayWhenReady(true);
        player.prepare();
    }

    private void showError() {
        status.setText("ცოცხალი ხედი ვერ ჩაირთო.\nშეამოწმე, რომ ტელეფონი კამერის WiFi-ზეა.");
        status.setVisibility(View.VISIBLE);
        Object r = status.getTag();
        if (r instanceof View) ((View) r).setVisibility(View.VISIBLE);
    }

    private void release() {
        if (player != null) { player.release(); player = null; }
    }

    @Override
    protected void onStop() {
        super.onStop();
        finish();
    }

    @Override
    protected void onDestroy() {
        release();
        super.onDestroy();
    }
}
