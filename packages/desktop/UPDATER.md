# Desktop Auto-Updater

## How it works

On startup, H checks `https://github.com/HousamKak/H/releases/latest/download/latest.json`
for a new version. If found, Tauri shows a dialog; accepting downloads and
installs the signed update, then restarts.

## Releasing a new version

1. **Bump version** in `packages/desktop/src-tauri/tauri.conf.json` (the `version` field).
2. **Commit and push** to `main`.
3. **Tag the release**:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. GitHub Actions (`release-desktop.yml`) will:
   - Build the web frontend
   - Bundle the backend
   - Build the Tauri installer (MSI + NSIS)
   - Sign with the private key (from repo secrets)
   - Create a GitHub release with `H_x.y.z_x64-setup.exe`, `.msi`, `.sig` files, and `latest.json`
5. Installed apps will detect the new version on their next startup.

## Signing key

- Public key is embedded in `tauri.conf.json` → `plugins.updater.pubkey`
- Private key is stored as GitHub secret `TAURI_SIGNING_PRIVATE_KEY`
- Generated via `npx tauri signer generate` (stored locally in `D:/.tauri-keys/`)
- If you lose the private key, updates break — you'd need to release a new binary
  manually with a new public key (users would need to reinstall).

## Manual trigger

Use the "Check for Updates" item in the system tray menu to force a check
outside of startup.
