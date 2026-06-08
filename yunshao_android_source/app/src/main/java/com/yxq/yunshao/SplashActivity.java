package com.yxq.yunshao;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import android.webkit.WebSettings;

/**
 * 启动页 - 展示云梢品牌动画后跳转MainActivity
 * 加载splash.html实现精致的品牌启动动画
 */
public class SplashActivity extends Activity {

    private static final int SPLASH_DURATION = 2500; // 2.5秒（含动画）
    private Handler handler = new Handler(Looper.getMainLooper());
    private boolean jumped = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 设置浅色状态栏和导航栏，避免跳转时闪烁
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(0xFFF5F6F8);
            window.setNavigationBarColor(0xFFF5F6F8);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            int flags = getWindow().getDecorView().getSystemUiVisibility();
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }

        WebView webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        webView.setBackgroundColor(0xFFF5F6F8); // #f5f6f8
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        setContentView(webView);
        webView.loadUrl("file:///android_asset/splash.html");

        // 预启动后端服务器，让MainActivity跳转后秒开
        try {
            YunShaoServer preServer = new YunShaoServer(getApplicationContext());
            preServer.start(8989, true);
            preServer.warmupHomeCache(); // 预热首页缓存
            MainActivity.sharedServer = preServer;
        } catch (Exception e) {
            // 预启动失败不要阻塞，MainActivity会再次尝试
        }

        handler.postDelayed(() -> {
            if (!jumped) {
                jumped = true;
                startActivity(new Intent(SplashActivity.this, MainActivity.class));
                finish();
                // 去掉过渡动画，避免闪烁
                overridePendingTransition(0, 0);
            }
        }, SPLASH_DURATION);
    }

    @Override
    public void onBackPressed() {
        // 启动页不允许返回
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 不再需要重新设置沉浸模式，保持浅色状态栏即可
    }
}
