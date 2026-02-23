package com.opencloud.android;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AuthWebView")
public class AuthWebViewPlugin extends Plugin {

    @SuppressLint("SetJavaScriptEnabled")
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String redirectPattern = call.getString("redirectPattern", "http://localhost");

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        final String matchPattern = redirectPattern;

        getActivity().runOnUiThread(() -> {
            Dialog dialog = new Dialog(getActivity(), android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

            WebView webView = new WebView(getActivity());
            webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ));
            webView.setBackgroundColor(Color.parseColor("#0b1220"));

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/128.0.0.0 Mobile Safari/537.36"
            );

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);

            webView.setWebChromeClient(new WebChromeClient());

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String loadUrl = request.getUrl().toString();

                    if (loadUrl.startsWith(matchPattern)) {
                        JSObject result = new JSObject();
                        result.put("url", loadUrl);
                        call.resolve(result);
                        dialog.dismiss();
                        return true;
                    }

                    return false;
                }

                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    if (url.startsWith(matchPattern)) {
                        JSObject result = new JSObject();
                        result.put("url", url);
                        call.resolve(result);
                        dialog.dismiss();
                        return;
                    }
                    super.onPageStarted(view, url, favicon);
                }
            });

            dialog.setContentView(webView);
            dialog.setOnCancelListener(d -> {
                webView.stopLoading();
                webView.destroy();
                call.reject("Login cancelled by user");
            });

            dialog.show();
            webView.loadUrl(url);
        });
    }
}
