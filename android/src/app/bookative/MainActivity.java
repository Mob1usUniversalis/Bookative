package app.bookative;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/**
 * Hosts the Bookative writing app (bundled HTML/JS in assets) and gives it native
 * services: storage in app storage or a folder the writer chooses, pictures,
 * clipboard and picker access, saving and sharing files, receiving backups from
 * other devices, printing to PDF and system bar colours.
 */
public class MainActivity extends Activity {

    private static final int REQ_SAVE = 4101;
    private static final int REQ_CHOOSER = 4102;
    private static final int REQ_TREE = 4103;
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int MAX_IMAGE_BYTES = 40 * 1024 * 1024;
    private static final int MAX_INCOMING_BYTES = 400 * 1024 * 1024;

    private WebView web;
    private WebView printView;
    private ValueCallback<Uri[]> filePathCallback;

    private byte[] pendingSaveBytes;
    private String pendingSaveCallback;
    private String pendingTreeCallback;
    private Uri incoming;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        boolean night = isNight(getResources().getConfiguration());
        int bg = night ? Color.parseColor("#15171D") : Color.parseColor("#F2F3EE");
        applySystemBars(bg, !night);

        web = new WebView(this);
        web.setBackgroundColor(bg);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // Pictures are served by ContentServer through content:// addresses.
        s.setAllowContentAccess(true);
        s.setAllowFileAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        // The page never touches the network itself; pasted web images are
        // downloaded by the native side on request (Bridge.fetchUrl).
        s.setBlockNetworkLoads(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            // API 24+ overload (not in the API 23 stubs we compile against, still overrides at runtime)
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternal(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternal(Uri.parse(url));
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                boolean image = false;
                String[] types = params.getAcceptTypes();
                if (types != null) {
                    for (String t : types) {
                        if (t != null && t.startsWith("image")) image = true;
                    }
                }
                boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(image ? "image/*" : "*/*");
                if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(intent,
                            image ? (multiple ? "Choose images" : "Choose an image") : "Choose a file"), REQ_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    toast("No app available to pick files");
                    return false;
                }
                return true;
            }
        });

        takeIntent(getIntent());
        web.loadUrl("file:///android_asset/index.html");
    }

    /** Remembers a backup file opened with or shared to Bookative from another app. */
    private boolean takeIntent(Intent intent) {
        if (intent == null) return false;
        Uri u = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            u = intent.getData();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (extra instanceof Uri) u = (Uri) extra;
        }
        if (u == null) return false;
        incoming = u;
        return true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeIntent(intent)) callJs("window.__incoming && window.__incoming()");
    }

    private static boolean isNight(Configuration c) {
        return (c.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // The WebView reports the app theme, not the system one, to prefers-color-scheme,
        // so the system dark mode is passed to the page explicitly.
        callJs("window.__systemDark && window.__systemDark(" + isNight(newConfig) + ")");
    }

    private boolean openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme != null && (scheme.equals("file") || scheme.equals("about")
                || scheme.equals("data") || scheme.equals("javascript"))) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
        return true;
    }

    private void applySystemBars(int color, boolean lightBars) {
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        w.getDecorView().setBackgroundColor(color);
        View decor = w.getDecorView();
        int flags = decor.getSystemUiVisibility();
        int lightStatus = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        int lightNav = 0x00000010; // SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR (API 26)
        if (lightBars) {
            flags |= lightStatus;
            if (Build.VERSION.SDK_INT >= 26) flags |= lightNav;
        } else {
            flags &= ~lightStatus;
            flags &= ~lightNav;
        }
        decor.setSystemUiVisibility(flags);
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void callJs(final String script) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    private static String jsString(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder(s.length() + 16);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case ' ': b.append("\\u2028"); break;
                case ' ': b.append("\\u2029"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        b.append('"');
        return b.toString();
    }

    private void done(String callbackId, boolean ok, String message) {
        if (callbackId == null) return;
        callJs("window.__nativeDone && window.__nativeDone(" + jsString(callbackId) + ","
                + (ok ? "true" : "false") + "," + jsString(message) + ")");
    }

    private void finishSave(boolean ok, String message) {
        String cb = pendingSaveCallback;
        pendingSaveBytes = null;
        pendingSaveCallback = null;
        done(cb, ok, message);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] picked = null;
                if (resultCode == RESULT_OK && data != null && data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    ArrayList<Uri> uris = new ArrayList<Uri>();
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri u = clip.getItemAt(i).getUri();
                        if (u != null) uris.add(u);
                    }
                    if (!uris.isEmpty()) picked = uris.toArray(new Uri[0]);
                }
                if (picked == null) picked = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                filePathCallback.onReceiveValue(picked);
                filePathCallback = null;
            }
            return;
        }
        if (requestCode == REQ_TREE) {
            String cb = pendingTreeCallback;
            pendingTreeCallback = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                done(cb, false, "cancelled");
                return;
            }
            final Uri tree = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(tree,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception e) {
                done(cb, false, "Bookative was not allowed to use this folder");
                return;
            }
            Storage.TreeStorage t = new Storage.TreeStorage(this, tree);
            done(cb, true, "{\"uri\":" + jsString(tree.toString()) + ",\"label\":" + jsString(t.label())
                    + ",\"projects\":" + t.projectCount() + "}");
            return;
        }
        if (requestCode == REQ_SAVE) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                finishSave(false, "cancelled");
                return;
            }
            Uri uri = data.getData();
            OutputStream out = null;
            try {
                out = getContentResolver().openOutputStream(uri, "wt");
                if (out == null) throw new Exception("Could not open the file for writing");
                out.write(pendingSaveBytes);
                out.flush();
                finishSave(true, "saved");
            } catch (Exception e) {
                finishSave(false, e.getMessage() == null ? "Could not write the file" : e.getMessage());
            } finally {
                try { if (out != null) out.close(); } catch (Exception ignored) { }
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.appBack ? window.appBack() : false)",
                new ValueCallback<String>() {
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) {
                            MainActivity.super.onBackPressed();
                        }
                    }
                });
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.appFlush && window.appFlush()", null);
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ helpers

    private Storage store() {
        return Storage.get(this);
    }

    /** Settings belong to this device, so they always stay in app storage. */
    private Storage storeFor(String name) {
        if ("settings.json".equals(name)) {
            Storage s = store();
            return s instanceof Storage.AppStorage ? s : new Storage.AppStorage(this);
        }
        return store();
    }

    private static byte[] readLimited(InputStream in, int max) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[32768];
        int n;
        int total = 0;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > max) throw new Exception("The file is too large");
            bo.write(buf, 0, n);
        }
        return bo.toByteArray();
    }

    private static String imageJson(String mime, byte[] data) {
        return "{\"mime\":" + jsString(mime == null ? "" : mime) + ",\"b64\":"
                + jsString(Base64.encodeToString(data, Base64.NO_WRAP)) + "}";
    }

    private String readUriJson(Uri uri, String type) {
        InputStream in = null;
        try {
            in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            byte[] data = readLimited(in, MAX_IMAGE_BYTES);
            if (type == null) type = getContentResolver().getType(uri);
            return imageJson(type, data);
        } catch (Exception e) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
        }
    }

    private static boolean validImage(String projectId, String name) {
        return Storage.safeName(projectId) && Storage.safeName(name);
    }

    /** Methods exposed to the web app as window.AndroidBridge. */
    public class Bridge {

        // ---------------------------------------------------------- project files

        @JavascriptInterface
        public String listFiles() {
            StringBuilder b = new StringBuilder("[");
            boolean first = true;
            for (Storage.Entry e : store().list("")) {
                if (!first) b.append(',');
                b.append(jsString(e.name));
                first = false;
            }
            return b.append(']').toString();
        }

        @JavascriptInterface
        public String readFile(String name) {
            if (!Storage.safeName(name)) return null;
            byte[] data = storeFor(name).read(name);
            return data == null ? null : new String(data, UTF8);
        }

        @JavascriptInterface
        public boolean writeFile(String name, String content) {
            if (!Storage.safeName(name) || content == null) return false;
            return storeFor(name).write(name, content.getBytes(UTF8));
        }

        @JavascriptInterface
        public boolean deleteFile(String name) {
            if (!Storage.safeName(name)) return false;
            return storeFor(name).delete(name);
        }

        // ---------------------------------------------------------- storage location

        /** {kind: "app"|"folder", label, ok} */
        @JavascriptInterface
        public String storageInfo() {
            Storage s = store();
            return "{\"kind\":" + jsString(s.kind()) + ",\"label\":" + jsString(s.label())
                    + ",\"ok\":" + s.available() + "}";
        }

        /** Opens the system folder picker; reports {uri, label, projects} via __nativeDone. */
        @JavascriptInterface
        public void chooseFolder(final String callbackId) {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (pendingTreeCallback != null) done(pendingTreeCallback, false, "superseded");
                    pendingTreeCallback = callbackId;
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                    try {
                        startActivityForResult(i, REQ_TREE);
                    } catch (ActivityNotFoundException e) {
                        pendingTreeCallback = null;
                        done(callbackId, false, "This device has no folder picker");
                    }
                }
            });
        }

        /**
         * Switches to a folder (uri) or back to app storage (empty uri). With copy, everything
         * in the current location is merged into the new one first (newer projects win).
         * Progress arrives via window.__storageProgress(done, total); the result via __nativeDone.
         */
        @JavascriptInterface
        public void switchStorage(final String uri, final boolean copy, final String callbackId) {
            new Thread(new Runnable() {
                public void run() {
                    try {
                        Storage from = store();
                        Storage to = (uri == null || uri.length() == 0)
                                ? new Storage.AppStorage(MainActivity.this)
                                : new Storage.TreeStorage(MainActivity.this, Uri.parse(uri));
                        if (!to.init()) throw new Exception("Bookative can't write to this folder");
                        int copied = 0;
                        if (copy && from.available()) {
                            copied = Storage.merge(from, to, new Storage.Progress() {
                                long last = 0;

                                public void step(int d, int total) {
                                    long now = System.currentTimeMillis();
                                    if (now - last > 150 || d == total) {
                                        last = now;
                                        callJs("window.__storageProgress && window.__storageProgress(" + d + "," + total + ")");
                                    }
                                }
                            });
                        }
                        Storage.use(MainActivity.this, to);
                        if (from instanceof Storage.TreeStorage
                                && !(to instanceof Storage.TreeStorage && ((Storage.TreeStorage) to).tree.equals(((Storage.TreeStorage) from).tree))) {
                            try {
                                getContentResolver().releasePersistableUriPermission(((Storage.TreeStorage) from).tree,
                                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            } catch (Exception ignored) {
                            }
                        }
                        done(callbackId, true, "{\"copied\":" + copied + ",\"label\":" + jsString(to.label()) + "}");
                    } catch (Exception e) {
                        done(callbackId, false, e.getMessage() == null ? "The storage could not be changed" : e.getMessage());
                    }
                }
            }).start();
        }

        // ---------------------------------------------------------- pictures
        // Each project keeps its pictures in img/<projectId>/<name> of the current storage.

        @JavascriptInterface
        public String imageBase() {
            return "content://" + getPackageName() + ".files/img/";
        }

        @JavascriptInterface
        public boolean writeImage(String projectId, String name, String base64) {
            if (!validImage(projectId, name) || base64 == null) return false;
            try {
                return store().write("img/" + projectId + "/" + name, Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String readImage(String projectId, String name) {
            if (!validImage(projectId, name)) return null;
            byte[] data = store().read("img/" + projectId + "/" + name);
            return data == null ? null : Base64.encodeToString(data, Base64.NO_WRAP);
        }

        @JavascriptInterface
        public boolean hasImage(String projectId, String name) {
            return validImage(projectId, name) && store().exists("img/" + projectId + "/" + name);
        }

        /** JSON array of {n: name, m: last-modified millis}. */
        @JavascriptInterface
        public String listImages(String projectId) {
            if (!Storage.safeName(projectId)) return "[]";
            StringBuilder b = new StringBuilder("[");
            boolean first = true;
            for (Storage.Entry e : store().list("img/" + projectId)) {
                if (!first) b.append(',');
                b.append("{\"n\":").append(jsString(e.name)).append(",\"m\":").append(e.modified).append('}');
                first = false;
            }
            return b.append(']').toString();
        }

        @JavascriptInterface
        public boolean deleteImage(String projectId, String name) {
            return validImage(projectId, name) && store().delete("img/" + projectId + "/" + name);
        }

        @JavascriptInterface
        public boolean deleteImages(String projectId) {
            return Storage.safeName(projectId) && store().deleteDir("img/" + projectId);
        }

        @JavascriptInterface
        public int copyImages(String fromProject, String toProject) {
            if (!Storage.safeName(fromProject) || !Storage.safeName(toProject)) return 0;
            Storage s = store();
            int n = 0;
            for (Storage.Entry e : s.list("img/" + fromProject)) {
                byte[] data = s.read("img/" + fromProject + "/" + e.name);
                if (data != null && s.write("img/" + toProject + "/" + e.name, data)) n++;
            }
            return n;
        }

        @JavascriptInterface
        public boolean hasClipboardImage() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipDescription d = cm == null ? null : cm.getPrimaryClipDescription();
                if (d == null) return false;
                for (int i = 0; i < d.getMimeTypeCount(); i++) {
                    String t = d.getMimeType(i);
                    if (t != null && t.startsWith("image/")) return true;
                }
            } catch (Exception ignored) {
            }
            return false;
        }

        /** The first image on the clipboard as {mime, b64}, or null. */
        @JavascriptInterface
        public String readClipboardImage() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = cm == null ? null : cm.getPrimaryClip();
                if (clip == null) return null;
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u == null) continue;
                    String type = getContentResolver().getType(u);
                    if (type != null && !type.startsWith("image/")) continue;
                    String r = readUriJson(u, type);
                    if (r != null) return r;
                }
            } catch (Exception ignored) {
            }
            return null;
        }

        /** Reads a content:// address (e.g. from pasted HTML) as {mime, b64}, or null. */
        @JavascriptInterface
        public String readUri(String uri) {
            if (uri == null) return null;
            Uri u = Uri.parse(uri);
            if (!"content".equals(u.getScheme())) return null;
            return readUriJson(u, null);
        }

        /**
         * Downloads an image from the web on a background thread. The result arrives via
         * window.__nativeDone(id, ok, json-or-error).
         */
        @JavascriptInterface
        public void fetchUrl(final String address, final String callbackId) {
            new Thread(new Runnable() {
                public void run() {
                    String result = null;
                    String error = "Could not download the image";
                    HttpURLConnection c = null;
                    try {
                        URL u = new URL(address);
                        int redirects = 0;
                        while (true) {
                            String proto = u.getProtocol();
                            if (!"https".equals(proto) && !"http".equals(proto)) throw new Exception("Unsupported address");
                            c = (HttpURLConnection) u.openConnection();
                            c.setConnectTimeout(15000);
                            c.setReadTimeout(30000);
                            c.setInstanceFollowRedirects(false);
                            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Bookative");
                            c.setRequestProperty("Accept", "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5");
                            int code = c.getResponseCode();
                            if (code >= 300 && code < 400) {
                                String loc = c.getHeaderField("Location");
                                c.disconnect();
                                c = null;
                                if (loc == null || ++redirects > 5) throw new Exception("Too many redirects");
                                u = new URL(u, loc);
                                continue;
                            }
                            if (code != 200) throw new Exception("The server answered " + code);
                            break;
                        }
                        if (c.getContentLength() > MAX_IMAGE_BYTES) throw new Exception("The image is too large");
                        InputStream in = c.getInputStream();
                        byte[] data = readLimited(in, MAX_IMAGE_BYTES);
                        in.close();
                        result = imageJson(c.getContentType(), data);
                    } catch (Exception e) {
                        if (e.getMessage() != null) error = e.getMessage();
                    } finally {
                        if (c != null) c.disconnect();
                    }
                    done(callbackId, result != null, result != null ? result : error);
                }
            }).start();
        }

        /**
         * Decodes an image the WebView cannot read (e.g. HEIC from newer cameras), applies
         * its EXIF rotation, scales it to maxDim and returns {mime, b64} as JPEG (PNG if it
         * has transparency), or null.
         */
        @JavascriptInterface
        public String convertImage(String base64, int maxDim) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
                int sample = 1;
                while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDim) sample *= 2;
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = sample;
                Bitmap bmp = BitmapFactory.decodeByteArray(data, 0, data.length, opts);
                if (bmp == null) return null;

                // ExifInterface(InputStream) is API 24 but missing from the API 23 stubs this
                // is compiled against, so the bytes go through a temporary file instead.
                int orientation = ExifInterface.ORIENTATION_NORMAL;
                File tmp = null;
                try {
                    tmp = File.createTempFile("exif", ".img", getCacheDir());
                    FileOutputStream fo = new FileOutputStream(tmp);
                    fo.write(data);
                    fo.close();
                    orientation = new ExifInterface(tmp.getAbsolutePath())
                            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                } catch (Exception ignored) {
                } finally {
                    if (tmp != null) tmp.delete();
                }
                float scale = Math.min(1f, (float) maxDim / Math.max(bmp.getWidth(), bmp.getHeight()));
                Matrix m = new Matrix();
                m.postScale(scale, scale);
                switch (orientation) {
                    case ExifInterface.ORIENTATION_ROTATE_90: m.postRotate(90); break;
                    case ExifInterface.ORIENTATION_ROTATE_180: m.postRotate(180); break;
                    case ExifInterface.ORIENTATION_ROTATE_270: m.postRotate(270); break;
                    case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: m.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_FLIP_VERTICAL: m.postScale(1, -1); break;
                    case ExifInterface.ORIENTATION_TRANSPOSE: m.postRotate(90); m.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_TRANSVERSE: m.postRotate(270); m.postScale(-1, 1); break;
                    default: break;
                }
                Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
                boolean alpha = out.hasAlpha();
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                out.compress(alpha ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 86, bo);
                return imageJson(alpha ? "image/png" : "image/jpeg", bo.toByteArray());
            } catch (Throwable e) {
                return null;
            }
        }

        // ---------------------------------------------------------- files in and out

        /** Opens the system "save as" picker; the result arrives via window.__nativeDone(id, ok, msg). */
        @JavascriptInterface
        public void saveDocument(final String fileName, final String mime,
                                 final String base64, final String callbackId) {
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception e) {
                done(callbackId, false, "Invalid data");
                return;
            }
            runOnUiThread(new Runnable() {
                public void run() {
                    if (pendingSaveCallback != null) finishSave(false, "superseded");
                    pendingSaveBytes = bytes;
                    pendingSaveCallback = callbackId;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime == null || mime.length() == 0 ? "application/octet-stream" : mime);
                    i.putExtra(Intent.EXTRA_TITLE, fileName);
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (ActivityNotFoundException e) {
                        finishSave(false, "No app available to save files");
                    }
                }
            });
        }

        /** Sends a file through the share sheet (Quick Share, Bluetooth, messengers, e-mail…). */
        @JavascriptInterface
        public boolean shareFile(String fileName, final String mime, String base64, final String subject) {
            if (fileName == null || fileName.length() == 0 || fileName.contains("/") || fileName.contains("\\")
                    || fileName.startsWith(".") || fileName.length() > 150) return false;
            try {
                File dir = ContentServer.shareDir(getCacheDir());
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File f = new File(dir, fileName);
                FileOutputStream out = new FileOutputStream(f);
                out.write(Base64.decode(base64, Base64.DEFAULT));
                out.close();
                final Uri uri = new Uri.Builder().scheme("content").authority(getPackageName() + ".files")
                        .appendPath("share").appendPath(fileName).build();
                runOnUiThread(new Runnable() {
                    public void run() {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType(mime == null || mime.length() == 0 ? "application/octet-stream" : mime);
                        i.putExtra(Intent.EXTRA_STREAM, uri);
                        if (subject != null) i.putExtra(Intent.EXTRA_SUBJECT, subject);
                        i.setClipData(ClipData.newRawUri("", uri));
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try {
                            startActivity(Intent.createChooser(i, "Send to"));
                        } catch (ActivityNotFoundException e) {
                            toast("No app available to share");
                        }
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** Text of a backup opened with or shared to Bookative, or null. Consumed on read. */
        @JavascriptInterface
        public String takeIncoming() {
            Uri u = incoming;
            incoming = null;
            if (u == null) return null;
            InputStream in = null;
            try {
                in = getContentResolver().openInputStream(u);
                if (in == null) return null;
                return new String(readLimited(in, MAX_INCOMING_BYTES), UTF8);
            } catch (Exception e) {
                toast("The file could not be opened");
                return null;
            } finally {
                try { if (in != null) in.close(); } catch (Exception ignored) { }
            }
        }

        /**
         * Renders HTML off-screen and opens the system print dialog (which offers "Save as PDF").
         * widthMils/heightMils set a custom paper size (thousandths of an inch); 0 means A4.
         */
        @JavascriptInterface
        public void printHtml(final String title, final String html, final int widthMils, final int heightMils) {
            runOnUiThread(new Runnable() {
                public void run() {
                    final WebView pv = new WebView(MainActivity.this);
                    printView = pv;
                    pv.getSettings().setJavaScriptEnabled(false);
                    pv.getSettings().setAllowContentAccess(true);
                    pv.getSettings().setAllowFileAccess(false);
                    pv.getSettings().setBlockNetworkLoads(true);
                    pv.setWebViewClient(new WebViewClient() {
                        private boolean started = false;

                        @Override
                        public void onPageFinished(WebView view, String url) {
                            if (started) return;
                            started = true;
                            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            String jobName = (title == null || title.length() == 0) ? "Bookative" : title;
                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                            PrintAttributes.MediaSize size = widthMils > 0 && heightMils > 0
                                    ? new PrintAttributes.MediaSize("bookative_page", "Book page", widthMils, heightMils)
                                    : PrintAttributes.MediaSize.ISO_A4;
                            PrintAttributes attrs = new PrintAttributes.Builder()
                                    .setMediaSize(size)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build();
                            pm.print(jobName, adapter, attrs);
                        }
                    });
                    pv.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "UTF-8", null);
                }
            });
        }

        @JavascriptInterface
        public void shareText(final String subject, final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, subject);
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    try {
                        startActivity(Intent.createChooser(i, "Share"));
                    } catch (ActivityNotFoundException e) {
                        toast("No app available to share");
                    }
                }
            });
        }

        // ---------------------------------------------------------- system

        @JavascriptInterface
        public void setChrome(final String colorHex, final boolean lightBars) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        int c = Color.parseColor(colorHex);
                        applySystemBars(c, lightBars);
                        if (web != null) web.setBackgroundColor(c);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void keepScreenOn(final boolean on) {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        @JavascriptInterface
        public boolean isSystemDark() {
            return isNight(getResources().getConfiguration());
        }

        @JavascriptInterface
        public void toast(String msg) {
            MainActivity.this.toast(msg);
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
