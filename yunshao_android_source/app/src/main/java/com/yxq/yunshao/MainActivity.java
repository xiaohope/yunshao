package com.yxq.yunshao;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.graphics.drawable.GradientDrawable;
import android.view.MotionEvent;
import android.view.Menu;
import android.widget.PopupMenu;

/**
 * 云梢 v3.5.1 - 全屏方案：原生onShowCustomView标准模式
 * 
 * 核心思路：
 * 视频全屏使用WebView标准的onShowCustomView，WebView内部会正确渲染视频
 * 在自定义全屏容器上叠加原生控件（返回按钮、比例切换）
 * 不用CSS position:fixed——那和视频硬件渲染冲突
 */
public class MainActivity extends Activity {
    private static final String TAG = "YunShao";
    public static YunShaoServer sharedServer = null;
    private WebView webView;
    private YunShaoServer server;
    private FrameLayout rootView;
    private boolean isFullscreen = false;
    private boolean isDarkTheme = false;
    private WebChromeClient.CustomViewCallback customViewCallback = null;
    private View customView = null;
    private FrameLayout fullscreenContainer; // 全屏容器
    private Handler handler = new Handler(Looper.getMainLooper());
    
    // 当前视频比例
    private String currentVideoRatio = "contain";
    
    // 全屏播放控制
    private SeekBar seekBar;
    private TextView timeText;
    private Button playPauseBtn;
    private LinearLayout bottomBar;
    private LinearLayout topBarView;
    private View touchLayerView;
    private boolean isVideoPlaying = true;
    private Runnable progressUpdater;
    private LinearLayout settingsPanel;
    private int currentSeekSeconds = 10;
    private boolean isPortraitVideo = false; // 竖屏视频标记
    private boolean doubleBackToExit = false; // 双击退出标记

