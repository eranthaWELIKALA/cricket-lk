#!/bin/sh
# Creates the release key ("upload key") and android/keystore.properties. Run it once:
#
#   sh scripts/make-keystore.sh                 # key in ~/.android-keys/cricket-lk-upload.jks
#   sh scripts/make-keystore.sh /path/to/key.jks
#
# Back up the .jks file AND its password (a password manager, plus a copy off
# this computer). Google Play can reset a lost upload key; Samsung Galaxy Store
# can't: every update there must be signed with this same key, forever.
set -e
cd "$(dirname "$0")/.."
KEYSTORE="${1:-$HOME/.android-keys/cricket-lk-upload.jks}"
ALIAS=cricketlk
PROPS=android/keystore.properties

if [ -e "$KEYSTORE" ]; then echo "$KEYSTORE already exists; not touching it." >&2; exit 1; fi
if [ -e "$PROPS" ]; then echo "$PROPS already exists; remove it first if you really want a new key." >&2; exit 1; fi
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (21 is what the Android build uses)." >&2; exit 1; }

printf "Password for the new key (at least 6 characters): "
stty -echo; read -r PASS; stty echo; echo
printf "Same password again: "
stty -echo; read -r PASS2; stty echo; echo
[ "$PASS" = "$PASS2" ] || { echo "The passwords don't match." >&2; exit 1; }
[ ${#PASS} -ge 6 ] || { echo "Use at least 6 characters." >&2; exit 1; }
printf "Name on the certificate (e.g. Erantha Welikala): "
read -r CN
case "$CN" in *[,=+\<\>\#\;\"\\]*|"") echo "Use just letters, digits and spaces." >&2; exit 1;; esac

mkdir -p "$(dirname "$KEYSTORE")"
export CRICKET_LK_KEY_PASS="$PASS"
keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=$CN" \
  -storepass:env CRICKET_LK_KEY_PASS -keypass:env CRICKET_LK_KEY_PASS
chmod 600 "$KEYSTORE"

# Java properties: a backslash in the password has to be doubled.
ESCAPED=$(printf '%s' "$PASS" | sed 's/\\/\\\\/g')
umask 077
cat > "$PROPS" <<EOF
# Release signing for the guest APK/AAB. Never commit this file (it's in mobile/.gitignore).
storeFile=$KEYSTORE
storePassword=$ESCAPED
keyAlias=$ALIAS
keyPassword=$ESCAPED
EOF
echo
echo "Created $KEYSTORE and $PROPS."
echo "Back up the key file and its password now. Then: npm run release"
