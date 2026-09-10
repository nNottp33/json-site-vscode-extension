# Contributing

Use Node.js 22 or newer. Clone this repository and run:

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run package
```

On Windows, UI tests use an installed Google Chrome. Set `JSON_WORKBENCH_CHROME` to a browser executable to override this. On Linux/macOS, tests use Playwright's Chromium.

Open the repository in VS Code and press F5 to debug the extension in a separate window. `npm run test:vscode` exercises the installed VS Code extension host with an isolated profile; set `JSON_WORKBENCH_VSCODE` to the executable on platforms other than Windows.

Keep JSON processing offline. Include focused regression coverage for transformations and asynchronous editor behavior, and preserve exact numeric values. Do not commit local history, credentials, test profiles, or private sample documents.

For bug reports, include the extension and VS Code versions, reproduction steps, and a small synthetic JSON sample. Avoid including production data or credentials.

Contributions are licensed under the repository's MIT license. Bundled dependencies retain their respective licenses in `THIRD_PARTY_NOTICES.txt`.
