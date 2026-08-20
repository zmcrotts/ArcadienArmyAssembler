package com.zmcrotts.arcadienarmyassembler;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.net.URLEncoder;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.util.Base64;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private static final int EXPORT_FILE_REQUEST = 4103;
    private static final String GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
    private static final String ONEDRIVE_CLIENT_ID = "30500f7e-c454-428c-8f16-c0318ae6174b";
    private static final String ONEDRIVE_SCOPE = "offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
    private static final String MICROSOFT_DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
    private static final String MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
    private static final String ONEDRIVE_KEY_ALIAS = "arcadien-onedrive-refresh-token";
    private static final String ONEDRIVE_PREFS = "arcadien-onedrive";
    private static final String ONEDRIVE_REFRESH_TOKEN = "refresh-token";
    private static final int MAX_ONEDRIVE_RESPONSE_BYTES = 10 * 1024 * 1024;
    private static final int MAX_UPDATE_BYTES = 150 * 1024 * 1024;
    private static final String UPDATE_MANIFEST_URL = "https://zmcrotts.github.io/ArcadienArmyAssembler/public-release.json";
    private static final String UPDATE_RELEASE_API = "https://api.github.com/repos/zmcrotts/ArcadienArmyAssembler/releases/latest";
    private static final String UPDATE_ASSET_BASE = "https://github.com/zmcrotts/ArcadienArmyAssembler/releases/latest/download/";
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingExportBytes;
    private String pendingExportName;
    private volatile String oneDriveAccessToken;
    private volatile long oneDriveAccessTokenExpiresAt;
    private volatile String lastOneDriveConnectionError = "";
    private boolean oneDriveSignInInProgress;
    private volatile boolean oneDriveSignInCancelled;
    private volatile Thread oneDriveSignInThread;
    private boolean forceExit;
    private String pendingRosterImportUrl;
    private volatile JSONObject availableUpdate;
    private boolean waitingForUnknownSourcesPermission;

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
            view.setPadding(left, top, right, bottom);
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
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new AndroidFiles(), "AndroidFiles");
        webView.addJavascriptInterface(new AndroidOneDrive(), "AndroidOneDrive");
        webView.addJavascriptInterface(new AndroidUpdates(), "AndroidUpdates");
        webView.setWebViewClient(new LocalWebViewClient());
        webView.setWebChromeClient(new LocalWebChromeClient());

        handleRosterImportIntent(getIntent());

        webView.clearCache(true);
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl("file:///android_asset/www/index.html?v=" + BuildConfig.VERSION_CODE);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRosterImportIntent(intent);
        deliverPendingRosterImport();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (waitingForUnknownSourcesPermission && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getPackageManager().canRequestPackageInstalls()) {
            waitingForUnknownSourcesPermission = false;
            openVerifiedUpdate();
        }
    }

    private void handleRosterImportIntent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !"arcadien".equalsIgnoreCase(uri.getScheme()) || !"import".equalsIgnoreCase(uri.getHost())) return;
        String code = uri.getQueryParameter("code");
        if (code == null || code.isEmpty() || code.length() > 2800) return;
        pendingRosterImportUrl = uri.toString();
    }

    private void deliverPendingRosterImport() {
        if (webView == null || pendingRosterImportUrl == null || webView.getProgress() < 100) return;
        String url = pendingRosterImportUrl;
        pendingRosterImportUrl = null;
        String script = "window.ArcadienApp && window.ArcadienApp.receiveRosterImportUrl(" + JSONObject.quote(url) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (forceExit || webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "Boolean(window.ArcadienApp && window.ArcadienApp.handleNativeBack && window.ArcadienApp.handleNativeBack())",
            handled -> {
                if ("true".equals(handled)) return;
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                confirmExitIfNeeded();
            }
        );
    }

    private void confirmExitIfNeeded() {
        webView.evaluateJavascript(
            "Boolean(window.ArcadienApp && window.ArcadienApp.hasUnsavedChanges && window.ArcadienApp.hasUnsavedChanges())",
            unsaved -> {
                if (!"true".equals(unsaved)) {
                    exitNow();
                    return;
                }
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Discard unsaved changes?")
                    .setMessage("This list has changes that have not been saved.")
                    .setNegativeButton("Keep editing", null)
                    .setPositiveButton("Discard and exit", (dialog, which) -> {
                        exitNow();
                    })
                    .show();
            }
        );
    }

    private void exitNow() {
        forceExit = true;
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        cancelOneDriveSignIn(false);
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidFiles");
            webView.removeJavascriptInterface("AndroidOneDrive");
            webView.removeJavascriptInterface("AndroidUpdates");
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
        if (requestCode == EXPORT_FILE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportBytes != null) {
                try (OutputStream stream = getContentResolver().openOutputStream(data.getData())) {
                    if (stream == null) throw new IllegalStateException("Could not open the selected file.");
                    stream.write(pendingExportBytes);
                    Toast.makeText(this, "Saved " + pendingExportName, Toast.LENGTH_LONG).show();
                } catch (Exception error) {
                    Toast.makeText(this, "Could not save " + pendingExportName, Toast.LENGTH_LONG).show();
                }
            }
            pendingExportBytes = null;
            pendingExportName = null;
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
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            deliverPendingRosterImport();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("blob".equalsIgnoreCase(uri.getScheme())) return false;
            if ("file".equalsIgnoreCase(uri.getScheme())) {
                String path = uri.getPath() == null ? "" : Uri.decode(uri.getPath());
                if (path.startsWith("/android_asset/www/") && !path.contains("..") && path.indexOf('\\') < 0) return false;
                Toast.makeText(MainActivity.this, "That local link was blocked.", Toast.LENGTH_LONG).show();
                return true;
            }
            if (!isTrustedExternal(uri)) {
                Toast.makeText(MainActivity.this, "That external link was blocked.", Toast.LENGTH_LONG).show();
                return true;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception error) {
                Toast.makeText(MainActivity.this, "No browser is available.", Toast.LENGTH_LONG).show();
            }
            return true;
        }
    }

    private boolean isTrustedExternal(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        return "ko-fi.com".equals(host) || "www.ko-fi.com".equals(host) || "login.microsoftonline.com".equals(host) || "zmcrotts.github.io".equals(host);
    }

    public final class AndroidUpdates {
        @JavascriptInterface
        public void checkForUpdates() {
            new Thread(() -> {
                try {
                    JSONObject update = fetchAndroidUpdate();
                    availableUpdate = update;
                    String current = BuildConfig.VERSION_NAME;
                    update.put("currentVersion", current);
                    update.put("state", compareVersions(update.getString("version"), current) > 0 ? "available" : "current");
                    notifyUpdate(update);
                } catch (Exception error) {
                    notifyUpdateError(error);
                }
            }, "arcadien-update-check").start();
        }

        @JavascriptInterface
        public void installAvailableUpdate() {
            new Thread(() -> {
                try {
                    JSONObject update = fetchAndroidUpdate();
                    if (compareVersions(update.getString("version"), BuildConfig.VERSION_NAME) <= 0) {
                        update.put("currentVersion", BuildConfig.VERSION_NAME);
                        update.put("state", "current");
                        notifyUpdate(update);
                        return;
                    }
                    downloadAndroidUpdate(update);
                    runOnUiThread(() -> requestUpdateInstallPermission());
                } catch (Exception error) {
                    notifyUpdateError(error);
                }
            }, "arcadien-update-download").start();
        }
    }

    private JSONObject fetchAndroidUpdate() throws Exception {
        HttpURLConnection connection = openUpdateConnection(UPDATE_MANIFEST_URL, 15000);
        int status = connection.getResponseCode();
        String body = status == 200 ? readLimitedBody(connection.getInputStream(), 256 * 1024) : null;
        connection.disconnect();
        JSONObject update;
        if (body != null) {
            update = new JSONObject(body).getJSONObject("android");
        } else {
            connection = openUpdateConnection(UPDATE_RELEASE_API, 15000);
            status = connection.getResponseCode();
            if (status != 200) throw new IOException("The update server returned " + status + ".");
            JSONObject release = new JSONObject(readLimitedBody(connection.getInputStream(), 512 * 1024));
            connection.disconnect();
            java.util.regex.Matcher versions = java.util.regex.Pattern.compile("^v(\\d+(?:\\.\\d+){1,3})-mobile-(\\d+(?:\\.\\d+){1,3})$").matcher(release.optString("tag_name", ""));
            if (!versions.matches()) throw new IOException("GitHub returned an invalid release tag.");
            JSONObject releaseAsset = null;
            org.json.JSONArray assets = release.optJSONArray("assets");
            for (int index = 0; assets != null && index < assets.length(); index++) {
                JSONObject candidate = assets.optJSONObject(index);
                if ("Arcadien-Army-Assembler-Android.apk".equals(candidate == null ? "" : candidate.optString("name", ""))) releaseAsset = candidate;
            }
            String digest = releaseAsset == null ? "" : releaseAsset.optString("digest", "");
            if (!digest.matches("(?i)^sha256:[a-f0-9]{64}$")) throw new IOException("GitHub returned incomplete Android release metadata.");
            update = new JSONObject();
            update.put("version", versions.group(2));
            update.put("asset", releaseAsset.getString("name"));
            update.put("sha256", digest.substring(7));
        }
        String version = update.optString("version", "");
        String asset = update.optString("asset", "");
        String sha256 = update.optString("sha256", "").toLowerCase(Locale.ROOT);
        if (!version.matches("^\\d+(?:\\.\\d+){1,3}$") || !asset.matches("^[A-Za-z0-9][A-Za-z0-9._ -]*\\.apk$") || asset.length() > 160 || !sha256.matches("^[a-f0-9]{64}$")) {
            throw new IOException("The release page returned invalid Android update details.");
        }
        JSONObject clean = new JSONObject();
        clean.put("version", version);
        clean.put("asset", asset);
        clean.put("sha256", sha256);
        return clean;
    }

    private HttpURLConnection openUpdateConnection(String value, int timeout) throws Exception {
        URL url = new URL(value);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IOException("The update URL was not secure.");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(timeout);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/json, application/octet-stream");
        return connection;
    }

    private void downloadAndroidUpdate(JSONObject update) throws Exception {
        String assetUrl = UPDATE_ASSET_BASE + java.net.URLEncoder.encode(update.getString("asset"), "UTF-8").replace("+", "%20");
        HttpURLConnection connection = openUpdateConnection(assetUrl, 180000);
        int status = connection.getResponseCode();
        URL finalUrl = connection.getURL();
        String host = finalUrl.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(finalUrl.getProtocol()) || !("github.com".equals(host) || "objects.githubusercontent.com".equals(host) || "release-assets.githubusercontent.com".equals(host))) {
            connection.disconnect();
            throw new IOException("The APK download was redirected to an untrusted server.");
        }
        if (status != 200) throw new IOException("The APK download returned " + status + ".");
        long total = connection.getContentLengthLong();
        if (total > MAX_UPDATE_BYTES) throw new IOException("The APK is larger than the 150 MB safety limit.");
        File target = UpdateFileProvider.updateFile(this);
        File directory = target.getParentFile();
        if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) throw new IOException("Could not prepare the update download folder.");
        File partial = new File(directory, UpdateFileProvider.FILE_NAME + ".partial");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long received = 0;
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial, false)) {
            byte[] buffer = new byte[32768];
            int read;
            while ((read = input.read(buffer)) != -1) {
                received += read;
                if (received > MAX_UPDATE_BYTES) throw new IOException("The APK exceeded the 150 MB safety limit.");
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
                notifyUpdateProgress(received, total);
            }
        } catch (Exception error) {
            partial.delete();
            throw error;
        } finally {
            connection.disconnect();
        }
        String actual = bytesToHex(digest.digest());
        if (!actual.equals(update.getString("sha256"))) {
            partial.delete();
            throw new IOException("The APK checksum did not match the published release. Nothing was opened.");
        }
        if (target.exists() && !target.delete()) throw new IOException("Could not replace the previous verified update.");
        if (!partial.renameTo(target)) throw new IOException("Could not finish the verified APK download.");
        availableUpdate = update;
    }

    private void requestUpdateInstallPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            waitingForUnknownSourcesPermission = true;
            notifyUpdateState("installing", "Android needs permission to install updates from this app. Allow it, then return here.");
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return;
        }
        openVerifiedUpdate();
    }

    private void openVerifiedUpdate() {
        File file = UpdateFileProvider.updateFile(this);
        if (!file.isFile()) {
            notifyUpdateState("error", "The verified APK is no longer available. Download it again.");
            return;
        }
        Uri uri = Uri.parse("content://" + getPackageName() + ".updates/" + UpdateFileProvider.FILE_NAME);
        Intent intent = new Intent(Intent.ACTION_VIEW, uri)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            notifyUpdateState("installing", "Follow Android's normal installation prompts.");
            startActivity(intent);
        } catch (Exception error) {
            notifyUpdateState("error", "Android could not open the package installer.");
        }
    }

    private static int compareVersions(String left, String right) {
        String[] a = left.split("\\.");
        String[] b = right.split("\\.");
        for (int index = 0; index < Math.max(a.length, b.length); index++) {
            int av = index < a.length ? Integer.parseInt(a[index]) : 0;
            int bv = index < b.length ? Integer.parseInt(b[index]) : 0;
            if (av != bv) return av > bv ? 1 : -1;
        }
        return 0;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private String readLimitedBody(InputStream stream, int maxBytes) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) throw new IOException("The update server response was too large.");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void notifyUpdate(JSONObject result) {
        String script = "window.ArcadienApp && window.ArcadienApp.receiveUpdateEvent(" + result.toString() + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void notifyUpdateError(Exception error) {
        notifyUpdateState("error", error.getMessage() == null ? "The update could not be completed." : error.getMessage());
    }

    private void notifyUpdateState(String state, String message) {
        JSONObject result = new JSONObject();
        try { result.put("state", state); result.put("message", message); } catch (Exception ignored) {}
        notifyUpdate(result);
    }

    private void notifyUpdateProgress(long received, long total) {
        JSONObject result = new JSONObject();
        try { result.put("state", "downloading"); result.put("received", received); result.put("total", total); } catch (Exception ignored) {}
        notifyUpdate(result);
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
        public void shareText(String title, String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_SUBJECT, title == null ? "Arcadien roster" : title);
                send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                try {
                    startActivity(Intent.createChooser(send, "Send roster"));
                } catch (Exception error) {
                    Toast.makeText(MainActivity.this, "No sharing app is available.", Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void saveText(String requestedName, String text) {
            String fileName = safeFileName(requestedName);
            byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
            runOnUiThread(() -> {
                pendingExportBytes = bytes;
                pendingExportName = fileName;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType(fileName));
                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(intent, EXPORT_FILE_REQUEST);
                } catch (Exception error) {
                    pendingExportBytes = null;
                    pendingExportName = null;
                    Toast.makeText(MainActivity.this, "No document saver is available.", Toast.LENGTH_LONG).show();
                }
            });
        }

        private String safeFileName(String requestedName) {
            String name = requestedName == null ? "roster.txt" : requestedName.trim();
            name = name.replaceAll("[\\\\/:*?\"<>|]", "-");
            if (name.length() > 120) name = name.substring(0, 120);
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
        public boolean hasCachedConnection() {
            return oneDriveAccessToken != null && oneDriveAccessTokenExpiresAt > System.currentTimeMillis()
                || !readRefreshToken().isEmpty();
        }

        @JavascriptInterface
        public void beginSignIn() {
            synchronized (MainActivity.this) {
                if (oneDriveSignInInProgress) return;
                oneDriveSignInInProgress = true;
                oneDriveSignInCancelled = false;
                oneDriveSignInThread = new Thread(() -> {
                    String errorMessage = null;
                    try {
                        if (!refreshOneDriveAccessToken(true)) runOneDriveDeviceSignIn();
                        if (oneDriveSignInCancelled) throw new InterruptedException("Microsoft sign-in was cancelled.");
                    } catch (Exception error) {
                        errorMessage = error.getMessage() == null ? "Microsoft sign-in could not finish." : error.getMessage();
                    } finally {
                        synchronized (MainActivity.this) {
                            oneDriveSignInInProgress = false;
                            if (oneDriveSignInThread == Thread.currentThread()) oneDriveSignInThread = null;
                        }
                    }
                    notifyOneDriveSignIn(errorMessage);
                }, "Arcadien-OneDrive-SignIn");
                oneDriveSignInThread.start();
            }
        }

        @JavascriptInterface
        public void cancelSignIn() {
            cancelOneDriveSignIn(true);
        }

        @JavascriptInterface
        public void disconnect() {
            cancelOneDriveSignIn(false);
            oneDriveAccessToken = null;
            oneDriveAccessTokenExpiresAt = 0;
            securePreferences().edit().remove(ONEDRIVE_REFRESH_TOKEN).commit();
        }

        @JavascriptInterface
        public void graphRequest(String requestId, String method, String relativePath, String body, String ifMatch) {
            if (requestId == null || requestId.length() > 128) return;
            new Thread(() -> {
                int status = 0;
                String responseBody = "";
                String errorMessage = null;
                try {
                    GraphResponse response = performGraphRequest(method, relativePath, body, ifMatch);
                    status = response.status;
                    responseBody = response.body;
                } catch (Exception error) {
                    errorMessage = error.getMessage() == null ? "OneDrive request failed." : error.getMessage();
                }
                notifyGraphResponse(requestId, status, responseBody, errorMessage);
            }, "Arcadien-OneDrive-Graph").start();
        }
    }

    private void runOneDriveDeviceSignIn() throws Exception {
        if (oneDriveSignInCancelled) throw new InterruptedException("Microsoft sign-in was cancelled.");
        Map<String, String> deviceRequest = new LinkedHashMap<>();
        deviceRequest.put("client_id", ONEDRIVE_CLIENT_ID);
        deviceRequest.put("scope", ONEDRIVE_SCOPE);
        JSONObject device = postMicrosoftForm(MICROSOFT_DEVICE_CODE_URL, deviceRequest);
        if (oneDriveSignInCancelled) throw new InterruptedException("Microsoft sign-in was cancelled.");
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
            if (oneDriveSignInCancelled) throw new InterruptedException("Microsoft sign-in was cancelled.");
            Thread.sleep(intervalSeconds * 1000L);
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
                acceptOneDriveToken(token, true);
                return;
            }
            String error = token.optString("error", "");
            if ("authorization_pending".equals(error)) continue;
            if ("slow_down".equals(error)) { intervalSeconds += 5; continue; }
            throw new IllegalStateException(token.optString("error_description", "Microsoft sign-in could not finish."));
        }
        throw new IllegalStateException("Microsoft sign-in timed out. Press Sync to try again.");
    }

    private boolean refreshOneDriveAccessToken() throws Exception {
        return refreshOneDriveAccessToken(false);
    }

    private boolean refreshOneDriveAccessToken(boolean signInFlow) throws Exception {
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
                if ("invalid_grant".equals(token.optString("error", ""))) {
                    securePreferences().edit().remove(ONEDRIVE_REFRESH_TOKEN).commit();
                    return false;
                }
                throw new IOException(lastOneDriveConnectionError);
            }
            acceptOneDriveToken(token, signInFlow);
            return true;
        } catch (Exception error) {
            lastOneDriveConnectionError = error.getMessage() == null ? "The saved OneDrive connection could not be restored." : error.getMessage();
            throw error;
        }
    }

    private void cancelOneDriveSignIn(boolean notifyIfIdle) {
        Thread thread;
        boolean wasInProgress;
        synchronized (this) {
            wasInProgress = oneDriveSignInInProgress;
            oneDriveSignInCancelled = true;
            thread = oneDriveSignInThread;
            if (wasInProgress) {
                oneDriveAccessToken = null;
                oneDriveAccessTokenExpiresAt = 0;
                securePreferences().edit().remove(ONEDRIVE_REFRESH_TOKEN).commit();
            }
        }
        if (thread != null) thread.interrupt();
        else if (notifyIfIdle) notifyOneDriveSignIn("Microsoft sign-in was cancelled.");
    }

    private synchronized String requireOneDriveAccessToken() throws Exception {
        if (oneDriveAccessToken != null && oneDriveAccessTokenExpiresAt > System.currentTimeMillis()) {
            return oneDriveAccessToken;
        }
        if (refreshOneDriveAccessToken() && oneDriveAccessToken != null) return oneDriveAccessToken;
        throw new IllegalStateException(lastOneDriveConnectionError.isEmpty()
            ? "OneDrive is not connected."
            : lastOneDriveConnectionError);
    }

    private GraphResponse performGraphRequest(String requestedMethod, String relativePath, String body, String ifMatch) throws Exception {
        String method = requestedMethod == null ? "GET" : requestedMethod.trim().toUpperCase();
        if (!("GET".equals(method) || "POST".equals(method) || "PUT".equals(method) || "DELETE".equals(method))) {
            throw new IllegalArgumentException("Unsupported OneDrive request method.");
        }
        if (!allowedGraphPath(relativePath)) throw new IllegalArgumentException("Blocked OneDrive request path.");
        if (body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_ONEDRIVE_RESPONSE_BYTES) {
            throw new IllegalArgumentException("OneDrive request is too large.");
        }
        if (ifMatch != null && (ifMatch.length() > 256 || ifMatch.indexOf('\r') >= 0 || ifMatch.indexOf('\n') >= 0)) {
            throw new IllegalArgumentException("Invalid OneDrive version condition.");
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(GRAPH_ROOT + relativePath).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + requireOneDriveAccessToken());
        connection.setRequestProperty("Accept", "application/json");
        if (ifMatch != null && !ifMatch.isEmpty()) connection.setRequestProperty("If-Match", ifMatch);
        if (body != null && !("GET".equals(method) || "DELETE".equals(method))) {
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setDoOutput(true);
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }

        int status = connection.getResponseCode();
        String responseBody = readResponseBody(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        connection.disconnect();
        if (status == 401) {
            oneDriveAccessToken = null;
            oneDriveAccessTokenExpiresAt = 0;
        }
        return new GraphResponse(status, responseBody);
    }

    private boolean allowedGraphPath(String path) {
        if (path == null || path.length() > 2048 || path.indexOf('\\') >= 0 || path.indexOf('\r') >= 0 || path.indexOf('\n') >= 0) return false;
        String rawPath = path.split("\\?", 2)[0];
        String decoded = Uri.decode(rawPath);
        if (decoded.contains("..") || decoded.contains("//")) return false;
        return path.matches("^/me/drive/special/approot(?:\\?.*)?$")
            || path.matches("^/me/drive/items/[^/?#:]+:/(?:rosters|games)(?:\\?.*)?$")
            || path.matches("^/me/drive/items/[^/?#]+(?:/children|/content|:/[^?#]+:/content)?(?:\\?.*)?$");
    }

    private String readResponseBody(InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_ONEDRIVE_RESPONSE_BYTES) {
                    throw new IOException("OneDrive returned more than the 10 MB safety limit.");
                }
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static final class GraphResponse {
        private final int status;
        private final String body;

        private GraphResponse(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private void acceptOneDriveToken(JSONObject token) throws Exception {
        acceptOneDriveToken(token, false);
    }

    private synchronized void acceptOneDriveToken(JSONObject token, boolean signInFlow) throws Exception {
        if (signInFlow && oneDriveSignInCancelled) throw new InterruptedException("Microsoft sign-in was cancelled.");
        String accessToken = token.getString("access_token");
        String refreshToken = token.optString("refresh_token", "");
        if (refreshToken.isEmpty()) refreshToken = readRefreshToken();
        if (refreshToken.isEmpty()) throw new IllegalStateException("Microsoft did not provide a refresh credential. Try Sync again.");
        writeRefreshToken(refreshToken);
        if (!refreshToken.equals(readRefreshToken())) throw new IllegalStateException("OneDrive connection could not be saved securely on this device.");
        oneDriveAccessToken = accessToken;
        oneDriveAccessTokenExpiresAt = System.currentTimeMillis() + Math.max(60, token.optInt("expires_in", 3600) - 60) * 1000L;
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
        String text = readResponseBody(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        connection.disconnect();
        return new JSONObject(text);
    }

    private void showOneDriveCode(String userCode, String verificationUri) {
        runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
            .setTitle("Connect OneDrive")
            .setMessage("Microsoft will ask for this one-time code:\n\n" + userCode + "\n\nYour password stays with Microsoft. After approving, return here and the manual sync will continue.")
            .setNegativeButton("Cancel", (dialog, which) -> cancelOneDriveSignIn(false))
            .setPositiveButton("Open Microsoft", (dialog, which) -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(verificationUri))); }
                catch (Exception error) { Toast.makeText(MainActivity.this, "Could not open Microsoft sign-in.", Toast.LENGTH_LONG).show(); }
            })
            .show());
    }

    private void notifyOneDriveSignIn(String error) {
        String script = "window.OneDriveRosterSync && window.OneDriveRosterSync.androidSignInCompleted("
            + (error == null ? "null" : JSONObject.quote(error)) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void notifyGraphResponse(String requestId, int status, String body, String error) {
        String script = "window.OneDriveRosterSync && window.OneDriveRosterSync.androidGraphResponseReceived("
            + JSONObject.quote(requestId) + ","
            + status + ","
            + JSONObject.quote(body == null ? "" : body) + ","
            + (error == null ? "null" : JSONObject.quote(error)) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
