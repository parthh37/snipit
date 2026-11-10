# Releasing

Releases are built and published by [`.github/workflows/release.yml`](../.github/workflows/release.yml).
Installed copies of Snipit find new releases through the in-app updater.

## Cut a release

Either:

- **From GitHub** — Actions → **Release** → **Run workflow** on `main`, enter the version
  (e.g. `0.2.0`). The workflow bumps the version, commits `Release v0.2.0` to `main`, tags
  it and publishes the release.
- **From your machine** — on an up-to-date `main`:

  ```bash
  npm run release -- 0.2.0
  git push --follow-tags
  ```

  `npm run release` updates the version in `package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, commits
  and creates an annotated `v0.2.0` tag. Pushing the tag starts the workflow.

The workflow then:

1. Checks the tag matches the version in every file above.
2. Creates a **draft** GitHub release: install instructions from
   [`.github/release-notes.md`](../.github/release-notes.md), then notes generated from
   merged PRs.
3. Builds the NSIS (`.exe`) and MSI installers, signs them for the updater and uploads them
   with `latest.json`.
4. Uploads the same installers under fixed names, `Snipit-Setup.exe` and
   `Snipit-Setup.msi`, plus `SHA256SUMS.txt`. So
   `https://github.com/parthh37/snipit/releases/latest/download/Snipit-Setup.exe` always
   downloads the newest installer (the README links to it).
5. Publishes the release. Only now do installed apps see it.

If the `TAURI_SIGNING_PRIVATE_KEY` secret is missing, the release still goes out with both
installers but without `latest.json`, and the run shows a warning: people can install it,
but installed copies aren't offered it as an update. Add the key (below) before relying on
auto-update.

## Which installer

| File               | Installs for              | Admin? | Use it for                                     |
| ------------------ | ------------------------- | ------ | ---------------------------------------------- |
| `Snipit-Setup.exe` | The current Windows user  | No     | Everyone (the default download)                |
| `Snipit-Setup.msi` | All users on the computer | Yes    | Shared PCs, IT deployment (`msiexec /i … /qn`) |

Both bundle the WebView2 bootstrapper, add a Start menu entry and update themselves.
The `.exe` stays per-user on purpose: Tauri's "per-user or per-machine" NSIS mode asks
administrators for UAC elevation on every install and every silent update.

A version with a suffix (`0.2.0-beta.1`) is published as a pre-release. The updater only
follows the latest full release, so pre-releases reach testers who download them, not
everyone.

If `main` is branch-protected, the "Run workflow" path needs `github-actions[bot]` allowed
to push to it; otherwise release from your machine.

## How auto-update works

- `plugins.updater` in `src-tauri/tauri.conf.json` points at
  `https://github.com/parthh37/snipit/releases/latest/download/latest.json` and holds the
  **public** key.
- The checks run in the Rust core (`src-tauri/src/updater.rs`), not the main window, so they
  keep working while Snipit sits in the tray. Release builds check 5 s after start and then
  every 6 hours (30 minutes after a failed check, e.g. no network yet after a launch at
  login). Settings → **Updates** turns automatic checks off. Dev builds only check on request.
- Checking by hand: the footer link or the tray menu's **Check for updates…**.
- When a newer version exists, the main window shows a banner, the tray tooltip says so, and
  the tray item becomes **Update to Snipit x.y.z…**. If the window is hidden, a notification
  appears once per version. **Update & restart** (or the tray item) downloads it, verifies
  its signature and runs the installer in passive mode (progress bar, no prompts).
- Updater artifacts (`.sig` files) are only produced when building with
  `--config src-tauri/tauri.release.conf.json`, so local and CI builds don't need the key.

## Updater signing key (one-time setup)

The updater refuses any download not signed by the private key matching the public key in
`tauri.conf.json`. The key pair lives outside the repo:

| File                           | What                                      |
| ------------------------------ | ----------------------------------------- |
| `~/.tauri/snipit.key`          | Private key — **never commit or share**   |
| `~/.tauri/snipit.key.password` | Its password                              |
| `~/.tauri/snipit.key.pub`      | Public key (already in `tauri.conf.json`) |

Add the private key and password as repository secrets:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/snipit.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/snipit.key.password
```

Back both files up somewhere safe (a password manager). **If the private key is lost,
existing installs can never auto-update again** — users would have to reinstall manually.

To rotate the key: `npx tauri signer generate -w ~/.tauri/snipit.key`, put the new public
key in `tauri.conf.json`, update both secrets, and ship one release signed with the _old_
key that contains the _new_ public key before switching.

## Test a signed build locally

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/snipit.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/snipit.key.password)" \
npm run tauri build -- --config src-tauri/tauri.release.conf.json
```

## Windows code signing (not set up yet)

Installers are not Authenticode-signed, so Windows SmartScreen shows "Windows protected
your PC" on first run (users click **More info → Run anyway**). This is separate from the
updater key above. Options: [SignPath Foundation](https://signpath.org) (free for open
source) or Azure Trusted Signing; both plug into `bundle.windows.signCommand`.
