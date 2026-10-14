package app.bookative;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Where projects, snapshots and pictures live. Two backends:
 *  - AppStorage: the app's private files (the default);
 *  - TreeStorage: a "Bookative" folder inside a folder the writer picked with the
 *    system folder picker (Storage Access Framework), e.g. Documents, an SD card or
 *    a folder kept in sync with other devices.
 * Paths are relative: "p-<id>.json", "s-<id>-<day>.json", "img/<projectId>/<name>".
 */
abstract class Storage {

    static final String PREFS = "storage";
    static final String KEY_TREE = "tree";

    private static Storage current;

    static synchronized Storage get(Context c) {
        if (current == null) {
            Context app = c.getApplicationContext();
            String tree = app.getSharedPreferences(PREFS, 0).getString(KEY_TREE, null);
            current = tree != null ? new TreeStorage(app, Uri.parse(tree)) : new AppStorage(app);
        }
        return current;
    }

    static synchronized void use(Context c, Storage s) {
        SharedPreferences.Editor e = c.getApplicationContext().getSharedPreferences(PREFS, 0).edit();
        if (s instanceof TreeStorage) e.putString(KEY_TREE, ((TreeStorage) s).tree.toString());
        else e.remove(KEY_TREE);
        e.commit();
        current = s;
    }

    static class Entry {
        final String name;
        final long modified;

        Entry(String name, long modified) {
            this.name = name;
            this.modified = modified;
        }
    }

    abstract String kind();

    abstract String label();

    /** True when the location can be read and written right now. */
    abstract boolean available();

    /** Prepares the location (creates folders); returns false if it cannot be used. */
    abstract boolean init();

    abstract List<Entry> list(String dir);

    abstract List<String> listDirs(String dir);

    abstract byte[] read(String path);

    abstract boolean write(String path, byte[] data);

    abstract boolean exists(String path);

    abstract boolean delete(String path);

    abstract boolean deleteDir(String dir);

    abstract ParcelFileDescriptor openFd(String path) throws FileNotFoundException;

    // ------------------------------------------------------------------ helpers

    static boolean safeName(String name) {
        return name != null && name.matches("[A-Za-z0-9._-]{1,120}") && !name.startsWith(".");
    }

    static boolean hidden(String name) {
        return name.endsWith(".tmp") || name.endsWith(".new") || name.startsWith(".");
    }

    static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[32768];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    static String parent(String path) {
        int i = path.lastIndexOf('/');
        return i < 0 ? "" : path.substring(0, i);
    }

    static String baseName(String path) {
        int i = path.lastIndexOf('/');
        return i < 0 ? path : path.substring(i + 1);
    }

    private static final Pattern UPDATED = Pattern.compile("\"updatedAt\"\\s*:\\s*\"([^\"]+)\"");

    static String updatedAt(byte[] json) {
        if (json == null) return "";
        int n = Math.min(json.length, 4096);
        Matcher m = UPDATED.matcher(new String(json, 0, n, java.nio.charset.Charset.forName("UTF-8")));
        return m.find() ? m.group(1) : "";
    }

    interface Progress {
        void step(int done, int total);
    }

    /**
     * Copies everything from one location to another without losing anything:
     * files missing at the destination are copied; when a project exists in both
     * places, the copy edited most recently wins. Returns the number of files copied.
     */
    static int merge(Storage from, Storage to, Progress p) {
        List<String> paths = new ArrayList<String>();
        for (Entry e : from.list("")) {
            if (e.name.equals("index.json") || e.name.equals("settings.json")) continue;
            paths.add(e.name);
        }
        for (String d : from.listDirs("img")) {
            for (Entry e : from.list("img/" + d)) paths.add("img/" + d + "/" + e.name);
        }
        int done = 0;
        int copied = 0;
        for (String path : paths) {
            boolean copy;
            if (!to.exists(path)) {
                copy = true;
            } else if (path.startsWith("p-") && path.endsWith(".json")) {
                byte[] a = from.read(path);
                byte[] b = to.read(path);
                copy = a != null && updatedAt(a).compareTo(updatedAt(b)) > 0;
            } else {
                copy = false;
            }
            if (copy) {
                byte[] data = from.read(path);
                if (data != null && to.write(path, data)) copied++;
            }
            done++;
            if (p != null) p.step(done, paths.size());
        }
        return copied;
    }

    // ================================================================== app storage

    static class AppStorage extends Storage {
        final File base;

        AppStorage(Context c) {
            base = new File(c.getFilesDir(), "bookative");
        }

        String kind() { return "app"; }

        String label() { return "App storage on this device"; }

