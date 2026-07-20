# Install bubbertron9001 on a Mac

This is the no-Terminal setup path for a B9 user.

## Put B9 in Applications

1. Double-click the bubbertron9001 `.dmg` file.
2. Drag the bubbertron9001 icon onto the Applications folder shown beside it.
3. Eject the bubbertron9001 installer from Finder.
4. Open **Applications**, then open **bubbertron9001**.

## Follow B9 Setup

B9 checks each step and advances when it is ready:

1. **Get Roblox Studio** — opens the official Studio download if it is missing.
2. **Add B9 to Studio** — installs the securely paired plugin with one click.
3. **Sign in to ChatGPT** — opens browser sign-in for Plus or Pro users.
4. **Connect your first game** — opens Studio and shows the exact connection
   steps.

For the last step, open or create a game in Studio, choose **File → Experience
Settings → Security**, turn on **Allow HTTP Requests**, then click
**bubbertron9001 → Connect** in the Studio toolbar. Return to B9 and choose
**Check connection**.

When all four steps are green, choose **Start building**. The setup guide can be
run again later from B9 Settings.

## Parent note: macOS trust

A clean one-click install on another Mac requires the app to be signed with an
Apple **Developer ID Application** certificate and notarized. Until those
release credentials are configured, a locally built DMG can trigger Apple's
"unidentified developer" warning on a different Mac.

For a one-time family install of this locally ad-hoc-signed build, a parent can
Control-click bubbertron9001 in Applications, choose **Open**, then confirm
**Open**. This remains a clickable path, but signed and notarized release builds
are the proper long-term distribution path.

The child’s Mac does not need Node.js, Rust, Git, or any Terminal commands.