    // 快进快退控制
    private boolean isSeeking = false;
    private int seekDirection = 0;
    private Runnable seekRunnable;
    // 倍速控制
    private float currentPlaybackSpeed = 1.0f;
    private Button speedBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loadFsPrefs(); // 加载全屏设置默认值
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        
        // 允许内容延伸到刘海区域
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(0xFFF5F6F8);
        webView = new WebView(this);
        rootView.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootView);

        // 创建全屏容器（初始不显示）
        fullscreenContainer = new FrameLayout(this);
        fullscreenContainer.setBackgroundColor(0xFF000000);
        fullscreenContainer.setVisibility(View.GONE);
        rootView.addView(fullscreenContainer, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setLightStatusBar();

        webView.clearCache(true);
        webView.clearHistory();

        server = new YunShaoServer(this);
        try {
            server.start(8989, true);
            server.warmupHomeCache(); // 预热首页缓存
            Log.i(TAG, "Server started on port 8989");
        } catch (Exception e) {
            Log.e(TAG, "Server start failed", e);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setDatabaseEnabled(true);
        settings.setBlockNetworkImage(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setPluginState(WebSettings.PluginState.ON);

        // 首次触摸激活WebView（修复部分设备需要点两次才能交互的问题）
        webView.setOnTouchListener((v, event) -> {
            if (event.getAction() == android.view.MotionEvent.ACTION_DOWN) {
                webView.setFocusable(true);
                webView.requestFocus();
                webView.setOnTouchListener(null); // 只触发一次
            }
            return false;
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("http://localhost:8989") || url.startsWith("http://127.0.0.1:8989")) {
                    return false;
                }
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isDarkTheme) setDarkStatusBar(); else setLightStatusBar();
                webView.requestFocus(View.FOCUS_DOWN);
                // 注入物理屏幕尺寸给JS，用于布局判断
                runOnUiThread(() -> {
                    android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
                    getWindowManager().getDefaultDisplay().getRealMetrics(dm);
                    int physW = dm.widthPixels;
                    int physH = dm.heightPixels;
                    webView.evaluateJavascript(
                        "window.__screenW=" + physW + ";window.__screenH=" + physH + ";if(typeof applyLayout==='function')applyLayout(localStorage.getItem('ys_layout')||'auto');",
                        null
                    );
                });
            }
        });

        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void enterFullscreen() {
                enterFullscreenWithOrientation(false);
            }
            
            @JavascriptInterface
            public void enterFullscreen(boolean isPortrait) {
                enterFullscreenWithOrientation(isPortrait);
            }
            
            private void enterFullscreenWithOrientation(boolean isPortrait) {
                runOnUiThread(() -> {
                    // 记住视频方向，onShowCustomView中会用
                    isPortraitVideo = isPortrait;
                    webView.evaluateJavascript(
                        "var v=document.querySelector('#playerArea video')||document.querySelector('#tvPlayerArea video');if(v){if(v.requestFullscreen)v.requestFullscreen();else if(v.webkitRequestFullscreen)v.webkitRequestFullscreen();}",
                        null
                    );
                });
            }
            
            @JavascriptInterface
            public void exitFullscreen() {
                runOnUiThread(() -> exitFullscreenInternal());
            }
            
            @JavascriptInterface
            public void updateStatusBar(boolean dark) {
                runOnUiThread(() -> {
                    isDarkTheme = dark;
                    if (!isFullscreen) {
                        if (dark) setDarkStatusBar(); else setLightStatusBar();
                    }
                });
            }
            
            @JavascriptInterface
            public void playExternal(String url) {
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(Uri.parse(url), "video/*");
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(Intent.createChooser(intent, "选择播放器"));
                    } catch (Exception e) {
                        try {
                            android.content.ClipboardManager cb = (android.content.ClipboardManager)
                                getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                            cb.setPrimaryClip(android.content.ClipData.newPlainText("video_url", url));
                            webView.evaluateJavascript("if(typeof showToast==='function')showToast('链接已复制到剪贴板');", null);
                        } catch (Exception ex) {
                            webView.evaluateJavascript("if(typeof showToast==='function')showToast('无法播放');", null);
                        }
                    }
                });
            }
            
            @JavascriptInterface
            public void setRatio(String ratio) {
                runOnUiThread(() -> {
                    currentVideoRatio = ratio;
                    // 通过JS设置视频比例
                    webView.evaluateJavascript(
                        "if(typeof setVideoRatio==='function')setVideoRatio('" + ratio + "');",
                        null
                    );
                    // 更新按钮状态
                    updateRatioButtons(ratio);
                });
            }
        }, "YunShaoNative");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                // 标准全屏模式：显示WebView提供的视频视图
                if (isFullscreen) {
                    callback.onCustomViewHidden();
                    return;
                }
                isFullscreen = true;
                customViewCallback = callback;
                customView = view;
                
                // 竖屏视频保持竖屏，横屏视频切横屏
                setRequestedOrientation(isPortraitVideo ? 
                    ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : 
                    ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                hideSystemBars();
                
                // 状态栏隐藏在hideSystemBars()中统一处理
                
                // 隐藏WebView内容
                webView.setVisibility(View.GONE);
                
                // 将全屏容器从rootView移到DecorView，不受系统insets约束
                rootView.removeView(fullscreenContainer);
                FrameLayout decorView = (FrameLayout) getWindow().getDecorView();
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                );
                decorView.addView(fullscreenContainer, lp);
                
                // 将视频视图加入全屏容器
                fullscreenContainer.removeAllViews();
                FrameLayout.LayoutParams videoParams = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                );
                videoParams.gravity = Gravity.CENTER;
                fullscreenContainer.addView(view, videoParams);
                
                // 添加原生控制层
                addFullscreenControls();
                
                fullscreenContainer.setVisibility(View.VISIBLE);
            }

            @Override
            public void onHideCustomView() {
                exitFullscreenInternal();
            }
        });

        webView.loadUrl("http://localhost:8989");
    }

    private void addFullscreenControls() {
        // ========== 顶部控制栏 ==========
        topBarView = new LinearLayout(this);
        topBarView.setOrientation(LinearLayout.HORIZONTAL);
        topBarView.setGravity(Gravity.CENTER_VERTICAL);
        topBarView.setPadding(20, 32, 20, 12);
        GradientDrawable topBg = new GradientDrawable(
            GradientDrawable.Orientation.BOTTOM_TOP,
            new int[]{0xCC000000, 0xE6000000}
        );
        topBarView.setBackground(topBg);
        topBarView.setTag("topBar");

        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        topParams.gravity = Gravity.TOP;

        // 返回按钮
        Button backBtn = new Button(this);
        backBtn.setText("←");
        backBtn.setTextColor(0xFFFFFFFF);
        backBtn.setBackgroundColor(0x00000000);
        backBtn.setTextSize(22);
        backBtn.setPadding(12, 6, 12, 6);
        backBtn.setOnClickListener(v -> exitFullscreenInternal());
        LinearLayout.LayoutParams backParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        backParams.setMargins(4, 0, 12, 0);
        topBarView.addView(backBtn, backParams);

        // 视频标题
        TextView titleView = new TextView(this);
        titleView.setText("未知视频");
        titleView.setTextColor(0xFFFFFFFF);
        titleView.setTextSize(15);
        titleView.setSingleLine(true);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f
        );
        titleParams.setMargins(4, 0, 12, 0);
        topBarView.addView(titleView, titleParams);

        // 获取视频标题
        handler.postDelayed(() -> {
            webView.evaluateJavascript(
                "window.__currentVideoName || ''",
                titleResult -> {
                    if (titleResult != null && !titleResult.isEmpty()
                            && !"null".equals(titleResult) && !"\"\"".equals(titleResult)) {
                        runOnUiThread(() -> titleView.setText(titleResult.replace("\"", "")));
                    }
                }
            );
        }, 800);

        fullscreenContainer.addView(topBarView, topParams);

        // ========== 底部控制栏 ==========
        bottomBar = new LinearLayout(this);
        bottomBar.setOrientation(LinearLayout.HORIZONTAL);
        bottomBar.setGravity(Gravity.CENTER_VERTICAL);
        bottomBar.setPadding(20, 10, 20, 20);
        GradientDrawable bottomBg = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{0xCC000000, 0xE6000000}
        );
        bottomBar.setBackground(bottomBg);
        bottomBar.setTag("bottomBar");

        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        bottomParams.gravity = Gravity.BOTTOM;

        // ------ 左侧：快退 | 播放 | 快进 ------
        LinearLayout leftGroup = new LinearLayout(this);
        leftGroup.setOrientation(LinearLayout.HORIZONTAL);
        leftGroup.setGravity(Gravity.CENTER_VERTICAL);

        // 快退按钮
        Button rewindBtn = makeFsBtn("«10s");
        rewindBtn.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    seekVideo(currentSeekSeconds > 0 ? -currentSeekSeconds : -10);
                    isSeeking = true;
                    seekDirection = -1;
                    handler.removeCallbacks(seekRunnable);
                    seekRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (isSeeking) {
                                seekVideo(seekDirection * (currentSeekSeconds > 0 ? currentSeekSeconds : 10));
                                handler.postDelayed(this, 400);
                            }
                        }
                    };
                    handler.postDelayed(seekRunnable, 400);
                    break;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    isSeeking = false;
                    if (seekRunnable != null) handler.removeCallbacks(seekRunnable);
                    break;
            }
            return true;
        });
        leftGroup.addView(rewindBtn);

        // 播放/暂停按钮
        playPauseBtn = new Button(this);
        playPauseBtn.setText("❚❚");
        playPauseBtn.setTextColor(0xFFFFFFFF);
        playPauseBtn.setBackgroundColor(0x00000000);
        playPauseBtn.setTextSize(20);
        playPauseBtn.setPadding(14, 6, 14, 6);
        playPauseBtn.setOnClickListener(v -> {
            if (isVideoPlaying) {
                webView.evaluateJavascript("var v=document.querySelector('#playerArea video');if(v)v.pause();", null);
                playPauseBtn.setText("▶");
                isVideoPlaying = false;
            } else {
                webView.evaluateJavascript("var v=document.querySelector('#playerArea video');if(v)v.play();", null);
                playPauseBtn.setText("❚❚");
                isVideoPlaying = true;
            }
        });
        leftGroup.addView(playPauseBtn);

        // 快进按钮
        Button forwardBtn = makeFsBtn("10s»");
        forwardBtn.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    seekVideo(currentSeekSeconds > 0 ? currentSeekSeconds : 10);
                    isSeeking = true;
                    seekDirection = 1;
                    handler.removeCallbacks(seekRunnable);
                    seekRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (isSeeking) {
                                seekVideo(seekDirection * (currentSeekSeconds > 0 ? currentSeekSeconds : 10));
                                handler.postDelayed(this, 400);
                            }
                        }
                    };
                    handler.postDelayed(seekRunnable, 400);
                    break;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    isSeeking = false;
                    if (seekRunnable != null) handler.removeCallbacks(seekRunnable);
                    break;
            }
            return true;
        });
        leftGroup.addView(forwardBtn);

        LinearLayout.LayoutParams leftParams = new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f
        );
        bottomBar.addView(leftGroup, leftParams);

        // ------ 右侧：倍速 | 比例 | 设置 ------
        LinearLayout rightGroup = new LinearLayout(this);
        rightGroup.setOrientation(LinearLayout.HORIZONTAL);
        rightGroup.setGravity(Gravity.CENTER_VERTICAL);

        // 倍速按钮
        speedBtn = new Button(this);
        updateSpeedBtnText();
        speedBtn.setTextColor(0xFFFFFFFF);
        speedBtn.setTextSize(13);
        speedBtn.setPadding(10, 5, 10, 5);
        speedBtn.setBackgroundColor(0x33FFFFFF);
        speedBtn.setOnClickListener(v -> showSpeedPopup(speedBtn));
        rightGroup.addView(speedBtn);

        // 比例按钮
        Button ratioBtn = new Button(this);
        ratioBtn.setText(ratioLabel(currentVideoRatio));
        ratioBtn.setTextColor(0xFFFFFFFF);
        ratioBtn.setTextSize(13);
        ratioBtn.setPadding(10, 5, 10, 5);
        ratioBtn.setBackgroundColor(0x33FFFFFF);
        LinearLayout.LayoutParams ratioBtnParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        ratioBtnParams.setMargins(6, 0, 0, 0);
        ratioBtn.setOnClickListener(v -> showRatioPopup(ratioBtn));
        rightGroup.addView(ratioBtn, ratioBtnParams);

        // 设置按钮
        Button settingsBtn = new Button(this);
        settingsBtn.setText("⚙");
        settingsBtn.setTextColor(0xFFFFFFFF);
        settingsBtn.setTextSize(18);
        settingsBtn.setPadding(10, 5, 10, 5);
        settingsBtn.setBackgroundColor(0x33FFFFFF);
        LinearLayout.LayoutParams settingsBtnParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        settingsBtnParams.setMargins(6, 0, 0, 0);
        settingsBtn.setOnClickListener(v -> toggleSettingsPanel());
        rightGroup.addView(settingsBtn, settingsBtnParams);

        LinearLayout.LayoutParams rightParams = new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.0f
        );
        rightParams.setMargins(0, 0, 0, 0);
        bottomBar.addView(rightGroup, rightParams);

        fullscreenContainer.addView(bottomBar, bottomParams);

        // ========== 设置面板（默认隐藏） ==========
        settingsPanel = new LinearLayout(this);
        settingsPanel.setOrientation(LinearLayout.HORIZONTAL);
        settingsPanel.setGravity(Gravity.CENTER_VERTICAL);
        settingsPanel.setPadding(20, 10, 20, 10);
        settingsPanel.setBackgroundColor(0xDD222222);
        settingsPanel.setVisibility(View.GONE);
        settingsPanel.setTag("settingsPanel");

        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        panelParams.gravity = Gravity.BOTTOM;
        panelParams.bottomMargin = 120; // 在底部控制栏上方

        // 跳过时长设置
        addSettingsLabel(settingsPanel, "跳过:");
        for (int sec : new int[]{5, 10, 15, 30, 60}) {
            Button b = new Button(this);
            b.setText(sec + "s");
            b.setTextColor(sec == currentSeekSeconds ? 0xFFFFFFFF : 0x99FFFFFF);
            b.setTextSize(12);
            b.setPadding(10, 4, 10, 4);
            b.setBackgroundColor(sec == currentSeekSeconds ? 0x66E50914 : 0x33FFFFFF);
            int finalSec = sec;
            b.setOnClickListener(v -> {
                currentSeekSeconds = finalSec;
                saveFsPrefs();
                // 更新按钮样式
                updateSettingsPanel();
            });
            settingsPanel.addView(b);
        }

        // 倍速快捷设置
        addSettingsLabel(settingsPanel, " 倍速:");
        for (float spd : new float[]{0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f}) {
            Button b = new Button(this);
            String label = spd + "x";
            b.setText(label);
            b.setTextColor(Math.abs(spd - currentPlaybackSpeed) < 0.01 ? 0xFFFFFFFF : 0x99FFFFFF);
            b.setTextSize(12);
            b.setPadding(10, 4, 10, 4);
            b.setBackgroundColor(Math.abs(spd - currentPlaybackSpeed) < 0.01 ? 0x66E50914 : 0x33FFFFFF);
            float finalSpd = spd;
            b.setOnClickListener(v -> {
                currentPlaybackSpeed = finalSpd;
                updateSpeedBtnText();
                webView.evaluateJavascript(
                    "var v=document.querySelector('#playerArea video');if(v)v.playbackRate=" + finalSpd + ";",
                    null
                );
                saveFsPrefs();
                updateSettingsPanel();
            });
            settingsPanel.addView(b);
        }

        fullscreenContainer.addView(settingsPanel, panelParams);

        // ========== 透明触摸捕获层 ==========
        touchLayerView = new View(this);
        touchLayerView.setTag("touchLayer");
        FrameLayout.LayoutParams touchParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        );
        fullscreenContainer.addView(touchLayerView, touchParams);

        // 点击触摸层：显示/隐藏所有控制栏
        touchLayerView.setOnClickListener(v -> {
            boolean show = topBarView.getVisibility() != View.VISIBLE;
            topBarView.setVisibility(show ? View.VISIBLE : View.GONE);
            bottomBar.setVisibility(show ? View.VISIBLE : View.GONE);
            if (settingsPanel != null && settingsPanel.getVisibility() == View.VISIBLE) {
                settingsPanel.setVisibility(View.GONE);
            }
            if (show) {
                scheduleHideControls(5000);
            }
        });

        // 确保控制栏在触摸层上方
        topBarView.bringToFront();
        bottomBar.bringToFront();
        if (settingsPanel != null) settingsPanel.bringToFront();

        // 初始5秒后自动隐藏
        isVideoPlaying = true;
        scheduleHideControls(5000);

        // 启动进度更新
        startProgressUpdater();
    }
    
    /**
     * 快进/快退视频
     * @param deltaSeconds 正数快进，负数快退
     */
    private void seekVideo(int deltaSeconds) {
        webView.evaluateJavascript(
            "var v=document.querySelector('#playerArea video');if(v&&v.duration){v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+" + deltaSeconds + "));}",
            null
        );
    }
    
    /**
     * 延迟隐藏控制栏
     */
    private void scheduleHideControls(long delayMs) {
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(() -> {
            if (topBarView != null) topBarView.setVisibility(View.GONE);
            if (bottomBar != null) bottomBar.setVisibility(View.GONE);
        }, delayMs);
        // 进度更新不受影响，用单独的handler
    }
    
    /**
     * 启动进度条定时更新
     */
    private void startProgressUpdater() {
        progressUpdater = new Runnable() {
            @Override
            public void run() {
                if (!isFullscreen) return;
                webView.evaluateJavascript(
                    "(function(){var v=document.querySelector('#playerArea video');if(v&&v.duration){return Math.floor(v.currentTime)+'/'+Math.floor(v.duration)+'/'+v.paused;}return '0/0/true';})()",
                    result -> {
                        if (result != null && isFullscreen) {
                            try {
                                String r = result.replace("\"", "").trim();
                                String[] parts = r.split("/");
                                if (parts.length == 3) {
                                    long cur = Long.parseLong(parts[0]);
                                    long dur = Long.parseLong(parts[1]);
                                    boolean paused = Boolean.parseBoolean(parts[2]);
                                    isVideoPlaying = !paused;
                                    if (seekBar != null && dur > 0) {
                                        seekBar.setProgress((int)(cur * 1000 / dur));
                                    }
                                    if (timeText != null) {
                                        timeText.setText(formatTime(cur) + " / " + formatTime(dur));
                                    }
                                    if (playPauseBtn != null) {
                                        playPauseBtn.setText(paused ? "▶" : "❚❚");
                                    }
                                }
                            } catch (Exception e) {}
                        }
                    }
                );
                handler.postDelayed(this, 1000);
            }
        };
        handler.postDelayed(progressUpdater, 500);
    }
    
    /**
     * 格式化秒数为 mm:ss
     */
    private String formatTime(long seconds) {
        long m = seconds / 60;
        long s = seconds % 60;
        return String.format("%02d:%02d", m, s);
    }
    
    /**
     * 在Java端直接修改视频View的尺寸/比例（全屏时视频是原生View，CSS管不到）
     */
    private void applyVideoRatio(String ratio) {
        if (customView == null || fullscreenContainer == null) return;
        
        int containerW = fullscreenContainer.getWidth();
        int containerH = fullscreenContainer.getHeight();
        if (containerW <= 0 || containerH <= 0) return;
        
        FrameLayout.LayoutParams params;
        switch (ratio) {
            case "16/9":
                // 强制16:9，居中
                int w16 = containerW;
                int h16 = (int)(containerW / 16.0 * 9);
                if (h16 > containerH) { h16 = containerH; w16 = (int)(containerH / 9.0 * 16); }
                params = new FrameLayout.LayoutParams(w16, h16);
                params.gravity = Gravity.CENTER;
                customView.setLayoutParams(params);
                break;
            case "4/3":
                int w4 = containerW;
                int h4 = (int)(containerW / 4.0 * 3);
                if (h4 > containerH) { h4 = containerH; w4 = (int)(containerH / 3.0 * 4); }
                params = new FrameLayout.LayoutParams(w4, h4);
                params.gravity = Gravity.CENTER;
                customView.setLayoutParams(params);
                break;
            case "cover":
                // 铺满容器，可能裁剪
                params = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                );
                params.gravity = Gravity.CENTER;
                customView.setLayoutParams(params);
                break;
            default: // contain
                // 默认MATCH_PARENT让系统自适应
                params = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                );
                params.gravity = Gravity.CENTER;
                customView.setLayoutParams(params);
                break;
        }
    }
    
    /**
     * 更新比例按钮选中状态
     */
    private void updateRatioButtons(String activeRatio) {
        if (fullscreenContainer == null) return;
        for (int i = 0; i < fullscreenContainer.getChildCount(); i++) {
            View child = fullscreenContainer.getChildAt(i);
            if (child instanceof LinearLayout) {
                LinearLayout bar = (LinearLayout) child;
                for (int j = 0; j < bar.getChildCount(); j++) {
                    View btn = bar.getChildAt(j);
                    if (btn instanceof Button && btn.getTag() != null) {
                        String tag = (String) btn.getTag();
                        if (tag.startsWith("ratio_")) {
                            String ratio = tag.substring(6);
                            if (ratio.equals(activeRatio)) {
                                btn.setBackgroundColor(0x66FFFFFF);
                            } else {
                                btn.setBackgroundColor(0x33FFFFFF);
                            }
                        }
                    }
                }
            }
        }
    }

    // ==================== 全屏辅助方法 ====================

    private Button makeFsBtn(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(0xFFFFFFFF);
        b.setTextSize(12);
        b.setPadding(8, 4, 8, 4);
        b.setBackgroundColor(0x33FFFFFF);
        return b;
    }

    private void updateSpeedBtnText() {
        if (speedBtn == null) return;
        String[] labels = {"0.5x","0.75x","1.0x","1.25x","1.5x","2.0x"};
        float[] values = {0.5f,0.75f,1.0f,1.25f,1.5f,2.0f};
        for (int i = 0; i < values.length; i++) {
            if (Math.abs(values[i] - currentPlaybackSpeed) < 0.01f) {
                speedBtn.setText(labels[i]);
                break;
            }
        }
    }

    private void showSpeedPopup(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor);
        String[] labels = {"0.5x","0.75x","1.0x","1.25x","1.5x","2.0x"};
        float[] values = {0.5f,0.75f,1.0f,1.25f,1.5f,2.0f};
        Menu menu = popup.getMenu();
        for (int i = 0; i < labels.length; i++) menu.add(0, i, i, labels[i]);
        popup.setOnMenuItemClickListener(item -> {
            int idx = item.getItemId();
            currentPlaybackSpeed = values[idx];
            updateSpeedBtnText();
            webView.evaluateJavascript(
                "var v=document.querySelector('#playerArea video');if(v)v.playbackRate=" + currentPlaybackSpeed + ";", null);
            saveFsPrefs();
            return true;
        });
        popup.show();
    }

    private String ratioLabel(String ratio) {
        if ("contain".equals(ratio)) return "默认";
        if ("16/9".equals(ratio)) return "16:9";
        if ("4/3".equals(ratio)) return "4:3";
        if ("cover".equals(ratio)) return "填充";
        return ratio;
    }

    private void showRatioPopup(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor);
        String[] labels = {"默认","16:9","4:3","填充"};
        String[] values = {"contain","16/9","4/3","cover"};
        Menu menu = popup.getMenu();
        for (int i = 0; i < labels.length; i++) menu.add(0, i, i, labels[i]);
        popup.setOnMenuItemClickListener(item -> {
            int idx = item.getItemId();
            currentVideoRatio = values[idx];
            applyVideoRatio(currentVideoRatio);
            saveFsPrefs();
            return true;
        });
        popup.show();
    }

    private void toggleSettingsPanel() {
        if (settingsPanel == null) return;
        boolean show = settingsPanel.getVisibility() != View.VISIBLE;
        settingsPanel.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) updateSettingsPanel();
    }

    private void updateSettingsPanel() {
        if (settingsPanel == null) return;
        settingsPanel.removeAllViews();
        addSettingsLabel(settingsPanel, "跳过:");
        for (int sec : new int[]{5,10,15,30,60}) {
            Button b = new Button(this);
            b.setText(sec + "s");
            b.setTextColor(sec == currentSeekSeconds ? 0xFFFFFFFF : 0x99FFFFFF);
            b.setTextSize(11);
            b.setPadding(8, 3, 8, 3);
            b.setBackgroundColor(sec == currentSeekSeconds ? 0x66E50914 : 0x33FFFFFF);
            int finalSec = sec;
            b.setOnClickListener(v -> {
                currentSeekSeconds = finalSec;
                saveFsPrefs();
                updateSettingsPanel();
            });
            settingsPanel.addView(b);
        }
        addSettingsLabel(settingsPanel, " 倍速:");
        for (float spd : new float[]{0.5f,0.75f,1.0f,1.25f,1.5f,2.0f}) {
            Button b = new Button(this);
            b.setText(String.valueOf(spd) + "x");
            b.setTextColor(Math.abs(spd - currentPlaybackSpeed) < 0.01f ? 0xFFFFFFFF : 0x99FFFFFF);
            b.setTextSize(11);
            b.setPadding(8, 3, 8, 3);
            b.setBackgroundColor(Math.abs(spd - currentPlaybackSpeed) < 0.01f ? 0x66E50914 : 0x33FFFFFF);
            float finalSpd = spd;
            b.setOnClickListener(v -> {
                currentPlaybackSpeed = finalSpd;
                updateSpeedBtnText();
                webView.evaluateJavascript(
                    "var v=document.querySelector('#playerArea video');if(v)v.playbackRate=" + finalSpd + ";", null);
                saveFsPrefs();
                updateSettingsPanel();
            });
            settingsPanel.addView(b);
        }
    }

    private void addSettingsLabel(LinearLayout panel, String text) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextColor(0xCCCCCC);
        label.setTextSize(11);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(6, 0, 4, 0);
        panel.addView(label, lp);
    }

    private void saveFsPrefs() {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences("yunshao_fs", MODE_PRIVATE);
            android.content.SharedPreferences.Editor editor = prefs.edit();
            editor.putInt("seek_sec", currentSeekSeconds);
            editor.putFloat("speed", currentPlaybackSpeed);
            editor.putString("ratio", currentVideoRatio);
            editor.apply();
        } catch (Exception e) {}
    }

    private void loadFsPrefs() {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences("yunshao_fs", MODE_PRIVATE);
            currentSeekSeconds = prefs.getInt("seek_sec", 10);
            currentPlaybackSpeed = prefs.getFloat("speed", 1.0f);
            currentVideoRatio = prefs.getString("ratio", "contain");
        } catch (Exception e) {}
    }

    /**
     * 退出全屏
     */
    private void exitFullscreenInternal() {
        if (!isFullscreen) return;
        isFullscreen = false;
        handler.removeCallbacksAndMessages(null);
        // 不再强制竖屏！让设备保持当前方向（平板横屏时退出全屏不应切回竖屏）
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        
        // 清除全屏flags，恢复状态栏区域
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        
        // 移除全屏内容
        fullscreenContainer.removeAllViews();
        fullscreenContainer.setVisibility(View.GONE);
        
        // 将全屏容器从DecorView移回rootView
        FrameLayout decorView = (FrameLayout) getWindow().getDecorView();
        decorView.removeView(fullscreenContainer);
        rootView.addView(fullscreenContainer, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        
        // 恢复WebView
        webView.setVisibility(View.VISIBLE);
        
        // 通知WebView退出自定义视图
        if (customViewCallback != null) {
            try { customViewCallback.onCustomViewHidden(); } catch (Exception e) {}
            customViewCallback = null;
        }
        customView = null;
        
        showSystemBars();
        
        // 通知JS退出全屏状态，并重新触发布局检测（恢复横屏模式）
        webView.evaluateJavascript(
            "if(typeof isCSSFullscreen!=='undefined'){isCSSFullscreen=false;}" +
            "var pa=document.getElementById('playerArea');if(pa){pa.classList.remove('player-fullscreen');}" +
            "var dp=document.getElementById('detailPage');if(dp){dp.style.overflow='';dp.querySelectorAll('.top-bar,.detail-info,.episodes-section,.detail-actions,.source-tabs').forEach(function(e){e.style.display='';});}" +
            "document.querySelectorAll('.bottom-nav').forEach(function(e){e.style.display='';});" +
            "var v=document.querySelector('#playerArea video');if(v){v.classList.remove('fullscreen-video');v.style.objectFit='';v.style.aspectRatio='';v.style.width='';v.style.height='';}" +
            "if(typeof isPlaying!=='undefined'&&isPlaying){var mb=document.getElementById('miniPlayerBar');if(mb){mb.style.display='';}}" +
            "if(typeof applyLayout==='function')applyLayout(localStorage.getItem('ys_layout')||'auto');",
            null
        );
        
        // 恢复主题状态栏
        if (isDarkTheme) setDarkStatusBar(); else setLightStatusBar();
    }

    /**
     * 屏幕旋转或尺寸变化时重新注入物理尺寸，触发前端重新布局
     */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView == null) return;
        // 全屏播放中不让 Activity 重启，但需更新视频比例
        if (isFullscreen) {
            applyVideoRatio(currentVideoRatio);
            return;
        }
        runOnUiThread(() -> {
            android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
            getWindowManager().getDefaultDisplay().getRealMetrics(dm);
            int physW = dm.widthPixels;
            int physH = dm.heightPixels;
            webView.evaluateJavascript(
                "window.__screenW=" + physW + ";window.__screenH=" + physH +
                ";if(typeof applyLayout==='function')applyLayout(localStorage.getItem('ys_layout')||'auto');",
                null
            );
        });
    }

    @Override
    public void onBackPressed() {
        if (isFullscreen) {
            exitFullscreenInternal();
            return;
        }
        // 检查JS层是否处于CSS全屏状态
        webView.evaluateJavascript(
            "(function(){" +
            "  if(typeof isCSSFullscreen!=='undefined'&&isCSSFullscreen){" +
            "    if(typeof exitFullscreenMode==='function')exitFullscreenMode();" +
            "    return 'fullscreen';" +
            "  }" +
            "  var page=document.querySelector('.page.active');" +
            "  var mainPages=['homePage','catPage','tvPage','profilePage'];" +
            "  if(page&&!mainPages.includes(page.id)){" +
            "    if(typeof goBack==='function')goBack();" +
            "    return 'back';" +
            "  }" +
            "  return 'exit';" +
            "})()",
            result -> {
                String r = result != null ? result.replace("\"", "").trim() : "exit";
                if ("exit".equals(r)) {
                    if (doubleBackToExit) {
                        MainActivity.super.onBackPressed();
                    } else {
                        doubleBackToExit = true;
                        // 用JS显示toast提示
                        webView.evaluateJavascript("if(typeof showToast==='function')showToast('再按一次退出云梢');", null);
                        new Handler(Looper.getMainLooper()).postDelayed(() -> doubleBackToExit = false, 2000);
                    }
                }
            }
        );
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (server != null) server.stop();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    /**
     * 隐藏系统栏 - 全屏播放时
     */
    private void hideSystemBars() {
        Window window = getWindow();
        View decorView = window.getDecorView();
        
        // FLAG_FULLSCREEN: 真正隐藏状态栏，不占位
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // FLAG_LAYOUT_NO_LIMITS: 让内容延伸到导航栏区域
        window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

        int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        decorView.setSystemUiVisibility(flags);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                window.getInsetsController().hide(
                    android.view.WindowInsets.Type.statusBars()
                    | android.view.WindowInsets.Type.navigationBars()
                );
                window.getInsetsController().setSystemBarsBehavior(
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            } catch (Exception e) {}
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        }
    }

    /**
     * 显示系统栏
     */
    private void showSystemBars() {
        Window window = getWindow();
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                window.getInsetsController().show(
                    android.view.WindowInsets.Type.statusBars()
                    | android.view.WindowInsets.Type.navigationBars()
                );
            } catch (Exception e) {}
        }
    }

    /**
     * 浅色状态栏
     */
    private void setLightStatusBar() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(0xFFF0F2F7);
            window.setNavigationBarColor(0xFFFFFFFF);
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    /**
     * 深色状态栏
     */
    private void setDarkStatusBar() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(0xFF0A0E27);
            window.setNavigationBarColor(0xFF151934);
            int flags = View.SYSTEM_UI_FLAG_VISIBLE;
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }
}
