#!/usr/bin/env bash
# Builds Bookative without Gradle, using the Android SDK tools packaged by
# Debian/Ubuntu:  sudo apt install aapt android-sdk-platform-23 dalvik-exchange zipalign apksigner
# plus a JDK (17+) and Node.js (for bundling the web app).
#
#   APP_ID         application id (default app.bookative) — set your own before publishing
#   VERSION_CODE   integer, raise it for every release
#   VERSION_NAME   e.g. 1.2.0
#   KEYSTORE, KEYSTORE_PASS, KEY_ALIAS   signing key (kept outside the repository)
set -euo pipefail
cd "$(dirname "$0")"

APP_ID=${APP_ID:-app.bookative}
VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.2.0}
SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
AJAR="$SDK/platforms/android-23/android.jar"
DX="$SDK/build-tools/debian/dx"
[ -x "$DX" ] || DX=$(command -v dx)
KS=${KEYSTORE:-$HOME/.android-keys/bookative-release.jks}
KEY_ALIAS=${KEY_ALIAS:-bookative}
if [ -z "${KEYSTORE_PASS:-}" ]; then
  echo "Set KEYSTORE_PASS (and optionally KEYSTORE, KEY_ALIAS). The key must stay outside the repository." >&2
  exit 1
fi
KS_PASS=$KEYSTORE_PASS

B=build
rm -rf "$B"
mkdir -p "$B/classes" "$B/gen"

echo "• Bundling the web app"
if [ -d web/node_modules ]; then
  (cd web && node build.mjs)
else
  (cd web && npm install --no-audit --no-fund && node build.mjs)
fi

echo "• Compiling resources"
sed "s/\${APP_ID}/$APP_ID/g" android/AndroidManifest.xml > "$B/AndroidManifest.xml"
aapt2 compile --dir android/res -o "$B/res.zip"
aapt2 link -o "$B/base.apk" -I "$AJAR" \
  --manifest "$B/AndroidManifest.xml" \
  --rename-manifest-package "$APP_ID" \
  -A android/assets \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java "$B/gen" "$B/res.zip"

echo "• Compiling Java"
javac -nowarn -Xlint:-options -source 8 -target 8 \
  -bootclasspath "$AJAR" -classpath "$AJAR" \
  -d "$B/classes" $(find android/src "$B/gen" -name '*.java')

echo "• Dexing"
"$DX" --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"

echo "• Packaging"
python3 - "$B/base.apk" "$B/classes.dex" "$B/unaligned.apk" <<'PY'
import sys, zipfile
src, dex, dst = sys.argv[1:4]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for item in zin.infolist():
        zout.writestr(item, zin.read(item.filename), compress_type=item.compress_type)
    zout.write(dex, "classes.dex", compress_type=zipfile.ZIP_DEFLATED)
PY
zipalign -p -f 4 "$B/unaligned.apk" "$B/aligned.apk"

if [ ! -f "$KS" ]; then
  echo "• Creating signing key $KS"
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 3072 -validity 10000 \
    -dname "CN=Bookative" 2>/dev/null
fi

echo "• Signing"
mkdir -p dist
apksigner sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KEY_ALIAS" \
  --min-sdk-version 24 --out "dist/Bookative-$VERSION_NAME.apk" "$B/aligned.apk"
apksigner verify --min-sdk-version 24 "dist/Bookative-$VERSION_NAME.apk"
rm -f "dist/Bookative-$VERSION_NAME.apk.idsig"
ls -lh "dist/Bookative-$VERSION_NAME.apk"
