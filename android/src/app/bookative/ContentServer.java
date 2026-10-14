package app.bookative;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/**
 * Serves files to the app's own WebView and, through temporary grants, to apps
 * the writer shares with. Not exported.
 *   content://<app id>.files/img/<projectId>/<name>   pictures, from the current storage
 *   content://<app id>.files/share/<name>             a file prepared for the share sheet
 */
public class ContentServer extends ContentProvider {

    @Override
    public boolean onCreate() {
        return true;
    }

    static String mimeOf(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".pdf")) return "application/pdf";
        if (n.endsWith(".zip")) return "application/zip";
        if (n.endsWith(".cbz")) return "application/vnd.comicbook+zip";
        if (n.endsWith(".epub")) return "application/epub+zip";
        if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".md")) return "text/markdown";
        if (n.endsWith(".html")) return "text/html";
        return "application/octet-stream";
    }

    static File shareDir(File cache) {
        File d = new File(cache, "share");
        if (!d.isDirectory()) d.mkdirs();
        return d;
    }

    private File shared(String name) throws FileNotFoundException {
        if (name == null || name.contains("/") || name.contains("\\") || name.startsWith(".")) {
            throw new FileNotFoundException();
        }
        File f = new File(shareDir(getContext().getCacheDir()), name);
        if (!f.isFile()) throw new FileNotFoundException(name);
        return f;
    }

    @Override
    public String getType(Uri uri) {
        String last = uri.getLastPathSegment();
        return last == null ? null : mimeOf(last);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode == null || !mode.startsWith("r")) throw new FileNotFoundException("read only");
        List<String> seg = uri.getPathSegments();
        if (seg.size() == 3 && "img".equals(seg.get(0))) {
            String pid = seg.get(1);
            String name = seg.get(2);
            if (!Storage.safeName(pid) || !Storage.safeName(name)) throw new FileNotFoundException();
            return Storage.get(getContext()).openFd("img/" + pid + "/" + name);
        }
        if (seg.size() == 2 && "share".equals(seg.get(0))) {
            return ParcelFileDescriptor.open(shared(seg.get(1)), ParcelFileDescriptor.MODE_READ_ONLY);
        }
        throw new FileNotFoundException(uri.toString());
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        List<String> seg = uri.getPathSegments();
        if (seg.size() != 2 || !"share".equals(seg.get(0))) return null;
        File f;
        try {
            f = shared(seg.get(1));
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