        boolean available() { return true; }

        boolean init() {
            return base.isDirectory() || base.mkdirs();
        }

        private File file(String path) {
            return new File(base, path);
        }

        List<Entry> list(String dir) {
            List<Entry> out = new ArrayList<Entry>();
            File[] files = file(dir).listFiles();
            if (files != null) {
                for (File f : files) {
                    if (f.isFile() && !hidden(f.getName())) out.add(new Entry(f.getName(), f.lastModified()));
                }
            }
            return out;
        }

        List<String> listDirs(String dir) {
            List<String> out = new ArrayList<String>();
            File[] files = file(dir).listFiles();
            if (files != null) for (File f : files) if (f.isDirectory()) out.add(f.getName());
            return out;
        }

        byte[] read(String path) {
            File f = file(path);
            if (!f.isFile()) return null;
            FileInputStream in = null;
            try {
                in = new FileInputStream(f);
                return readAll(in);
            } catch (Exception e) {
                return null;
            } finally {
                try { if (in != null) in.close(); } catch (Exception ignored) { }
            }
        }

        boolean write(String path, byte[] data) {
            File dst = file(path);
            File dir = dst.getParentFile();
            if (dir != null && !dir.isDirectory()) dir.mkdirs();
            File tmp = new File(dir, dst.getName() + ".tmp");
            FileOutputStream out = null;
            try {
                out = new FileOutputStream(tmp);
                out.write(data);
                out.flush();
                out.getFD().sync();
                out.close();
                out = null;
                if (!tmp.renameTo(dst)) {
                    dst.delete();
                    return tmp.renameTo(dst);
                }
                return true;
            } catch (Exception e) {
                return false;
            } finally {
                try { if (out != null) out.close(); } catch (Exception ignored) { }
            }
        }

        boolean exists(String path) { return file(path).isFile(); }

        boolean delete(String path) {
            File f = file(path);
            return !f.exists() || f.delete();
        }

        boolean deleteDir(String dir) {
            File d = file(dir);
            File[] files = d.listFiles();
            if (files != null) for (File f : files) f.delete();
            return !d.exists() || d.delete();
        }

        ParcelFileDescriptor openFd(String path) throws FileNotFoundException {
            return ParcelFileDescriptor.open(file(path), ParcelFileDescriptor.MODE_READ_ONLY);
        }
    }

    // ================================================================== folder storage

    static class TreeStorage extends Storage {
        static final String FOLDER = "Bookative";
        static final String BIN = "application/octet-stream";

        final Context ctx;
        final ContentResolver cr;
        final Uri tree;
        private String rootId;
        private final Map<String, String> dirIds = new HashMap<String, String>();
        private final Map<String, Map<String, Child>> children = new HashMap<String, Map<String, Child>>();

        static class Child {
            final String id;
            final boolean dir;
            final long modified;
            final long size;

            Child(String id, boolean dir, long modified, long size) {
                this.id = id;
                this.dir = dir;
                this.modified = modified;
                this.size = size;
            }
        }

        TreeStorage(Context c, Uri tree) {
            this.ctx = c.getApplicationContext();
            this.cr = ctx.getContentResolver();
            this.tree = tree;
        }

        String kind() { return "folder"; }

        private Uri doc(String id) {
            return DocumentsContract.buildDocumentUriUsingTree(tree, id);
        }

        private boolean permitted() {
            for (UriPermission p : cr.getPersistedUriPermissions()) {
                if (p.getUri().equals(tree) && p.isReadPermission() && p.isWritePermission()) return true;
            }
            return false;
        }

        String label() {
            String id = DocumentsContract.getTreeDocumentId(tree);
            String path;
            int colon = id.indexOf(':');
            if (colon >= 0 && "com.android.externalstorage.documents".equals(tree.getAuthority())) {
                String volume = id.substring(0, colon);
                String rel = id.substring(colon + 1);
                String vol = "primary".equals(volume) ? "Phone storage" : "SD card";
                path = rel.length() == 0 ? vol : vol + " › " + rel.replace("/", " › ");
            } else {
                String name = displayName(id);
                path = name != null ? name : "Selected folder";
            }
            String last = baseName(id.replace(':', '/'));
            return FOLDER.equalsIgnoreCase(last) ? path : path + " › " + FOLDER;
        }

