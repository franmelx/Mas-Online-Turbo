#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${project_dir}"
version=$(node -p "require('./manifest.json').version")
release_dir="${project_dir}/release"
archive="${release_dir}/masonline-turbo-${version}.zip"
kit="${release_dir}/masonline-turbo-submission-kit-${version}.zip"

mkdir -p "${release_dir}"
for target in "${archive}" "${kit}" "${archive}.sha256" "${kit}.sha256"; do
  if [ -e "${target}" ]; then
    echo "El entregable ya existe: ${target}. Incremente la versión para conservar el anterior." >&2
    exit 1
  fi
done
node -e 'const m=require("./manifest.json"), p=require("./package.json"); if(m.version!==p.version || m.manifest_version!==3) throw Error("Versión o manifiesto inválido")'
npm test
npm run check
make_zip() {
  local output="$1"
  shift
  if command -v bsdtar >/dev/null 2>&1; then
    bsdtar -a -cf "${output}" "$@"
  elif command -v zip >/dev/null 2>&1; then
    zip -r -q "${output}" "$@"
  else
    echo "Se necesita bsdtar o zip para empaquetar." >&2
    return 1
  fi
}
make_zip "${archive}" manifest.json src assets/icons PRIVACY.md README.md CHANGELOG.md LICENSE LICENSE-ES.md
make_zip "${kit}" store-assets docs PUBLISHING.md PRIVACY.md CHANGELOG.md LICENSE LICENSE-ES.md
unzip -t "${archive}"
unzip -t "${kit}"
cd "${release_dir}"
sha256sum "masonline-turbo-${version}.zip" > "${archive}.sha256"
sha256sum "masonline-turbo-submission-kit-${version}.zip" > "${kit}.sha256"
echo "${archive}"
echo "${kit}"
