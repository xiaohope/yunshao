package com.yxq.yunshao;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
                    isFullscreen = true;
                    isPortraitVideo = isPortrait;
                    // v3.20: 根据视频画幅自动旋转屏幕方向
                    // 横屏视频 → 强制横屏 (SENSOR_LANDSCAPE 允许 180° 翻转)
                    // 竖屏视频 → 强制竖屏
                    if (isPortrait) {
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    } else {
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    }
                    // 隐藏系统栏 + 走 CSS 全屏方案（不再依赖 onShowCustomView）
                    hideSystemBars();
                    webView.evaluateJavascript(
                        "if(typeof applyFullscreenCSS==='function')applyFullscreenCSS();",
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

            // ========== 全屏系统UI控制（CSS全屏方案使用）==========
            // 进入全屏：隐藏系统栏
            @JavascriptInterface
            public void hideSystemUI() {
                runOnUiThread(() -> hideSystemBars());
            }

            // 退出全屏：恢复系统栏
            @JavascriptInterface
            public void showSystemUI() {
                runOnUiThread(() -> {
                    showSystemBars();
                    // 恢复状态栏样式
                    if (isDarkTheme) setDarkStatusBar(); else setLightStatusBar();
                });
            }

            // 全屏方向控制（JS调用，根据视频宽高比自动旋转屏幕）
            @JavascriptInterface
            public void setOrientation(String mode) {
                runOnUiThread(() -> {
                    switch (mode) {
                        case "landscape":
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                            break;
                        case "portrait":
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                            break;
                        default:
                            // 用 SENSOR 而不是 UNSPECIFIED，确保立即恢复自动旋转
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
                            break;
                    }
                });
            }
        }, "YunShaoNative");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                // 禁用原生全屏：直接通知系统已隐藏，防止视频View被移走导致退出后黑屏
                callback.onCustomViewHidden();
            }

            @Override
            public void onHideCustomView() {
                // CSS全屏方案：不再使用原生全屏，由JS的popstate事件处理返回键
            }
        });

        webView.loadUrl("http://localhost:8989");
    }

    /**
     * 在全屏容器上叠加原生控件
     */
    private void addFullscreenControls() {
        // ========== 顶部控制栏 ==========
        topBarView = new LinearLayout(this);
        topBarView.setOrientation(LinearLayout.HORIZONTAL);
        topBarView.setGravity(Gravity.CENTER_VERTICAL);
        topBarView.setPadding(24, 36, 24, 16);
        GradientDrawable topBg = new GradientDrawable(
            GradientDrawable.Orientation.BOTTOM_TOP,
            new int[]{0xBB000000, 0xFF000000}
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
        backBtn.setText("← 返回");
        backBtn.setTextColor(0xFFFFFFFF);
        backBtn.setBackgroundColor(0x00000000);
        backBtn.setTextSize(16);
        backBtn.setPadding(20, 10, 20, 10);
        backBtn.setOnClickListener(v -> exitFullscreenInternal());
        topBarView.addView(backBtn);
        
        // 弹性空间
        View spacer = new View(this);
        LinearLayout.LayoutParams spacerParams = new LinearLayout.LayoutParams(0, 1, 1.0f);
        topBarView.addView(spacer, spacerParams);
        
        // 快退按钮（长按连续快退10秒）
        Button rewindBtn = new Button(this);
        rewindBtn.setText("«10s");
        rewindBtn.setTextColor(0xFFFFFFFF);
        rewindBtn.setTextSize(12);
        rewindBtn.setPadding(16, 6, 16, 6);
        rewindBtn.setBackgroundColor(0x33FFFFFF);
        rewindBtn.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    seekVideo(-10);
                    isSeeking = true;
                    seekDirection = -1;
                    handler.removeCallbacks(seekRunnable);
                    seekRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (isSeeking) {
                                seekVideo(seekDirection * 10);
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
        LinearLayout.LayoutParams rewindParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        rewindParams.setMargins(4, 0, 4, 0);
        topBarView.addView(rewindBtn, rewindParams);

        // 倍速按钮
        speedBtn = new Button(this);
        speedBtn.setText("1.0x");
        speedBtn.setTextColor(0xFFFFFFFF);
        speedBtn.setTextSize(12);
        speedBtn.setPadding(16, 6, 16, 6);
        speedBtn.setBackgroundColor(0x33FFFFFF);
        speedBtn.setOnClickListener(v -> {
            PopupMenu popup = new PopupMenu(this, v);
            String[] speedLabels = {"0.5x", "0.75x", "1.0x", "1.25x", "1.5x", "2.0x"};
            float[] speedValues = {0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f};
            Menu menu = popup.getMenu();
            for (int i = 0; i < speedLabels.length; i++) {
                menu.add(0, i, i, speedLabels[i]);
            }
            popup.setOnMenuItemClickListener(item -> {
                int idx = item.getItemId();
                currentPlaybackSpeed = speedValues[idx];
                speedBtn.setText(speedLabels[idx]);
                webView.evaluateJavascript(
                    "var v=document.querySelector('#playerArea video');if(v)v.playbackRate=" + currentPlaybackSpeed + ";",
                    null
                );
                return true;
            });
            popup.show();
        });
        LinearLayout.LayoutParams speedParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        speedParams.setMargins(4, 0, 4, 0);
        topBarView.addView(speedBtn, speedParams);

        // 快进按钮（长按连续快进10秒）
        Button forwardBtn = new Button(this);
        forwardBtn.setText("10s»");
        forwardBtn.setTextColor(0xFFFFFFFF);
        forwardBtn.setTextSize(12);
        forwardBtn.setPadding(16, 6, 16, 6);
        forwardBtn.setBackgroundColor(0x33FFFFFF);
        forwardBtn.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    seekVideo(10);
                    isSeeking = true;
                    seekDirection = 1;
                    handler.removeCallbacks(seekRunnable);
                    seekRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (isSeeking) {
                                seekVideo(seekDirection * 10);
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
        LinearLayout.LayoutParams forwardParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        forwardParams.setMargins(4, 0, 4, 0);
        topBarView.addView(forwardBtn, forwardParams);
        
        // 比例按钮组
        String[] ratios = {"默认", "16:9", "4:3", "填充"};
        String[] ratioValues = {"contain", "16/9", "4/3", "cover"};
        for (int i = 0; i < ratios.length; i++) {
            Button btn = new Button(this);
            btn.setText(ratios[i]);
            btn.setTextColor(0xFFFFFFFF);
            btn.setTextSize(12);
            btn.setPadding(16, 6, 16, 6);
            final String ratio = ratioValues[i];
            btn.setOnClickListener(v -> {
                currentVideoRatio = ratio;
                applyVideoRatio(ratio);
                updateRatioButtons(ratio);
            });
            btn.setTag("ratio_" + ratioValues[i]);
            if (ratioValues[i].equals(currentVideoRatio)) {
                btn.setBackgroundColor(0x66FFFFFF);
            } else {
                btn.setBackgroundColor(0x33FFFFFF);
            }
            LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            btnParams.setMargins(4, 0, 4, 0);
            topBarView.addView(btn, btnParams);
        }
        
        fullscreenContainer.addView(topBarView, topParams);
        
        // ========== 底部播放控制栏 ==========
        bottomBar = new LinearLayout(this);
        bottomBar.setOrientation(LinearLayout.VERTICAL);
        bottomBar.setPadding(24, 12, 24, 24);
        // 渐变黑背景，遮盖原生进度条
        GradientDrawable bottomBg = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{0xBB000000, 0xFF000000}
        );
        bottomBar.setBackground(bottomBg);
        bottomBar.setMinimumHeight(120);
        bottomBar.setTag("bottomBar");
        
        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        bottomParams.gravity = Gravity.BOTTOM;
        
        // 进度条
        seekBar = new SeekBar(this);
        seekBar.setMax(1000);
        seekBar.setProgress(0);
        seekBar.setPadding(0, 8, 0, 8);
        seekBar.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFE50914));
        seekBar.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF4A4A4A));
        seekBar.setThumbTintList(android.content.res.ColorStateList.valueOf(0xFFFFFFFF));
        seekBar.setSplitTrack(false);
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) {
                if (fromUser) {
                    float pct = progress / 1000f;
                    webView.evaluateJavascript(
                        "var v=document.querySelector('#playerArea video');if(v&&v.duration){v.currentTime=v.duration*" + pct + ";}",
                        null
                    );
                }
            }
            @Override
            public void onStartTrackingTouch(SeekBar sb) {}
            @Override
            public void onStopTrackingTouch(SeekBar sb) {}
        });
        bottomBar.addView(seekBar, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        
        // 播放暂停 + 时间行
        LinearLayout ctrlRow = new LinearLayout(this);
        ctrlRow.setOrientation(LinearLayout.HORIZONTAL);
        ctrlRow.setGravity(Gravity.CENTER_VERTICAL);
        
        playPauseBtn = new Button(this);
        playPauseBtn.setText("❚❚");
        playPauseBtn.setTextColor(0xFFFFFFFF);
        playPauseBtn.setBackgroundColor(0x00000000);
        playPauseBtn.setTextSize(18);
        playPauseBtn.setPadding(8, 4, 16, 4);
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
        ctrlRow.addView(playPauseBtn);
        
        timeText = new TextView(this);
        timeText.setText("00:00 / 00:00");
        timeText.setTextColor(0xFFFFFFFF);
        timeText.setTextSize(12);
        LinearLayout.LayoutParams timeParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        timeParams.setMargins(8, 0, 0, 0);
        ctrlRow.addView(timeText, timeParams);
        
        bottomBar.addView(ctrlRow, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        
        fullscreenContainer.addView(bottomBar, bottomParams);
        
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
            if (show) {
                scheduleHideControls(5000);
            }
        });
        
        // 确保控制栏在触摸层上方
        topBarView.bringToFront();
        bottomBar.bringToFront();
        
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

    /**
     * 退出全屏
     */
    private void exitFullscreenInternal() {
        if (!isFullscreen) return;
        isFullscreen = false;
        handler.removeCallbacksAndMessages(null);
        
        // 1. 先 JS 清理 DOM（move pa back, remove fs-exit-btn, 恢复页面布局）
        //    必须等 JS 跑完再转屏，否则半全屏半正常态 → 渲染错乱 → 黑屏
        webView.evaluateJavascript(
            "if(typeof removeFullscreenCSS==='function')removeFullscreenCSS();",
            result -> {
                // JS 清理完成 → 安全恢复方向（回调在 UI 线程执行）
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                if (isDarkTheme) setDarkStatusBar(); else setLightStatusBar();
            }
        );
        
        // 2. 立即清理 UI 层（fullscreenContainer、flags 等）——立即恢复系统栏
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        
        fullscreenContainer.removeAllViews();
        fullscreenContainer.setVisibility(View.GONE);
        topBarView = null;
        bottomBar = null;
        touchLayerView = null;
        seekBar = null;
        timeText = null;
        playPauseBtn = null;
        speedBtn = null;
        
        FrameLayout decorView = (FrameLayout) getWindow().getDecorView();
        if (fullscreenContainer.getParent() == decorView) {
            decorView.removeView(fullscreenContainer);
            rootView.addView(fullscreenContainer, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ));
        }
        // fullscreenContainer 始终隐藏（CSS全屏方案不使用原生控制层）
        fullscreenContainer.setVisibility(View.GONE);
        
        webView.setVisibility(View.VISIBLE);
        
        if (customViewCallback != null) {
            try { customViewCallback.onCustomViewHidden(); } catch (Exception e) {}
            customViewCallback = null;
        }
        customView = null;
        
        // 3. 立即恢复系统栏（用户能立即看到导航栏/状态栏）
        showSystemBars();
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
        // v3.21.1: 全屏状态同步检测，避免 evaluateJavascript 异步竞态导致直接退出 App
        if (isFullscreen) {
            exitFullscreenInternal();
            return;
        }
        
        // 非全屏时，检查JS层是否需要返回上一页
        webView.evaluateJavascript(
            "(function(){" +
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
                if ("back".equals(r)) {
                    return;
                }
                if ("exit".equals(r)) {
                    if (doubleBackToExit) {
                        MainActivity.super.onBackPressed();
                    } else {
                        doubleBackToExit = true;
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

        // 清除全屏flags
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

        // 恢复系统UI可见性
        int flags = View.SYSTEM_UI_FLAG_VISIBLE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!isDarkTheme) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
        }
        decorView.setSystemUiVisibility(flags);

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
