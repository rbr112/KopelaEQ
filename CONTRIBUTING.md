# Contributing to KopelaEQ

## Required checks

Before a change is considered mergeable:

```text
npm run typecheck
npm run qa
```

For a release candidate:

```text
npm run release
```

## Audio compatibility rule

Do not change EQ topology, filter types, preset data, Dynamics/Protection tuning, or bypass behavior in the same change as unrelated UI/build refactoring.

The accepted EQ response is protected by browser-native golden tests at 44.1 and 48 kHz. A non-zero response change must be intentional, documented, and listening-tested.

## Runtime messages

Treat messages arriving through `chrome.runtime.onMessage` as `unknown`. Add new message types to the typed union and runtime parser together, then cover them in `tests/messages.test.mjs`.

## Permissions

Do not add host permissions, `scripting`, content scripts, remote code, analytics, or network access without a concrete user-facing requirement and a separate privacy/security review.
