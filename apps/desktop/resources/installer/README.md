# Windows installer payload

The Windows installer keeps the complete application payload and the standard
electron-builder upgrade, uninstaller, updater-cache and shortcut lifecycle.

The stock `extractUsing7za` macro extracts the application into the Windows temp
directory and then recursively copies it into the installation directory. With
Git, Node and the runtime, this writes tens of thousands of files twice. Our
replacement extracts into a unique staging directory beside the destination and
moves its top-level entries into place on the same volume. Resource directories
are moved as a whole. No components are removed and no runtime download is added.

## Build integration

`scripts/after-pack.cjs` calls `scripts/prepare-windows-installer.cjs` on Windows.
It compiles `InstallPayload.cs` using the Windows .NET Framework compiler and
embeds the same checksum-verified 7-Zip toolset electron-builder uses, with its
license notices. Installation uses Windows' .NET Framework; it does not compile
code or invoke PowerShell on the user's machine.

The preparation script stages a private copy of electron-builder's NSIS
templates under the ignored `resources/.installer-tools/` directory. It replaces
the extraction macro and enables details output. It redirects the builder's
`nsisTemplatesDir` export in the build process; it does not change `node_modules`.
This is an internal builder API, so template edits assert their expected shape
and the CI integration test must pass when updating electron-builder. Do not
replace this with `nsis.script`: that bypasses the standard generated/signed
uninstaller path.

## Progress and errors

- The standard **Show details** button is available, initially collapsed.
- During extraction, the progress bar follows 7-Zip's reported progress. The
  estimate is explicitly **extraction time remaining**, not a guaranteed finish
  time for the whole installer. It starts after three seconds of observations,
  rounds up to five seconds, and becomes indeterminate after ten seconds without
  reported progress. Disk and antivirus activity can still make it fluctuate.
- Commit and finalization have named stages and an indeterminate progress bar.
  Completion is reported after the standard cache, registry and shortcut steps.
- A nonzero decoder/helper exit expands details and offers retry or cancel.
  Silent installations fail with a nonzero exit code instead of waiting for input.
- File moves retry for up to 15 seconds when files are temporarily held by another
  process; staging cleanup retries for five seconds. Persistent failures remain
  visible instead of silently skipping files.
- A failed extraction does not commit partial files. A failed commit attempts to
  restore the entries it replaced; backups are retained if restoration fails.
  This is **not full upgrade rollback**: the upstream installer still uninstalls
  the previous version before extracting the new version.
- Staging needs space on the destination volume and permission to create a
  sibling directory. Directory-junction installation paths are rejected rather
  than risking a cross-volume move. Only the uniquely created staging directory
  is recursively cleaned.

## Verification

Run from the repository root on Windows after installing dependencies:

```powershell
node apps/desktop/scripts/verify-installer.cjs
node apps/desktop/scripts/verify-installer-payload.cjs
node apps/desktop/scripts/verify-installer-e2e.cjs
```

These checks compile the NSIS launch paths, compare complete fixture payloads
byte for byte (including Unicode paths), exercise corrupt archives, commit
rollback/retry and ETA boundaries, and build/install/upgrade/uninstall an isolated
test application. They run in the Windows release workflow. The fixture has a
unique application identity and never launches or changes the real PilotDeck app.

Before releasing, also verify the interactive installer on Windows with a full
production payload, including a slow disk, a different destination drive and an
upgrade from a published version. The automated fixture tests do not measure
production installation time or visually validate the installer.

### Local full-payload check (2026-09-22)

A cached release payload (20,721 files, 1,063,197,368 uncompressed bytes) was also
checked with the real decoder. Extracting to C: temp took 53.24 s; recursively
copying that tree to F: took another 26.66 s. The new helper extracted on F: and
committed by moving in 62.47 s, including two retries for a transient directory
lock. All resulting files matched the extracted source by SHA-256.

This is a local **file-installation phase** comparison, not a timing of the old
and new release installers end to end. The comparison used the same decoder and
Node's recursive copy to model the old two-write path; it does not measure the
old NSIS decoder or `CopyFiles` implementation. Cache warmth, disk speed and
background scanning affect the results. No components were excluded.
