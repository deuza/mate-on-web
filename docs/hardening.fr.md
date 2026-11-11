# Mate On Web : notes de durcissement

[English](hardening.md) | **Français**

> Ce document est la traduction française de [hardening.md](hardening.md), qui fait référence en cas de divergence.

Ce document détaille les mesures de sécurité intégrées à Mate On Web, ainsi que la configuration du serveur web qui les complète. Le [README](../README.fr.md) couvre l'installation et l'utilisation courante.

1. [Principes](#1-principes)
2. [Points d'entrée](#2-points-dentrée)
3. [Données des problèmes](#3-données-des-problèmes)
4. [Chaîne de génération](#4-chaîne-de-génération)
5. [Dépendances côté navigateur](#5-dépendances-côté-navigateur)
6. [Configuration du serveur web](#6-configuration-du-serveur-web)
7. [Limitation du débit](#7-limitation-du-débit)
8. [Vérifier la configuration](#8-vérifier-la-configuration)
9. [Versions prises en charge](#9-versions-prises-en-charge)

---

## 1. Principes

- **Rien n'est stocké :** aucune session, aucune base de données, aucun fichier écrit par les pages web. `index.php` et `puzzle.php` se contentent de lire les fichiers de problèmes ; les statistiques de session vivent dans la mémoire du navigateur.
- **Listes d'autorisation en sortie :** les fichiers de problèmes sont générés à partir de données téléchargées. Tout ce que `puzzle.php` envoie au navigateur est d'abord confronté à la forme attendue (voir la section 3), afin qu'un fichier corrompu ou malveillant ne puisse jamais placer dans la page autre chose qu'une position, une liste de coups et une adresse Lichess.
- **Aucun script intégré à la page (inline) :** la page attache ses gestionnaires d'événements dans `app.js`, afin qu'une politique de sécurité du contenu (CSP) stricte puisse s'appliquer (section 6).
- **Défense en profondeur :** les protections qui dépendent du serveur web (section 6) sont doublées par le code quand c'est possible, et inversement.

## 2. Points d'entrée

- `index.php` ne lit aucun paramètre de requête. Il liste les fichiers de problèmes et leur nombre de lignes (`matN.count`, recompté uniquement si le fichier de décompte manque ou s'il est plus ancien que son CSV), et ajoute à l'adresse de `style.css`, `chess.js` et `app.js` leur date de modification, pour qu'un navigateur ne garde pas une version précédente après une mise à jour.
- `puzzle.php` n'accepte que la méthode POST, avec un corps JSON. Toute autre méthode reçoit un 405 accompagné de `Allow: POST`.
- **Taille du corps :** une requête valide fait une douzaine d'octets (`{"level":1}`). Un `Content-Length` déclaré au-delà de 1024 octets est refusé par un 413 avant toute lecture, et la lecture elle-même est plafonnée à 1024 octets : `post_max_size` ne borne pas `php://input` (PHP se contente de journaliser un avertissement et le flux reste lisible), et un corps transmis par morceaux (chunked) n'a pas de `Content-Length`. Le serveur web ajoute sa propre limite (section 6).
- **Niveau :** converti en entier, il doit être compris entre 1 et 5 ; le nom du fichier est construit à partir de cet entier uniquement.
- **Lectures :** le tirage aléatoire se positionne à un décalage aléatoire et lit au plus deux lignes, chacune bornée à 4096 octets. Une ligne trop longue (les lignes font environ 150 octets) est servie sous forme de fragment, que la validation ci-dessous rejette par un 500.

## 3. Données des problèmes

Les champs du CSV proviennent de la base de problèmes de Lichess, via `extract.py`. Avant qu'ils ne quittent le serveur :

- **FEN :** doit correspondre aux six champs écrits par python-chess : `[pnbrqkPNBRQK1-8/]+ [wb] (-|[KQkq]+) (-|[a-h][36]) \d+ \d+`.
- **Solution :** uniquement des coups UCI, `[a-h][1-8][a-h][1-8][qrbn]?`, séparés par un seul espace.
- **URL :** doit commencer par `https://lichess.org/`, sinon le lien est rendu inerte (`#`). `app.js` applique la même règle avant d'écrire le `href`, et le lien porte `rel="noopener noreferrer"`.
- **Ouverture :** toujours écrite via `textContent`, jamais sous forme de HTML.
- **Encodage :** un octet qui n'est pas de l'UTF-8 est remplacé (`JSON_INVALID_UTF8_SUBSTITUTE`) au lieu de faire échouer `json_encode()` en silence ; si l'encodage échoue malgré tout, la réponse est un 500, et non un 200 vide.

La solution est envoyée au navigateur volontairement : les coups sont vérifiés dans le navigateur, il n'y a ni score, ni compte, ni classement, et la page du problème sur Lichess est publique.

## 4. Chaîne de génération

`download_puzzles.sh` et `extract.py` récupèrent et transforment le dump (l'export) de la base Lichess. Ils s'exécutent en dehors des pages web, à la main ou depuis une tâche planifiée.

- **Lancez-les avec un utilisateur non privilégié, depuis un répertoire où le serveur web ne peut pas écrire.** Par simplicité, le README clone le projet dans la racine des documents du serveur web ; le dump, le venv et les scripts sont alors refusés par la configuration du serveur web (section 6), mais ils restent à côté des fichiers servis. Un répertoire dédié (`/var/lib/mate-on-web` par exemple) pour le clone, le venv et le dump constitue une organisation plus propre : le répertoire web ne contient alors que les fichiers de l'application (`index.php`, `puzzle.php`, `app.js`, `chess.js`, `style.css`, `favicon.ico` et `vendor/`), et `matN.csv` et `matN.count` y sont copiés après chaque génération, avec `cp -p` pour que chaque décompte reste aussi récent que son CSV (un décompte plus ancien que son CSV est ignoré). `puzzle.php` lit les fichiers CSV par un chemin relatif : ils doivent donc rester à côté des fichiers PHP.
- **Dépendance épinglée :** `requirements.txt` fixe `chess` (le nom actuel de python-chess) à une version et à son empreinte SHA-256 ; `pip install --require-hashes -r requirements.txt` refuse tout le reste. Pour passer à une nouvelle version : relevez sa nouvelle empreinte sur sa page de publication sur PyPI, mettez le fichier à jour, faites tourner la chaîne sur une copie et vérifiez le résultat.
- **Remplacement atomique :** chaque `matN.csv` est écrit à part (`.tmp`) puis mis en place une fois complet ; les problèmes précédents restent servis entre-temps, et une extraction qui échoue laisse intact le fichier en place. Le nombre de lignes est écrit avant le remplacement, si bien que `index.php` n'a jamais à recompter les lignes.
- **Interpréteur :** le `python3` du venv est appelé explicitement avec `-I`, qui ignore les variables d'environnement `PYTHON*` et retire le répertoire courant de `sys.path` : un `chess.py` égaré à côté du script ne pourrait pas remplacer la bibliothèque.
- **Analyse tolérante :** une ligne inutilisable (l'en-tête, une ligne vide, tronquée ou sans coups, ou une position que python-chess rejette) est ignorée, au lieu d'interrompre l'extraction en laissant un fichier partiel ; `--verbose` indique le nombre de lignes vides, tronquées et sans coups, ainsi que chaque position rejetée. Les octets qui ne sont pas de l'UTF-8 sont remplacés.
- **Scripts :** tous deux sont exécutables dans git (`100755`), puisque le README les appelle directement.

## 5. Dépendances côté navigateur

- jQuery, chessboard.js, chess.js et les douze images des pièces sont servis par le projet lui-même : aucun hôte tiers n'est contacté pendant l'exécution de la page. La page ne pointe vers l'extérieur qu'à quatre endroits : la page Lichess du problème, ouverte dans un nouvel onglet avec `rel="noopener noreferrer"`, et les trois liens du pied de page (auteur, licence, dépôt), qui s'ouvrent dans le même onglet. Avec la politique `no-referrer` de la section 6, aucun d'eux ne transmet l'adresse de la page.
- `vendor/SHA256SUMS` liste l'empreinte de chaque fichier tiers (`chess.js` à la racine compris). Après toute mise à jour, vérifiez les nouveaux fichiers par un autre moyen (le contrôle d'intégrité propre au registre npm, dans `npm pack`), puis régénérez la liste :

  ```
  cd vendor && sha256sum ../chess.js *.js *.css img/chesspieces/wikipedia/*.png > SHA256SUMS
  ```

  et vérifiez une installation avec `(cd vendor && sha256sum -c SHA256SUMS)`.

## 6. Configuration du serveur web

Le code se protège lui-même, mais certaines protections ne peuvent venir que du serveur web : elles n'existent pas sans sa configuration. **Cette configuration n'est donc pas facultative**, et elle doit être appliquée avant d'ouvrir la page à d'autres. Sans elle, les réglages par défaut de Debian pour `/var/www` servent `.git/`, `venv/`, les scripts et les fichiers de problèmes (des dizaines de mégaoctets chacun) avec le listage des répertoires, et n'envoient aucun en-tête de sécurité.

| Protection                                        | Dans le code                                         | Dans la configuration du serveur                |
|---------------------------------------------------|------------------------------------------------------|-------------------------------------------------|
| Fichiers de problèmes, dump et scripts non servis | aucune                                               | `Require all denied` sur leurs extensions       |
| `venv/` non servi                                 | aucune                                               | `Require all denied`                            |
| `.git` illisible                                  | aucune                                               | refusé sur tout le serveur                      |
| Pas de listage des répertoires                    | aucune                                               | `Options -Indexes`, `autoindex off`             |
| Corps de requête de `puzzle.php` borné            | 413 au-delà de 1024 octets, lecture plafonnée        | `LimitRequestBody 4096`, `client_max_body_size` |
| En-têtes de durcissement                          | aucune                                               | `nosniff`, `DENY`, `no-referrer`                |
| Politique de sécurité du contenu                  | aucun script inline, pour qu'elle puisse s'appliquer | une seule politique pour tout le répertoire     |
| Version du serveur masquée                        | aucune                                               | `ServerTokens Prod`, `server_tokens off`        |

La configuration est livrée avec le projet, prête à installer : [`docs/apache2/mate-on-web.conf`](apache2/mate-on-web.conf) et [`docs/nginx/mate-on-web.conf`](nginx/mate-on-web.conf).

### Apache

Depuis la racine du projet, avec PHP via `libapache2-mod-php` ou `php-fpm` :

```
cp docs/apache2/mate-on-web.conf /etc/apache2/conf-available/mate-on-web.conf
a2enmod headers
a2enconf mate-on-web
apache2ctl configtest && systemctl reload apache2
```

- **L'ordre compte :** `Header` est une directive de mod_headers ; sans ce module, `configtest` s'arrête sur `Invalid command 'Header'`. Pour revenir en arrière en cours de route : `a2disconf mate-on-web`.
- **Les chemins :** le fichier attend le projet dans `/var/www/html/mate-on-web` ; adaptez ses deux chemins `<Directory>` s'il se trouve ailleurs.
- **`.git` est refusé sur tout le serveur**, pour chaque clone situé sous les racines des documents. Le même `<DirectoryMatch>` est livré avec Staunton : le doublon est sans conséquence.
- **En-têtes définis ailleurs :** le fichier définit ses en-têtes avec `Header always set`. Un `Header set` (sans `always`) visant le même en-tête dans l'hôte virtuel ou dans `security.conf` n'est pas remplacé : Apache envoie alors les deux valeurs. Vérifiez que chaque en-tête n'est envoyé qu'une fois (section 8).

#### Identité du serveur

Dans `/etc/apache2/conf-available/security.conf` : `ServerTokens Prod` et `ServerSignature Off`, puis `apache2ctl configtest && systemctl reload apache2`.

#### HTTPS

Servez le site en HTTPS. HSTS (`Strict-Transport-Security`) relève de l'hôte virtuel, et non de ce fichier : il engage tout le site.

### nginx

Configuration avec PHP-FPM, équivalente à celle d'Apache. Sous Debian :

```
cp docs/nginx/mate-on-web.conf /etc/nginx/sites-available/mate-on-web
ln -s /etc/nginx/sites-available/mate-on-web /etc/nginx/sites-enabled/mate-on-web
nginx -t && nginx -s reload
```

Adaptez `server_name`, `root` et `fastcgi_pass` à votre système, ainsi que, si le projet n'est pas servi sous `/mate-on-web/`, les deux blocs `location` qui citent ce préfixe.

**Un seul bloc server par hôte :** si le même hôte sert déjà Staunton, nginx n'accepte qu'un seul bloc `server` pour lui. Fusionnez plutôt : copiez les deux locations `/mate-on-web/` et `client_max_body_size` dans le bloc de Staunton, et ajoutez cette entrée à son bloc `map $uri $staunton_csp`, avant `default`, afin que le fetch() de `puzzle.php` soit autorisé sur ces pages seulement :

```nginx
    ~^/mate-on-web/ "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
```

### À propos de la politique de sécurité du contenu

- `script-src 'self'` : la page ne contient aucun script inline ni aucun gestionnaire `on...=` ; les boutons sont reliés dans `app.js`.
- `connect-src 'self'` : `app.js` interroge `puzzle.php` sur la même origine. La politique de Staunton n'a pas cette directive, puisqu'elle se contente de soumettre des formulaires : les deux politiques ne sont pas interchangeables.
- `style-src-attr 'unsafe-inline'` : chessboard.js dimensionne les cases avec des attributs `style`, et `index.php` utilise quelques attributs `style="display: none"`. Cette directive relève de CSP niveau 3 (au minimum Chrome 75, Firefox 108, Safari 15.4) : un navigateur plus ancien se rabat sur `style-src 'self'`, et l'échiquier s'affiche alors sans dimensions.
- Les extensions de navigateur qui injectent leurs propres scripts ou styles sont refusées, et la console le signale : c'est la politique qui fait son travail, pas une erreur de la page.

## 7. Limitation du débit

Rien dans le code ne limite le débit des requêtes : `puzzle.php` coûte bien moins d'une milliseconde, mais une boucle sans frein occupe tout de même un processus PHP. Mesures proportionnées pour un serveur de loisir :

- **Apache :** `mod_evasive` (`DOSPageCount`, `DOSPageInterval`, et augmentez `DOSSiteCount` pour les utilisateurs derrière un même NAT) ou `mod_qos` sur le répertoire ; `LimitRequestBody` figure déjà dans le fichier livré ; conservez `mod_reqtimeout` (actif par défaut sous Debian) contre les requêtes lentes ; un `MaxRequestWorkers` ou un `pm.max_children` modeste, pour qu'un afflux dégrade le service au lieu de faire swapper la machine.
- **nginx :** `limit_req_zone $binary_remote_addr zone=mateonweb:1m rate=10r/s;` dans le bloc `http`, puis `limit_req zone=mateonweb burst=20 nodelay;` dans la location PHP ; `client_max_body_size` figure déjà dans le fichier livré.
- **fail2ban :** les jails fournies d'origine `apache-badbots`, `apache-noscript` et `apache-overflows`, ou une petite jail sur le journal d'accès qui compte les `POST /mate-on-web/puzzle.php` par adresse.
- **Journal d'erreurs :** conservez `display_errors = Off` (valeur de production par défaut sous Debian) et laissez `logrotate` plafonner la taille des journaux de l'hôte virtuel.

## 8. Vérifier la configuration

Depuis n'importe quelle machine, avec l'adresse de la page :

```
# Chemins refusés : 403 attendu sur chacun (404 pour un fichier inexistant)
for p in .git/config venv/pyvenv.cfg download_puzzles.sh extract.py requirements.txt mat1.csv mat1.count; do
    printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://example.org/mate-on-web/$p"
done

# En-têtes : chacun des trois doit être envoyé exactement une fois (3 attendu)
curl -sI https://example.org/mate-on-web/ | grep -ciE '^(x-frame-options|referrer-policy|content-security-policy):'

# Politique de sécurité du contenu, nosniff, aucune version du serveur
curl -sI https://example.org/mate-on-web/ | grep -iE '^(content-security-policy|x-content-type-options|server):'

# Corps trop gros refusé avant toute lecture (413 attendu)
head -c 5000 /dev/zero | tr '\0' a | curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' --data-binary @- https://example.org/mate-on-web/puzzle.php
```

Ouvrez ensuite la page dans un navigateur avec les outils de développement : toute la partie (choix du niveau, niveau mystère, problème, coup, promotion, solution, Retry, nouveau problème) doit se dérouler sans une seule violation de CSP.

## 9. Versions prises en charge

**PHP :** une version encore couverte par le support de sécurité (voir les [versions de PHP supportées](https://www.php.net/supported-versions.php)) ; le code lui-même fonctionne à partir de 8.0. Testé avec PHP 8.3 et 8.4.

**Python :** 3.9 ou ultérieure, de préférence une version encore couverte par le support de sécurité (voir l'[état des versions de Python](https://devguide.python.org/versions/)), avec le module `venv` (`python3-venv` sous Debian), et `chess` tel qu'épinglé dans `requirements.txt`.

**Serveurs web :** les fichiers livrés ont été vérifiés avec `apache2ctl configtest` (Apache 2.4) et `nginx -t` (nginx 1.24).
