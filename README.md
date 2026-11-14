# Equal Views

Keeps the open views of a workbench region equally sized. In the side bar that
means Explorer, Source Control, Outline and Timeline each get the same share of
the height instead of you dragging the splitters on every layout change.

## Why this is not a normal extension

VS Code's extension API has no way to size a view section or a workbench part:
`vscode.d.ts` exposes no layout call at all, the splits belong to the internal
`PaneView`/`SplitView`, and the only related commands
(`workbench.action.increaseViewSize` / `decreaseViewSize`) resize a whole part,
not one view. Configuring the width was requested in
[microsoft/vscode#158603](https://github.com/microsoft/vscode/issues/158603) and
is still open.

What VS Code does have is a built-in gesture: double-clicking the splitter
between two views averages their heights (`PaneView#onDidSashReset`). This
extension replays exactly that gesture, so it uses VS Code's own sizing code
instead of guessing at heights.

The cost of that shortcut: the extension appends a small side-car to
`workbench.desktop.main.js`. That edits the installation, so VS Code will
report an unsupported installation once (dismiss it with *Don't Show Again*),
and a VS Code update replaces the file. The extension re-applies itself on the
next start when `equalViews.autoRepatch` is on.

## Install

```bash
git clone git@github.com:enginkirmaci/vscode-extension-equal-views.git
cd vscode-extension-equal-views
npx @vscode/vsce package
code --install-extension equal-views-0.1.0.vsix
```

Then run **Equal Views: Enable** from the command palette and reload the
window. On an installation owned by root (Arch's `visual-studio-code-bin`, for
example) the patch is applied through `sudo -n`. If that is not available, run
VS Code once from a terminal that can write to the installation, or install
VS Code for your user.

## Commands

| Command | What it does |
| --- | --- |
| `Equal Views: Enable` | Appends the side-car to the workbench bundle and offers a reload. |
| `Equal Views: Disable and Restore` | Copies the backup back over the bundle and offers a reload. |
| `Equal Views: Show Status` | Reports whether the bundle is patched, whether a backup exists, and the bundle size. |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `equalViews.targets` | `["sidebar"]` | Regions to equalise: `sidebar`, `secondarySideBar`, `panel`. Written into the side-car, so reload after changing it. |
| `equalViews.autoRepatch` | `true` | Re-apply the side-car after a VS Code update replaced the bundle. |

## Behaviour

- Only expanded views count; collapsed ones keep their header height.
- A manual splitter drag wins. The side-car steps back and only takes over again
  when the region changes shape (a view is opened or closed, or the window is
  resized).
- A region that cannot be split evenly (minimum view sizes) is left alone until
  its shape changes, so the side-car never fights the layout in a loop.
- The side-car only reads the DOM and dispatches a `dblclick` on the splitters;
  it does not touch any VS Code state.

## Uninstall

Run **Equal Views: Disable and Restore** first, then uninstall the extension.
The restored bundle also clears the unsupported installation notice after a
restart.

## Development

There is no build step: the extension is plain CommonJS and the side-car is a
standalone file in `media/`.

```bash
npm test          # patcher round-trip, payload compilation
npx @vscode/vsce package
```

## Türkçe özet

Kenar çubuğundaki açık view'ları (Explorer, Source Control, Outline, Timeline)
eşit yüksekliğe getirir. VS Code'un eklenti API'si view boyutu ayarlamaya izin
vermediği için, VS Code'un kendi "ayırıcıya çift tıkla" davranışını otomatik
olarak tekrarlar. Bunun için `workbench.desktop.main.js` dosyasına küçük bir
ek ekler: ilk açılışta "unsupported installation" uyarısı çıkar, VS Code
güncellemesinden sonra eklenti kendini yeniden uygular. Kaldırmak için
**Equal Views: Disable and Restore** komutunu çalıştır.
