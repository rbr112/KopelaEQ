# Security policy

KopelaEQ is a local-only browser extension and should not contain remote executable code, analytics, or developer-controlled network calls.

If you find a security issue, avoid publishing exploit details in a public issue before the maintainer has had a chance to investigate. Prefer GitHub private vulnerability reporting when it is enabled for the repository; otherwise use the repository's maintainer contact channel.

Useful reports should include:

- affected KopelaEQ version;
- Chrome/Chromium version and operating system;
- exact reproduction steps;
- whether the issue involves permissions, storage, tab capture, offscreen lifetime, or injected/remote code;
- relevant console errors with sensitive page/audio content removed.

Do not attach captured personal audio to a public report.

## Imported theme files

Custom theme JSON is treated as untrusted input and passes through `theme-validator.ts` before registration. Theme ids, colors, numeric ranges, typography presets, artwork ids, and EQ tokens are allow-listed; built-in ids are reserved. Theme files cannot inject CSS, JavaScript, remote URLs, or WebAssembly.
