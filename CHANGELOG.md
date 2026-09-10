# Changelog

## 0.2.0

- Optional history sync across devices through VS Code Settings Sync, off by default and enabled per device.
- Shares up to 20 recent entries (1 MiB each, 64 KiB per snapshot) with content hashing, bounded decompression, and snapshot validation before any local change.
- Deletions propagate with 90-day tombstones so removed items do not reappear, and a newer intentional re-add supersedes a deletion.
- Larger or older items and editor drafts stay local; the History sidebar shows prepared and local-only counts and a setup guide.

## 0.1.0

- Split Monaco editors with live JSON validation and lossless number formatting.
- Editor, Tree, Table, Graph, and Type views for both panes.
- Format, minify, stringify, unescape, deep parse, repair, and recursive key sorting.
- JSON Pointer navigation and extraction, paginated tables, and lazy tree expansion.
- Type generation for 12 languages and JSON Schema in a separate worker.
- Local history and draft restoration, file import/export, share links, and Monaco diff.
- Light/dark themes, font and indentation settings, word wrap, and adjustable panes.

This is an independent project inspired by json.site. Hosted json.site sharing and pixel-identical UI are not included.
