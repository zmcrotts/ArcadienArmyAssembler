package com.zmcrotts.arcadienarmyassembler;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4102;
    // The same hosted, offline-capable mobile app used on iPad/iPhone. Keeping
    // Android on this HTTPS origin lets the manual OneDrive flow return to this
    // installed app after Microsoft sign-in.
    private static final String HOSTED_APP_URL = "https://arcadien-army-assembler-mobile.zmcrotts.chatgpt.site/";
    private static final String HOSTED_APP_HOST = "arcadien-army-assembler-mobile.zmcrotts.chatgpt.site";
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout appFrame = new FrameLayout(this);
        appFrame.setBackgroundColor(Color.rgb(11, 17, 24));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(11, 17, 24));
        appFrame.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        appFrame.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int left;
            int top;
            int right;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets safeInsets = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                left = safeInsets.left;
                top = safeInsets.top;
                right = safeInsets.right;
                bottom = safeInsets.bottom;
            } else {
                left = windowInsets.getSystemWindowInsetLeft();
                top = windowInsets.getSystemWindowInsetTop();
                right = windowInsets.getSystemWindowInsetRight();
                bottom = windowInsets.getSystemWindowInsetBottom();
            }
            int minimumCameraClearance = Math.round(40 * getResources().getDisplayMetrics().density);
            view.setPadding(left, Math.max(top, minimumCameraClearance), right, bottom);
            return windowInsets;
        });
        setContentView(appFrame);
        appFrame.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new AndroidFiles(), "AndroidFiles");
        webView.setWebViewClient(new LocalWebViewClient());
        webView.setWebChromeClient(new LocalWebChromeClient());

        webView.clearCache(true);
        webView.loadUrl(HOSTED_APP_URL + "?v=" + BuildConfig.VERSION_CODE);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidFiles");
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] result = resultCode == RESULT_OK
                ? WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                : null;
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private final class LocalWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                return true;
            } catch (Exception error) {
                fileChooserCallback = null;
                Toast.makeText(MainActivity.this, "No file picker is available.", Toast.LENGTH_LONG).show();
                return false;
            }
        }
    }

    private final class LocalWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            if ("file".equalsIgnoreCase(uri.getScheme()) || "blob".equalsIgnoreCase(uri.getScheme())) return false;
            if ("https".equalsIgnoreCase(uri.getScheme()) && (
                HOSTED_APP_HOST.equals(host)
                || "login.microsoftonline.com".equals(host)
                || "login.live.com".equals(host)
                || "account.live.com".equals(host)
            )) return false;
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        }
    }

    public final class AndroidFiles {
        @JavascriptInterface
        public boolean copyText(String text) {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("Arcadien roster", text == null ? "" : text));
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public void saveText(String requestedName, String text) {
            String fileName = safeFileName(requestedName);
            byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType(fileName));
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Arcadien Army Assembler");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new IllegalStateException("Could not create download.");
                    try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
                        if (stream == null) throw new IllegalStateException("Could not open download.");
                        stream.write(bytes);
                    }
                } else {
                    File directory = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Arcadien Army Assembler");
                    if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Could not create download folder.");
                    try (OutputStream stream = new FileOutputStream(new File(directory, fileName))) {
                        stream.write(bytes);
                    }
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Saved " + fileName, Toast.LENGTH_LONG).show());
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not save " + fileName, Toast.LENGTH_LONG).show());
            }
        }

        private String safeFileName(String requestedName) {
            String name = requestedName == null ? "roster.txt" : requestedName.trim();
            name = name.replaceAll("[\\\\/:*?\"<>|]", "-");
            return name.isEmpty() ? "roster.txt" : name;
        }

        private String mimeType(String fileName) {
            String extension = MimeTypeMap.getFileExtensionFromUrl(fileName);
            String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            return type == null ? "text/plain" : type;
        }
    }
}
