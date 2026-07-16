package com.zmcrotts.arcadienarmyassembler;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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

import org.json.JSONObject;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.net.URLEncoder;
import java.security.KeyStore;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.util.Base64;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private static final String ONEDRIVE_CLIENT_ID = "30500f7e-c454-428c-8f16-c0318ae6174b";
    private static final String ONEDRIVE_SCOPE = "offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
    private static final String MICROSOFT_DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
    private static final String MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
    private static final String ONEDRIVE_KEY_ALIAS = "arcadien-onedrive-refresh-token";
    private static final String ONEDRIVE_PREFS = "arcadien-onedrive";
    private static final String ONEDRIVE_REFRESH_TOKEN = "refresh-token";
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private volatile String oneDriveAccessToken;
    private volatile long oneDriveAccessTokenExpiresAt;
    private volatile String lastOneDriveConnectionError = "";
    private boolean oneDriveSignInInProgress;

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
        // The bundled UI is trusted app content. This allows it to call the
        // narrowly-scoped Microsoft Graph endpoint after native sign-in.
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new AndroidFiles(), "AndroidFiles");
        webView.addJavascriptInterface(new AndroidOneDrive(), "AndroidOneDrive");
        webView.setWebViewClient(new LocalWebViewClient());
        webView.setWebChromeClient(new LocalWebChromeClient());

        webView.clearCache(true);
        webView.loadUrl("file:///android_asset/www/index.html?v=" + BuildConfig.VERSION_CODE);
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
            webView.removeJavascriptInterface("AndroidOneDrive");
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
            if ("file".equalsIgnoreCase(uri.getScheme()) || "blob".equalsIgnoreCase(uri.getScheme())) return false;
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

    public final class AndroidOneDrive {
        @JavascriptInterface
        public String getCachedAccessToken() {
            if (oneDriveAccessToken == null || oneDriveAccessTokenExpiresAt <= System.currentTimeMillis()) return "";
            return oneDriveAccessToken;
        }

        @JavascriptInterface
        public void beginSignIn() {
            synchronized (MainActivity.this) {
                if (oneDriveSignInInProgress) return;
                oneDriveSignInInProgress = true;
            }
            new Thread(() -> {
                if (!refreshOneDriveAccessToken()) {
                    if (!lastOneDriveConnectionError.isEmpty()) {
                        showOneDriveConnectionProblem(lastOneDriveConnectionError);
                    }
                    runOneDriveDeviceSignIn();
                }
            }).start();
        }

        @JavascriptInterface
        public void disconnect() {
            oneDriveAccessToken = null;
            oneDriveAccessTokenExpiresAt = 0;
            securePreferences().edit().remove(ONEDRIVE_REFRESH_TOKEN).commit();
        }
    }

    private void runOneDriveDeviceSignIn() {
        try {
            Map<String, String> deviceRequest = new LinkedHashMap<>();
            deviceRequest.put("client_id", ONEDRIVE_CLIENT_ID);
            deviceRequest.put("scope", ONEDRIVE_SCOPE);
            JSONObject device = postMicrosoftForm(MICROSOFT_DEVICE_CODE_URL, deviceRequest);
            if (device.has("error")) {
                throw new IllegalStateException(device.optString("error_description", "Microsoft sign-in could not start."));
            }

            String deviceCode = device.getString("device_code");
            String userCode = device.getString("user_code");
            String verificationUri = device.getString("verification_uri");
            int intervalSeconds = Math.max(3, device.optInt("interval", 5));
            showOneDriveCode(userCode, verificationUri);

            long deadline = System.currentTimeMillis() + (Math.max(60, device.optInt("expires_in", 900)) * 1000L);
            while (System.currentTimeMillis() < deadline) {
                try { Thread.sleep(intervalSeconds * 1000L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); return; }
                Map<String, String> tokenRequest = new LinkedHashMap<>();
                tokenRequest.put("client_id", ONEDRIVE_CLIENT_ID);
                tokenRequest.put("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
                tokenRequest.put("device_code", deviceCode);
                JSONObject token;
                try {
                    token = postMicrosoftForm(MICROSOFT_TOKEN_URL, tokenRequest);
                } catch (IOException transientError) {
                    continue;
                }
                if (token.has("access_token")) {
                    acceptOneDriveToken(token);
                    notifyOneDriveResult(oneDriveAccessToken, null);
                    return;
                }
                String error = token.optString("error", "");
                if ("authorization_pending".equals(error)) continue;
                if ("slow_down".equals(error)) { intervalSeconds += 5; continue; }
                throw new IllegalStateException(token.optString("error_description", "Microsoft sign-in could not finish."));
            }
            throw new IllegalStateException("Microsoft sign-in timed out. Press Sync to try again.");
        } catch (Exception error) {
            notifyOneDriveResult(null, error.getMessage());
        } finally {
            synchronized (MainActivity.this) { oneDriveSignInInProgress = false; }
        }
    }

    private boolean refreshOneDriveAccessToken() {
        lastOneDriveConnectionError = "";
        String refreshToken = readRefreshToken();
        if (refreshToken.isEmpty()) return false;
        try {
            Map<String, String> request = new LinkedHashMap<>();
            request.put("client_id", ONEDRIVE_CLIENT_ID);
            request.put("grant_type", "refresh_token");
            request.put("refresh_token", refreshToken);
            request.put("scope", ONEDRIVE_SCOPE);
            JSONObject token = postMicrosoftForm(MICROSOFT_TOKEN_URL, request);
            if (!token.has("access_token")) {
                lastOneDriveConnectionError = token.optString("error_description", "The saved OneDrive connection was rejected by Microsoft.");
                securePreferences().edit().remove(ONEDRIVE_REFRESH_TOKEN).commit();
                return false;
            }
            acceptOneDriveToken(token);
            notifyOneDriveResult(oneDriveAccessToken, null);
            synchronized (MainActivity.this) { oneDriveSignInInProgress = false; }
            return true;
        } catch (Exception error) {
            lastOneDriveConnectionError = error.getMessage() == null ? "The saved OneDrive connection could not be restored." : error.getMessage();
            return false;
        }
    }

    private void acceptOneDriveToken(JSONObject token) throws Exception {
        oneDriveAccessToken = token.getString("access_token");
        oneDriveAccessTokenExpiresAt = System.currentTimeMillis() + Math.max(60, token.optInt("expires_in", 3600) - 60) * 1000L;
        String refreshToken = token.optString("refresh_token", "");
        if (refreshToken.isEmpty()) throw new IllegalStateException("Microsoft did not provide a refresh credential. Try Sync again.");
        writeRefreshToken(refreshToken);
        if (!refreshToken.equals(readRefreshToken())) throw new IllegalStateException("OneDrive connection could not be saved securely on this device.");
    }

    private SharedPreferences securePreferences() {
        return getSharedPreferences(ONEDRIVE_PREFS, MODE_PRIVATE);
    }

    private void writeRefreshToken(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, oneDriveKey());
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
            + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!securePreferences().edit().putString(ONEDRIVE_REFRESH_TOKEN, encoded).commit()) {
            throw new IllegalStateException("OneDrive connection could not be saved securely on this device.");
        }
    }

    private String readRefreshToken() {
        try {
            String stored = securePreferences().getString(ONEDRIVE_REFRESH_TOKEN, "");
            String[] parts = stored.split(":", 2);
            if (parts.length != 2) return "";
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, oneDriveKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception error) {
            lastOneDriveConnectionError = error.getMessage() == null ? "The saved OneDrive connection could not be read." : error.getMessage();
            return "";
        }
    }

    private SecretKey oneDriveKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(ONEDRIVE_KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(ONEDRIVE_KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ONEDRIVE_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    private JSONObject postMicrosoftForm(String endpoint, Map<String, String> values) throws Exception {
        StringBuilder body = new StringBuilder();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (body.length() > 0) body.append('&');
            body.append(URLEncoder.encode(entry.getKey(), "UTF-8"));
            body.append('=').append(URLEncoder.encode(entry.getValue(), "UTF-8"));
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setDoOutput(true);
        try (OutputStream stream = connection.getOutputStream()) {
            stream.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) text.append(line);
            }
        }
        return new JSONObject(text.toString());
    }

    private void showOneDriveCode(String userCode, String verificationUri) {
        runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
            .setTitle("Connect OneDrive")
            .setMessage("Microsoft will ask for this one-time code:\n\n" + userCode + "\n\nYour password stays with Microsoft. After approving, return here and the manual sync will continue.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Open Microsoft", (dialog, which) -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(verificationUri))); }
                catch (Exception error) { Toast.makeText(MainActivity.this, "Could not open Microsoft sign-in.", Toast.LENGTH_LONG).show(); }
            })
            .show());
    }

    private void showOneDriveConnectionProblem(String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, "Saved OneDrive connection failed: " + message, Toast.LENGTH_LONG).show());
    }

    private void notifyOneDriveResult(String token, String error) {
        if (error != null && !error.isEmpty()) showOneDriveConnectionProblem(error);
        String script = "window.OneDriveRosterSync && window.OneDriveRosterSync.androidAccessTokenReceived("
            + JSONObject.quote(token == null ? "" : token) + ","
            + JSONObject.quote(error == null ? "" : error) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
