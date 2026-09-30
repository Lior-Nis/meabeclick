# Icon artwork

One SVG per name in `../registry.ts`. A file whose name matches nothing there
fails `tests/unit/icons.test.mjs` rather than silently never rendering, and a
name with no file fails `tests/characterization/icons.test.mjs` rather than
quietly showing an emoji among the icons.

## Where these came from

[Lucide](https://lucide.dev), **ISC licensed**, vendored by
`scripts/vendor-icons.mjs` from the `lucide-static` dev dependency. Each file
keeps a header naming its upstream icon and version.

Vendored rather than imported at runtime on purpose: the app uses ~30 of
Lucide's 2000, the files are a few hundred bytes, and inlining them costs no
request and no runtime dependency. It also means any single icon can be
replaced with custom artwork without fighting a package — drop a new
`booking.svg` over the vendored one and only that icon changes.

One exception: `whatsapp.svg` is WhatsApp's own mark, from
[Simple Icons](https://simpleicons.org) (**CC0**), added by hand because
Lucide has no brand icons. It is used only on links that open a WhatsApp
chat, and the vendor script does not touch it. It is a filled glyph, so its
path says `fill="currentColor" stroke="none"`: the icon CSS outlines by
default.

To refresh after `npm i -D lucide-static@latest`:

```bash
node scripts/vendor-icons.mjs
```

The script maps this app's names to Lucide's filenames and **fails loudly** if
an upstream icon was renamed (`help-circle` became `circle-help` once
already), rather than dropping it.

### Licence

ISC, which permits commercial use and redistribution provided the copyright
notice is retained — hence the per-file header. No attribution link is
required on the site itself.

> Note for anything sourced later: Icons8's free tier is PNG only **and
> requires a visible backlink in production**; SVG needs a paid plan. PNG
> also cannot meet the colour contract below.

## What replacement artwork has to do

The component sets `stroke: currentColor` and maps any solid `fill` to it, so
**one file works everywhere** — on the blue hero, on a white card, in a muted
footer. That only holds if the SVG does not carry its own colours. A
characterization test asserts this on the rendered page.

- `viewBox="0 0 24 24"`, no `width`/`height` — the component sizes it
- no `fill="#..."` / `stroke="#..."`; inherit instead
- one visual weight across the set (Lucide's `stroke-width="2"` reads well at
  the 17–20px most call sites use)
- no `<style>` blocks and no `id`s: these are inlined into the page, so ids
  collide between icons and a `<style>` leaks into the document
