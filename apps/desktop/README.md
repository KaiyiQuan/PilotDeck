# PilotDeck Desktop

Electron desktop shell for the existing PilotDeck Web UI and local gateway runtime.

## Development

```bash
pnpm install --frozen-lockfile
pnpm --filter pilotdeck-desktop dev
```

The desktop process starts the existing PilotDeck gateway and UI server as local
child processes, then opens the packaged Web UI inside an Electron window.

## Windows background behavior

Closing the main window (including Alt+F4) hides it in the Windows notification
area and keeps the local runtime and tasks running. Click the PilotDeck tray icon
or choose **Open main window** to restore the same window and its current state.
Launching the client again also restores the existing instance.

The tray's **Quit** command and **File > Exit** restore the main window and show
an owned confirmation dialog. Cancel is the default. Confirming stops the managed
runtime before the application exits; automatic updates use their existing quit
path without a second confirmation. Tray menus and confirmation text follow the
application language. macOS and Linux retain their existing close behavior.

Run `node --test apps/desktop/scripts/windows-tray.test.mjs` from the repository
root for the controller checks. On Windows,
`node apps/desktop/scripts/verify-windows-tray.cjs` also exercises real Electron
windows, single-instance activation and process cleanup with an isolated fixture
runtime and profile. The fixture answers confirmation dialogs programmatically.

## Packaging

```bash
# Run the command matching the Mac host architecture:
pnpm --filter pilotdeck-desktop dist:mac:arm64
pnpm --filter pilotdeck-desktop dist:mac:x64
pnpm --filter pilotdeck-desktop dist:win
```

Platform release builds should run on matching GitHub Actions runners:

- macOS arm64 DMG artifacts on `macos-latest`
- macOS x64 DMG artifacts on `macos-15-intel`
- Windows x64 NSIS installer artifacts on `windows-latest`

macOS CI signs and notarizes release artifacts when the repository provides
these GitHub Secrets:

- `MACOS_DEVELOPER_ID_APPLICATION_P12_BASE64`: base64-encoded `.p12` for
  a valid `Developer ID Application` certificate.
- `MACOS_DEVELOPER_ID_APPLICATION_PASSWORD`: the `.p12` export password.
- `MACOS_KEYCHAIN_PASSWORD`: optional password for the temporary CI keychain.
- `APPLE_ID`: Apple account email used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: Apple app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

CI release builds fail closed when signing credentials are absent. Local macOS
development packages may still use ad-hoc signing.

Each packaging script stages one architecture-matched, production-only runtime
in `.runtime/app` before calling `electron-builder`; the final app should not
include the other macOS architecture or the workspace development dependency
tree.

See [`docs/release.md`](../../docs/release.md) for the daily
release policy, required GitHub Secrets, manual recovery, and Web deployment
compatibility guarantees.
