# PWA Setup

Use this after Codex Web is already running on your Mac.

Base URL examples:

- Local browser on the Mac: `http://127.0.0.1:43210`
- Phone on the same LAN: `http://<your-mac-lan-ip>:43210`

## iPhone Or iPad

1. Open the Codex Web URL in Safari.
2. Log in once so the app can store its session token for this device.
3. Tap the Share button.
4. Choose `Add to Home Screen`.
5. Open the saved icon from the Home Screen for the standalone PWA experience.

## Android

1. Open the Codex Web URL in Chrome.
2. Log in once.
3. Open the browser menu.
4. Choose `Install app` or `Add to Home screen`.
5. Launch the installed shortcut/app from the Android launcher.

## Notes

- The phone must be able to reach the Mac on the configured host and port.
- If the app fails to connect after installing, reopen it in the browser once
  and confirm the server is still running.
- If you change the host or port in `~/.config/codex-web/service.env`, reinstall
  the home-screen shortcut so you do not keep an outdated entry point.