        private String displayName(String id) {
            Cursor c = null;
            try {
                c = cr.query(doc(id), new String[]{Document.COLUMN_DISPLAY_NAME}, null, null, null);
                if (c != null && c.moveToFirst()) return c.getString(0);
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
            return null;
        }

        private synchronized Map<String, Child> load(String dirId) {
            Map<String, Child> map = new HashMap<String, Child>();
            Cursor c = null;
            try {
                Uri q = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
                c = cr.query(q, new String[]{Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME,
                        Document.COLUMN_MIME_TYPE, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_SIZE}, null, null, null);
                if (c != null) {
                    while (c.moveToNext()) {
                        String name = c.getString(1);
                        if (name == null) continue;
                        boolean dir = Document.MIME_TYPE_DIR.equals(c.getString(2));
                        long mod = c.isNull(3) ? 0 : c.getLong(3);
                        long size = c.isNull(4) ? -1 : c.getLong(4);
                        map.put(name, new Child(c.getString(0), dir, mod, size));
                    }
                }
            } catch (Exception e) {
                map = null;
            } finally {
                if (c != null) c.close();
            }
            if (map != null) children.put(dirId, map);
            return map;
        }

        private synchronized Map<String, Child> kids(String dirId) {
            Map<String, Child> m = children.get(dirId);
            return m != null ? m : load(dirId);
        }

        private synchronized String root(boolean create) {
            if (rootId != null) return rootId;
            String top = DocumentsContract.getTreeDocumentId(tree);
            String name = displayName(top);
            if (name != null && FOLDER.equalsIgnoreCase(name)) {
                rootId = top;
                return rootId;
            }
            Map<String, Child> m = kids(top);
            if (m == null) return null;
            Child c = m.get(FOLDER);
            if (c != null && c.dir) {
                rootId = c.id;
                return rootId;
            }
            if (!create) return null;
            try {
                Uri u = DocumentsContract.createDocument(cr, doc(top), Document.MIME_TYPE_DIR, FOLDER);
                if (u == null) return null;
                rootId = DocumentsContract.getDocumentId(u);
                children.remove(top);
                // keep gallery apps from indexing the pictures
                Uri nm = DocumentsContract.createDocument(cr, doc(rootId), BIN, ".nomedia");
                if (nm != null) children.remove(rootId);
                return rootId;
            } catch (Exception e) {
                return null;
            }
        }

        /** Document id of a directory path ("" = the Bookative folder). */
        private synchronized String dirId(String dir, boolean create) {
            String r = root(create);
            if (r == null) return null;
            if (dir.length() == 0) return r;
            String cached = dirIds.get(dir);
            if (cached != null) return cached;
            String parentId = dirId(parent(dir), create);
            if (parentId == null) return null;
            String name = baseName(dir);
            Map<String, Child> m = kids(parentId);
            Child c = m == null ? null : m.get(name);
            if (c != null && c.dir) {
                dirIds.put(dir, c.id);
                return c.id;
            }
            if (!create) return null;
            try {
                Uri u = DocumentsContract.createDocument(cr, doc(parentId), Document.MIME_TYPE_DIR, name);
                if (u == null) return null;
                String id = DocumentsContract.getDocumentId(u);
                children.remove(parentId);
                dirIds.put(dir, id);
                return id;
            } catch (Exception e) {
                return null;
            }
        }

        private Child child(String path) {
            String did = dirId(parent(path), false);
            if (did == null) return null;
            Map<String, Child> m = kids(did);
            return m == null ? null : m.get(baseName(path));
        }

        boolean available() {
            if (!permitted()) return false;
            return root(false) != null || load(DocumentsContract.getTreeDocumentId(tree)) != null;
        }

        boolean init() {
            return permitted() && root(true) != null;
        }

        List<Entry> list(String dir) {
            List<Entry> out = new ArrayList<Entry>();
            String did = dirId(dir, false);
            if (did == null) return out;
            Map<String, Child> m = load(did); // always fresh: another device may have synced changes
            if (m == null) return out;
            for (Map.Entry<String, Child> e : m.entrySet()) {
                String n = e.getKey();
                if (e.getValue().dir) continue;
                if (n.endsWith(".new")) {
                    String main = n.substring(0, n.length() - 4);
                    if (!m.containsKey(main)) out.add(new Entry(main, e.getValue().modified));
                    continue;
                }
                if (!hidden(n)) out.add(new Entry(n, e.getValue().modified));
            }
            return out;
        }

        List<String> listDirs(String dir) {
            List<String> out = new ArrayList<String>();
            String did = dirId(dir, false);
            if (did == null) return out;
            Map<String, Child> m = load(did);
            if (m == null) return out;
            for (Map.Entry<String, Child> e : m.entrySet()) if (e.getValue().dir) out.add(e.getKey());
            return out;
        }

        private byte[] readDoc(String id) {
            InputStream in = null;
            try {
                in = cr.openInputStream(doc(id));
                return in == null ? null : readAll(in);
            } catch (Exception e) {
                return null;
            } finally {
                try { if (in != null) in.close(); } catch (Exception ignored) { }
            }
        }

        synchronized byte[] read(String path) {
            // A ".new" copy means the last save was interrupted; it is complete, so prefer it.
            Child pending = child(path + ".new");
            if (pending != null) {
                byte[] data = readDoc(pending.id);
                if (data != null) {
                    if (writeDirect(path, data)) deleteDoc(parent(path), pending.id);
                    return data;
                }
            }
            Child c = child(path);
            if (c == null) return null;
            byte[] data = readDoc(c.id);
            if (data == null) {
                // stale cache (file changed elsewhere): reload once
                String did = dirId(parent(path), false);
                if (did != null) load(did);
                c = child(path);
                if (c != null) data = readDoc(c.id);
            }
            return data;
        }

        private boolean writeBytes(Uri u, byte[] data) {
            OutputStream out = null;
            try {
                try {
                    out = cr.openOutputStream(u, "wt");
                } catch (Exception notSupported) {
                    out = cr.openOutputStream(u, "w");
                }
                if (out == null) return false;
                out.write(data);
                out.flush();
                return true;
            } catch (Exception e) {
                return false;
            } finally {
                try { if (out != null) out.close(); } catch (Exception ignored) { }
            }
        }

        private long sizeOf(Uri u) {
            Cursor c = null;
            try {
                c = cr.query(u, new String[]{Document.COLUMN_SIZE}, null, null, null);
                if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
            return -1;
        }

        private void deleteDoc(String dir, String id) {
            try {
                DocumentsContract.deleteDocument(cr, doc(id));
            } catch (Exception ignored) {
            }
            String did = dirId(dir, false);
            if (did != null) children.remove(did);
        }

        private synchronized boolean writeDirect(String path, byte[] data) {
            String did = dirId(parent(path), true);
            if (did == null) return false;
            String name = baseName(path);
            Map<String, Child> m = kids(did);
            Child c = m == null ? null : m.get(name);
            try {
                Uri u;
                if (c == null) {
                    u = DocumentsContract.createDocument(cr, doc(did), BIN, name);
                    if (u == null) return false;
                    children.remove(did);
                } else {
                    u = doc(c.id);
                }
                if (!writeBytes(u, data)) return false;
                long size = sizeOf(u);
                if (size >= 0 && size != data.length) {
                    // provider did not truncate: replace the document
                    DocumentsContract.deleteDocument(cr, u);
                    u = DocumentsContract.createDocument(cr, doc(did), BIN, name);
                    children.remove(did);
                    if (u == null || !writeBytes(u, data)) return false;
                }
                return true;
            } catch (Exception e) {
                children.remove(did);
                return false;
            }
        }

        synchronized boolean write(String path, byte[] data) {
            boolean important = !path.startsWith("img/") && exists(path);
            if (important) {
                // Write a complete copy first, so an interrupted save never leaves a broken project.
                if (!writeDirect(path + ".new", data)) return false;
                boolean ok = writeDirect(path, data);
                Child n = child(path + ".new");
                if (ok && n != null) deleteDoc(parent(path), n.id);
                return ok;
            }
            return writeDirect(path, data);
        }

        boolean exists(String path) {
            Child c = child(path);
            return c != null && !c.dir;
        }

        synchronized boolean delete(String path) {
            Child c = child(path);
            if (c == null) return true;
            try {
                boolean ok = DocumentsContract.deleteDocument(cr, doc(c.id));
                String did = dirId(parent(path), false);
                if (did != null) children.remove(did);
                return ok;
            } catch (Exception e) {
                return false;
            }
        }

        synchronized boolean deleteDir(String dir) {
            String did = dirId(dir, false);
            if (did == null) return true;
            try {
                boolean ok = DocumentsContract.deleteDocument(cr, doc(did));
                dirIds.remove(dir);
                children.remove(did);
                String pid = dirId(parent(dir), false);
                if (pid != null) children.remove(pid);
                return ok;
            } catch (Exception e) {
                return false;
            }
        }

        ParcelFileDescriptor openFd(String path) throws FileNotFoundException {
            Child c = child(path);
            if (c == null) throw new FileNotFoundException(path);
            return cr.openFileDescriptor(doc(c.id), "r");
        }

        /** Number of projects already in the folder (e.g. synced from another device). */
        int projectCount() {
            int n = 0;
            for (Entry e : list("")) if (e.name.startsWith("p-") && e.name.endsWith(".json")) n++;
            return n;
        }
    }
}
