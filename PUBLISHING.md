# Publishing

Source repository: https://github.com/nNottp33/json-site-vscode-extension

The Marketplace publisher must be an ID owned by the maintainer. The original `local-tools` ID is a development placeholder and must be replaced before the first public Marketplace release. Share links use the running extension's actual identifier.

## One-time Marketplace setup

1. Create or select your publisher at https://marketplace.visualstudio.com/manage.
2. Set `publisher` in `package.json` to that publisher's exact ID.
3. Authenticate locally with `npx vsce login YOUR_PUBLISHER_ID`; enter the credential in the terminal's hidden prompt, never in an issue, commit, or chat.
4. Run `npx vsce verify-pat YOUR_PUBLISHER_ID` to verify access.

For PAT authentication, the token needs the Marketplace **Manage** scope and access to the publisher. See the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). The guide also documents Microsoft Entra ID authentication; `vsce publish --azure-credential` is supported. Global Azure DevOps PATs are scheduled to retire on December 1, 2026, so review the current guide when configuring long-term automation.

## Local release

```sh
npm ci
npm run check
npm test
npm run build
npm run test:ui
npm run package
npx vsce publish --packagePath json-workbench-0.2.0.vsix
```

Publish the generated, validated VSIX. Update the version in `package.json`, `package-lock.json`, and the versioned package filename in the scripts/workflow before subsequent releases.

## GitHub Actions release

The **Publish VS Code Marketplace** workflow runs manually on `master`, with the same checks as CI. Configure `VSCE_PAT` as an environment secret in the GitHub environment named `marketplace`. It is used only for the publishing step and is never stored in the repository.

Do not run the publish workflow while `publisher` is still the development placeholder. CI builds a downloadable VSIX artifact on pushes and pull requests without requiring Marketplace credentials.
