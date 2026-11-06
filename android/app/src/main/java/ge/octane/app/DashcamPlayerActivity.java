package ge.octane.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

/**
 * Octane App — კამერის ჩანაწერის ყურება (ExoPlayer).
 *
 * WebView-ის <video> იაფ ტელეფონებზე 1296P ვიდეოს ვერ აჩვენებს (შავი ეკრანი, მხოლოდ ხმა).
 * ExoPlayer დეკოდერს ვიდეოს მიხედვით ირჩევს: თუ აპარატული ამ ზომას ვერ ხსნის, იყენებს პროგრამულს.
 * ეკრანის გადატრიალებით სრულ ეკრანზე ჩანს. extras: url (file:// ან http), title, startMs, endMs (გადახედვისთვის).
 */
public class DashcamPlayerActivity extends Activity {

    private ExoPlayer player;
    private TextView status;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long endMs = -1;

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);

        String url = getIntent().getStringExtra("url");
        String title = getIntent().getStringExtra("title");
        long startMs = getIntent().getLongExtra("startMs", 0);
        endMs = getIntent().getLongExtra("endMs", -1);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        PlayerView view = new PlayerView(this);
        view.setUseController(true);
        view.setControllerShowTimeoutMs(2500);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);
        root.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(24), 0, dp(24), 0);
        status.setVisibility(View.GONE);
        root.addView(status, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        Button close = new Button(this);
        close.setText("✕  დახურვა");
        close.setAllCaps(false);
        close.setTextColor(Color.WHITE);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        close.setPadding(dp(16), 0, dp(16), 0);
        close.setMinHeight(dp(44));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0x99000000);
        bg.setCornerRadius(dp(22));
        close.setBackground(bg);
        close.setOnClickListener(v -> finish());
        FrameLayout.LayoutParams cp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
        cp.leftMargin = dp(14);
        cp.topMargin = dp(14);
        root.addView(close, cp);

        if (title != null && !title.isEmpty()) {
            TextView name = new TextView(this);
            name.setTextColor(Color.WHITE);
            name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            name.setText(title);
            FrameLayout.LayoutParams np = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END);
            np.rightMargin = dp(18);
            np.topMargin = dp(24);
            root.addView(name, np);
        }

        setContentView(root);

        if (url == null || url.isEmpty()) { showError(); return; }
        // აპარატული დეკოდერი ვერ ჩაირთო → ავტომატურად შემდეგი (პროგრამული)
        DefaultRenderersFactory rf = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(this, rf).build();
        player.setMediaItem(MediaItem.fromUri(url.startsWith("/") ? Uri.fromFile(new java.io.File(url)) : Uri.parse(url)), Math.max(0, startMs));
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                showError();
            }
        });
        view.setPlayer(player);
        player.setPlayWhenReady(true);
        player.prepare();

        // „გადახედვა“ (მოჭრისას): მონიშნული ნაწილის ბოლოს ჩერდება
        if (endMs > 0) {
            handler.post(new Runnable() {
                @Override
                public void run() {
                    if (player == null) return;
                    if (player.getCurrentPosition() >= endMs) { player.pause(); return; }
                    handler.postDelayed(this, 200);
                }
            });
        }
    }

    private void showError() {
        status.setText("ვიდეო ვერ ჩაირთო.\nსცადე თავიდან ან შეამოწმე კამერასთან კავშირი.");
        status.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) player.pause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }
}
