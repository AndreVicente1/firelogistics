# Terrain Builder

Outils preparatoires pour le relief 3D de Fire Logistics.

Objectif initial:

- rester sous un budget de telechargement strict de 50 Go;
- privilegier un MNT France entiere leger pour la vue large;
- ajouter du MNT 1 m uniquement sur des zones pilotes incendie;
- produire des chunks `.flht` charges par Godot sans modifier les altitudes source.

## Inspection sans telechargement

```powershell
python tools/terrain-builder/inspect_sources.py --max-download-gb 50
```

La commande interroge les fiches data.gouv connues:

- BD ALTI, adaptee au relief national leger;
- RGE ALTI, candidat 5 m / 1 m selon les paquets disponibles;
- MNT LiDAR HD, trop lourd pour la France entiere mais utile pour comparer les zones pilotes.

Elle n'effectue aucun telechargement. Les ressources sans taille publiee sont marquees comme inconnues et ne doivent pas etre lancees en batch sans verification manuelle.

## Relief MapLibre local

Le runtime carto lit le relief ici :

```text
assets/web/data/terrain-dem/tilejson.json
assets/web/data/terrain-dem/{z}/{x}/{y}.png
```

La source actuelle est BD ALTI 25 m France metropolitaine en COG local :

```powershell
node tools/terrain-builder/build_bdalti_terrarium_tiles.mjs `
  --input data-sources/terrain/MNT_FRANCE-BDALTI_25M_L93_lzw.COG.TIF `
  --output assets/web/data/terrain-dem `
  --min-zoom 8 `
  --max-zoom 8
```

Generation propre actuelle :

- telechargement COG 1,30 Go : environ 2 min 34 s;
- generation Terrarium zoom 8 : environ 2 min 38 s;
- sortie generee : 138 tuiles, environ 5 Mo;
- pixels hors raster BD ALTI : altitude 0 m pour eviter le relief en mer;
- pas de bas zoom DEM pour eviter le grand rectangle d'emprise.

Le script `generate_local_dem_tiles.py` reste seulement un bootstrap synthetique si le COG BD ALTI n'est pas encore present.

## Format de chunk

Les chunks `.flht` sont des heightfields binaires little-endian:

```text
magic               4 bytes   "FLHT"
version             uint16    1
flags               uint16    0
width               int32
height              int32
cell_size_meters    float32
origin_x_meters     float32
origin_z_meters     float32
elevation_scale     float32
min_elevation       float32
max_elevation       float32
elevations          float32[width * height]
```

Les altitudes restent en metres source. L'exageration verticale est definie dans `assets/terrain/index.json` et appliquee uniquement au rendu Godot.

## Demo locale

Le depot contient un petit chunk de demonstration genere proceduralement. Il sert a valider le rendu 3D avant les vrais telechargements IGN.
