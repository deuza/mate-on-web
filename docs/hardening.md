# Mate On Web: hardening notes

This document details the security measures built into Mate On Web, and the web server configuration that completes them. The [README](../README.md) covers installation and everyday use.

1. [Principles](#1-principles)
2. [Entry points](#2-entry-points)
3. [Puzzle data](#3-puzzle-data)
4. [Generation pipeline](#4-generation-pipeline)
5. [Browser dependencies](#5-browser-dependencies)
6. [Web server configuration](#6-web-server-configuration)
7. [Rate limiting](#7-rate-limiting)
8. [Checking the configuration](#8-checking-the-configuration)
9. [Supported versions](#9-supported-versions)

---

## 1. Principles

- **Nothing is stored :** No session, no database, no file written by the web pages. `index.php` and `puzzle.php` only read the puzzle files; the session statistics live in the browser's memory.
- **Allow lists on the way out :** The puzzle files are generated from downloaded data. Everything `puzzle.php` sends to the browser is checked against its expected shape first (see section 3), so that a corrupt or hostile file can never put anything else than a position, a move list and a Lichess address in the page.
- **No inline script :** The page attaches its handlers in `app.js`, so that a strict content security policy can apply (section 6).
- **Defence in depth :** The protections that depend on the web server (section 6) are backed by the code where that is possible, and the other way round.

## 2. Entry points

- `index.php` reads no request parameter. It lists the puzzle files and their line counts (`matN.count`, counted again only when the count file is missing or older than its CSV).
- `puzzle.php` only accepts POST with a JSON body. Any other method gets a 405 with `Allow: POST`.
- **Body size :** A valid request is about a dozen bytes (`{"level":1}`). A declared `Content-Length` above 1024 bytes is refused with a 413 before anything is read, and the read itself is capped at 1024 bytes: `post_max_size` does not bound `php://input` (PHP only logs a warning and the stream stays readable), and a chunked body has no `Content-Length`. The web server adds its own limit (section 6).
- **Level :** cast to an integer, must be between 1 and 5; the file name is built from that integer only.
- **Reads :** the random pick seeks to a random offset and reads at most two lines, each bounded to 4096 bytes. An oversized line (the lines are about 150 bytes long) is served as a fragment, which the validation below rejects with a 500.

## 3. Puzzle data

The CSV fields come from the Lichess puzzle database, through `extract.py`. Before they leave the server :

- **FEN :** must match the six fields written by python-chess : `[pnbrqkPNBRQK1-8/]+ [wb] (-|[KQkq]+) (-|[a-h][36]) \d+ \d+`.
- **Solution :** UCI moves only, `[a-h][1-8][a-h][1-8][qrbn]?`, separated by single spaces.
- **URL :** must start with `https://lichess.org/`, otherwise the link is made inert (`#`). `app.js` applies the same rule before writing the `href`, and the link carries `rel="noopener noreferrer"`.
- **Opening :** only ever written through `textContent`, never as HTML.
- **Encoding :** a byte that is not UTF-8 is substituted (`JSON_INVALID_UTF8_SUBSTITUTE`) instead of making `json_encode()` fail silently; if encoding fails all the same, the response is a 500, not an empty 200.

The solution is sent to the browser on purpose : the moves are checked in the browser, there is no score, no account and no ranking, and the puzzle page on Lichess is public.

## 4. Generation pipeline

`download_puzzles.sh` and `extract.py` fetch and transform the Lichess dump. They run outside the web pages, by hand or from a scheduled task.

- **Run them as an unprivileged user, from a directory the web server cannot write to.** The README clones the project into the document root for simplicity; the dump, the venv and the scripts are then refused by the web server configuration (section 6), but they still live next to the served files. A dedicated directory (`/var/lib/mate-on-web` for instance) with only `matN.csv` and `matN.count` copied into the web directory is the cleaner layout. `puzzle.php` reads the CSV files by relative path, so they must stay next to the PHP files.
- **Pinned dependency :** `requirements.txt` pins `chess` (the current name of python-chess) to one version and its SHA-256 hash; `pip install --require-hashes -r requirements.txt` refuses anything else. To upgrade : check the new hash on the release page of PyPI, update the file, run the pipeline on a copy and check the output.
- **Atomic swap :** each `matN.csv` is written aside (`.tmp`) and moved into place once complete; the previous puzzles stay served meanwhile, and an extraction that fails leaves the current file untouched. The line count is written before the swap, so `index.php` never falls back on counting the lines.
- **Interpreter :** the venv's `python3` is called explicitly with `-I`, which ignores the `PYTHON*` environment variables and keeps the current directory out of `sys.path` : a stray `chess.py` next to the script could not replace the library.
- **Tolerant parsing :** a header, empty, truncated or move-less line is skipped and counted, instead of aborting the extraction with a partial file; bytes that are not UTF-8 are replaced.
- **Scripts :** both are executable in git (`100755`), as the README calls them.

## 5. Browser dependencies

- jQuery, chessboard.js, chess.js and the twelve piece images are served from the project itself : no third-party host is contacted when the page runs. The only outgoing link is the Lichess page of the puzzle, opened with `rel="noopener noreferrer"`.
- `vendor/SHA256SUMS` lists the hash of every third-party file (`chess.js` at the root included). After any update, check the new files by other means (the npm registry's own integrity check in `npm pack`), then refresh the list :

  ```
  cd vendor && sha256sum ../chess.js *.js *.css img/chesspieces/wikipedia/*.png > SHA256SUMS
  ```

  and check an installation with `(cd vendor && sha256sum -c SHA256SUMS)`.

## 6. Web server configuration

The code protects itself, but some protections can only come from the web server : they do not exist without its configuration. **That configuration is therefore not optional**, and it is to be applied before the page is opened to others. Without it, Debian's defaults for `/var/www` serve `.git/`, `venv/`, the scripts and the puzzle files (tens of megabytes each) with directory listings, and send no security header at all.

| Protection                              | In the code                                   | In the server configuration                     |
|-----------------------------------------|-----------------------------------------------|-------------------------------------------------|
| Puzzle files, dump, scripts not served  | none                                          | `Require all denied` on their extensions        |
| `venv/` not served                      | none                                          | `Require all denied`                            |
| `.git` not readable                     | none                                          | refused on the whole server                     |
| No directory listing                    | none                                          | `Options -Indexes`, `autoindex off`             |
| Request body of `puzzle.php` bounded    | 413 above 1024 bytes, read capped             | `LimitRequestBody 4096`, `client_max_body_size` |
| Hardening headers                       | none                                          | `nosniff`, `DENY`, `no-referrer`                |
| Content security policy                 | no inline script, so that it can apply        | one policy for the whole directory              |
| Server version hidden                   | none                                          | `ServerTokens Prod`, `server_tokens off`        |

The configuration ships with the project, ready to install : [`docs/apache2/mate-on-web.conf`](apache2/mate-on-web.conf) and [`docs/nginx/mate-on-web.conf`](nginx/mate-on-web.conf).

### Apache

From the root of the project, with PHP through `libapache2-mod-php` or `php-fpm` :

```
cp docs/apache2/mate-on-web.conf /etc/apache2/conf-available/mate-on-web.conf
a2enmod headers
a2enconf mate-on-web
apache2ctl configtest && systemctl reload apache2
```

- **The order matters :** `Header` is a directive of mod_headers, without the module `configtest` stops on `Invalid command 'Header'`. To back out halfway : `a2disconf mate-on-web`.
- **The paths :** the file expects the project in `/var/www/html/mate-on-web` : adjust its two `<Directory>` paths if it lives elsewhere.
- **`.git` is refused on the whole server**, for every clone below the document roots. The same `<DirectoryMatch>` ships with Staunton : the duplicate is harmless.
- **Headers set elsewhere :** the file sets its headers with `Header always set`. A `Header set` (without `always`) for the same header in the virtual host or in `security.conf` is not overridden : Apache then sends both values. Check that each header is sent once (section 8).

#### Server identity

In `/etc/apache2/conf-available/security.conf` : `ServerTokens Prod` and `ServerSignature Off`, then `apache2ctl configtest && systemctl reload apache2`.

#### HTTPS

Serve the site over HTTPS. HSTS (`Strict-Transport-Security`) belongs to the virtual host, not to this file : it commits the whole site.

### nginx

Configuration with PHP-FPM, equivalent to the Apache one. On Debian :

```
cp docs/nginx/mate-on-web.conf /etc/nginx/sites-available/mate-on-web
ln -s /etc/nginx/sites-available/mate-on-web /etc/nginx/sites-enabled/mate-on-web
nginx -t && nginx -s reload
```

Adjust `server_name`, `root` and `fastcgi_pass` to your system, and, if the project is not served under `/mate-on-web/`, the two `location` blocks that name that prefix.

**One server block per host :** if the same host already serves Staunton, nginx accepts only one `server` block for it. Merge instead : copy the two `/mate-on-web/` locations and `client_max_body_size` into Staunton's block, and add this entry to its `map $uri $staunton_csp` block, before `default`, so that the fetch() of `puzzle.php` is allowed on these pages only :

```nginx
    ~^/mate-on-web/ "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
```

### About the content security policy

- `script-src 'self'` : the page contains no inline script and no `on...=` handler; the buttons are wired in `app.js`.
- `connect-src 'self'` : `app.js` fetches `puzzle.php` on the same origin. Staunton's policy has no such directive, since it only submits forms : the two policies are not interchangeable.
- `style-src-attr 'unsafe-inline'` : chessboard.js sizes the squares with `style` attributes, and `index.php` uses a few `style="display: none"` attributes. It belongs to CSP level 3 (Chrome 75, Firefox 108, Safari 15.4 at least) : an older browser falls back on `style-src 'self'`, and the board is then displayed without dimensions.
- Browser extensions that inject their own scripts or styles are refused, and the console says so : that is the policy at work, not an error of the page.

## 7. Rate limiting

Nothing in the code limits the request rate : `puzzle.php` costs well under a millisecond, but a free loop still occupies a PHP worker. Proportionate measures for a hobby server :

- **Apache :** `mod_evasive` (`DOSPageCount`, `DOSPageInterval`, raise `DOSSiteCount` for users behind the same NAT) or `mod_qos` on the directory; `LimitRequestBody` is already in the shipped file; keep `mod_reqtimeout` (Debian's default) against slow requests; a modest `MaxRequestWorkers` or `pm.max_children` so that a flood degrades the service instead of swapping the host.
- **nginx :** `limit_req_zone $binary_remote_addr zone=mateonweb:1m rate=10r/s;` in the `http` block, then `limit_req zone=mateonweb burst=20 nodelay;` in the PHP location; `client_max_body_size` is already in the shipped file.
- **fail2ban :** the stock `apache-badbots`, `apache-noscript` and `apache-overflows` jails, or a small jail on the access log counting `POST /mate-on-web/puzzle.php` per address.
- **Error log :** keep `display_errors = Off` (Debian's production default) and let `logrotate` cap the size of the virtual host's logs.

## 8. Checking the configuration

From any machine, with the address of the page :

```
# Refused paths: 403 expected on each (404 for a file that does not exist)
for p in .git/config venv/pyvenv.cfg download_puzzles.sh extract.py requirements.txt mat1.csv mat1.count; do
    printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://example.org/mate-on-web/$p"
done

# Headers: each of the three must be sent exactly once (3 expected)
curl -sI https://example.org/mate-on-web/ | grep -ciE '^(x-frame-options|referrer-policy|content-security-policy):'

# Content security policy, nosniff, no server version
curl -sI https://example.org/mate-on-web/ | grep -iE '^(content-security-policy|x-content-type-options|server):'

# Oversized body refused before it is read (413 expected)
head -c 5000 /dev/zero | tr '\0' a | curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' --data-binary @- https://example.org/mate-on-web/puzzle.php
```

Then open the page in a browser with the developer tools : the whole game (level, puzzle, move, promotion, solution, new puzzle) must run without a single CSP violation.

## 9. Supported versions

**PHP :** a release still in security support (8.3 or later at the time of writing); the code itself runs on 8.0 and later. Tested with PHP 8.3 and 8.4.

**Python :** 3.9 or later with the `venv` module (`python3-venv` on Debian), `chess` as pinned in `requirements.txt`.

**Web servers :** the shipped files were checked with `apache2ctl configtest` (Apache 2.4) and `nginx -t` (nginx 1.24).
