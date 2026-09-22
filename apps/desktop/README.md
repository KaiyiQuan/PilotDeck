# PilotDeck Desktop

Electron desktop shell for the existing PilotDeck Web UI and local gateway runtime.

## Development

```bash
pnpm install --frozen-lockfile
pnpm --filter pilotdeck-desktop dev
```

The desktop process starts the existing PilotDeck gateway and UI server as local
child processes, then opens the packaged Web UI inside an Electron window.

## Background behavior and quitting

On macOS, the red close button and **File > Close Window** (`Cmd+W`) hide the
main window without destroying it. Tasks continue, and the same interface is
restored by clicking the Dock icon or choosing **Open main window** from the
PilotDeck status icon at the top of the screen. Full-screen windows leave their
Space before hiding. Minimizing and `Cmd+H` retain their native behavior. The Dock
icon remains available even if the status icon cannot be created.

The status icon menu, Dock **Quit**, application **Quit PilotDeck**, and `Cmd+Q`
share one native confirmation dialog. Cancel is the default. Confirming stops
the managed server, gateway and task processes before exiting. If cleanup fails,
the window reappears with an error and quitting can be retried. Menus and the
confirmation follow the application language. The status icon uses a monochrome
template image for light/dark menu bars, with a Retina representation.

This does not prevent sleep or change power management. System shutdown and
update installation bypass the user confirmation; update failure restores the
runtime and normal quit protection.

### Windows

Closing the main window (including Alt+F4) hides it in the Windows notification
area and keeps the local runtime and tasks running. Click the PilotDeck tray icon
or choose **Open main window** to restore the same window and its current state.
Launching the client again also restores the existing instance.

The tray's **Quit** command and **File > Exit** restore the main window and show
an owned confirmation dialog. Cancel is the default. Confirming stops the managed
runtime before the application exits; automatic updates use their existing quit
path without a second confirmation. Tray menus and confirmation text follow the
application language. Linux retains its existing close behavior.

Run `node --test apps/desktop/scripts/desktop-lifecycle.test.mjs` from the repository
root for the cross-platform controller checks. On macOS or Windows,
`node apps/desktop/scripts/verify-desktop-lifecycle.cjs` exercises the production
main process with real Electron windows and isolated server/gateway/task
processes. It covers hiding during startup, state-preserving restoration,
minimization, native macOS full screen, native quit dispatch, cancellation,
cleanup failure/retry, startup quit, update preparation/recovery and shutdown.
Windows also checks second-instance restoration. Dialog responses, update
handoff and shutdown events are simulated; the test never installs an update or
shuts down the host. Each scenario uses its own profile/configuration, and owned
process trees are cleaned even if an assertion fails.

The Windows release workflow also accepts the existing
`verify-windows-tray.cjs` entry point. Mac lifecycle checks run in Desktop Smoke
and both architecture-specific release builds. For manual validation of OS entry
points, check the actual red close button, `Cmd+W`, Dock click/right-click Quit,
status menu Open/Quit and `Cmd+Q`; cancel once, then confirm with a task running.
For an isolated native-dialog session, run
`node apps/desktop/scripts/verify-desktop-lifecycle.cjs manual` (five-minute timeout).
Confirm that restoring retains the draft and that quitting leaves no managed
runtime processes. Check the status icon in both light and dark menu bars.

Regenerate status icons from the checked-in SVG with
`node apps/desktop/scripts/rebuild-tray-icon.mjs`.

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
