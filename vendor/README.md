# Bundled third-party files

Everything the browser needs is served from here, so the application runs
without any network access (no CDN, no third-party request).

| File | Project | Version | License |
| --- | --- | --- | --- |
| `jquery-3.7.1.min.js` | [jQuery](https://jquery.com/) | 3.7.1 | MIT (`jquery-LICENSE.txt`) |
| `chessboard-1.0.0.min.js`, `chessboard-1.0.0.min.css` | [chessboard.js](https://chessboardjs.com/) | 1.0.0 | MIT (`chessboard-LICENSE.md`) |
| `img/chesspieces/wikipedia/*.png` | Chess pieces by Colin M.L. Burnett (Wikipedia user Cburnett), PNG renderings shipped with chessboard.js | - | Multi-licensed by the author: GFDL 1.2+, CC BY-SA 3.0, BSD 3-Clause |

jQuery and chessboard.js are the unmodified `dist` files of the npm packages
`jquery@3.7.1` and `@chrisoakman/chessboardjs@1.0.0` (byte-identical to the
copies served by code.jquery.com and unpkg.com). The piece images are the
unmodified files from `website/img/chesspieces/wikipedia/` in the
[chessboard.js repository](https://github.com/oakmac/chessboardjs).

The rest of the application (`chess.js` excepted, see its header) is released
under CC0 / WTFPL; the files in this directory keep their own licenses.

## Updating

```
npm pack jquery@<version> @chrisoakman/chessboardjs@<version>
tar -xzf jquery-<version>.tgz        package/dist/jquery.min.js
tar -xzf chrisoakman-chessboardjs-<version>.tgz package/dist/
```

Then copy the files here, rename `jquery.min.js` to `jquery-<version>.min.js`
and update the three `vendor/...` references in `index.php` (one `<link>`, two
`<script>`). chessboard.js needs jQuery 1.8.3 or later.
