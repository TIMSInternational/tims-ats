#!/usr/bin/env bash
#
# Encrypt a directory to an owner-held age public key before it is uploaded as a GitHub artifact (#336).
#
# WHY. This repository is PUBLIC, so its workflow artifacts are downloadable by any signed-in GitHub user.
# The schema re-capture artifact is a fresh, NOT-YET-REVIEWED production dump: a function body or comment
# changed out of band can hold anything, and scripts/security/scan-for-credentials.sh is a denylist — a
# credential with an unlisted shape (an `Authorization: Basic …` header, an opaque token) passes it. So the
# artifact is private by construction instead: only ciphertext is uploaded, readable with the private key
# that never leaves its owner. The recipient is a PUBLIC key, held in a repository or environment VARIABLE
# (not a secret); nothing here needs or sees a secret.
#
# USAGE
#   encrypt-artifact.sh --check            validate the recipient and the age binary only (run BEFORE dumping)
#   encrypt-artifact.sh SRC_DIR OUT_DIR    tar SRC_DIR, encrypt it to the recipient into OUT_DIR
# The recipient is read from $AGE_RECIPIENT. OUT_DIR must be absent or empty; afterwards it holds exactly
# <name>.tar.gz.age and DECRYPT.txt, where <name> is SRC_DIR's base name.
#
# EXIT  0 = done · 2 = could not run (no or malformed recipient, no age binary, encryption failed). Nothing
# is written to OUT_DIR unless encryption succeeded; a failure must stop the upload, never fall back to
# plaintext.
set -euo pipefail

die2() {
  echo "✖ ARTIFACT ENCRYPTION DID NOT RUN — $1" >&2
  echo "  Nothing was encrypted; do not upload anything." >&2
  exit 2
}

check_prereqs() {
  [ -n "${AGE_RECIPIENT:-}" ] || die2 "AGE_RECIPIENT is empty. Set the SCHEMA_CAPTURE_AGE_RECIPIENT variable to the owner's age public key
  (age-keygen -o key.txt prints it as 'Public key: age1...'; keep key.txt offline)."
  # An X25519 age recipient: "age1" + 58 bech32 characters. Anything else is refused, not passed to age.
  [[ "$AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || die2 "AGE_RECIPIENT is not an age X25519 public key (age1 + 58 bech32 characters)."
  command -v age >/dev/null 2>&1 || die2 "the age binary is not installed (apt-get install age)."
}

if [ "${1:-}" = "--check" ]; then
  check_prereqs
  echo "✓ age recipient and binary present"
  exit 0
fi

[ "$#" -eq 2 ] || die2 "usage: $0 --check | $0 SRC_DIR OUT_DIR"
SRC="$1"
OUT="$2"
[ -d "$SRC" ] || die2 "source directory not found: $SRC"
check_prereqs
if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then die2 "output directory is not empty: $OUT"; fi

name="$(basename "$SRC")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

tar -czf "$work/$name.tar.gz" -C "$SRC" . || die2 "tar failed"
age -r "$AGE_RECIPIENT" -o "$work/$name.tar.gz.age" "$work/$name.tar.gz" || die2 "age failed"
# Belt and braces: the output must be an age file, never the plaintext tarball passed through.
[ "$(head -c 21 "$work/$name.tar.gz.age")" = "age-encryption.org/v1" ] || die2 "age produced no age-format output"

mkdir -p "$OUT"
mv "$work/$name.tar.gz.age" "$OUT/"
cat >"$OUT/DECRYPT.txt" <<EOF
This artifact is encrypted to the owner's age key (#336): the repository is public, and the content is an
unreviewed production schema dump.

  age -d -i key.txt $name.tar.gz.age | tar -xz -C <empty directory>

then follow README.txt inside it. Recipient: $AGE_RECIPIENT
EOF
echo "✓ encrypted $name to $AGE_RECIPIENT → $(basename "$OUT")/$name.tar.gz.age"
