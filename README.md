# Fire Logistics

**Fire Logistics** est un jeu de simulation et de gestion de crise centré sur la lutte contre les incendies de forêt. Le joueur incarne un **Commandant des Opérations de Secours** chargé de lire le terrain, anticiper la propagation du feu, engager des moyens limités et protéger les enjeux humains, industriels et naturels.

Le projet démarre dans `C:\Users\andre\Desktop\firelogistics`. Ce dépôt existe déjà, avec un README minimal remplacé par ce document. L'archive locale `OSO_20230101_RASTER.tar.gz` est présente dans le dossier projet et doit rester une donnée source locale non versionnée.

Ce README est le document de cadrage initial et suit le premier scaffold du projet. Le dépôt contient désormais un projet Godot/.NET minimal, un Core C# testable, une WebView MapLibre de bootstrap, une scène Godot 3D placeholder et les scripts de vérification de base. Il ne contient pas encore d'API feu, de format binaire végétation définitif ni de système complet d'incendie.

## Vision

Le coeur du jeu n'est pas d'éteindre des points de vie abstraits, mais de contrôler une menace dynamique. Le feu doit être lisible comme un phénomène spatial : il avance avec le vent, accélère dans les pentes, contourne les zones traitées, saute parfois les obstacles et force le joueur à choisir ce qu'il sauve en priorité.

La satisfaction recherchée vient de décisions tactiques sous contrainte :

- ralentir un flanc pour protéger un village ;
- sacrifier une zone forestière pour tenir une ligne de route ;
- envoyer les bons véhicules au bon endroit avant que le front ne devienne intenable ;
- maintenir une surveillance sur les braises pour éviter une reprise ;
- organiser les rotations d'eau, de carburant et d'équipes fatiguées.

Le jeu vise une simulation crédible mais jouable. La priorité est la clarté tactique, la performance et la robustesse, pas une modélisation scientifique exhaustive de la thermodynamique.

## Boucle de gameplay

Une intervention suit une boucle organique :

1. **Détection** : un départ de feu apparaît, avec localisation, intensité initiale et incertitude éventuelle.
2. **Analyse** : le joueur lit la végétation, les routes, les points d'eau, le vent, les bâtiments et la topographie.
3. **Dispatch** : les moyens sont envoyés depuis les casernes ou renforts disponibles.
4. **Approche** : les unités utilisent le réseau routier, puis éventuellement un déplacement hors-route limité.
5. **Intervention** : attaque directe, protection de bâtiments, attaque indirecte, largage d'eau ou retardant.
6. **Confinement** : création ou exploitation de lignes d'arrêt, pare-feux, routes, zones brûlées ou surfaces incombustibles.
7. **Noyage** : traitement des braises et sécurisation des lisières.
8. **Redéploiement** : retour au ravitaillement, remplacement des équipes fatiguées et préparation du prochain foyer.

Le succès peut être partiel. Éteindre vite un feu naissant est une victoire totale ; sur un grand sinistre, gagner signifie souvent préserver les enjeux prioritaires avec des ressources insuffisantes.

## MVP recommandé

Le premier prototype jouable doit rester volontairement étroit :

- carte France ou zone pilote locale ;
- simulation de feu par **automate cellulaire 2D** ;
- grille raster avec voisinage de Moore, une cellule représentant une zone de terrain ;
- terrain initialement plat pour le MVP ;
- vent global avec direction et intensité ;
- combustibles simples : forêt, herbe, urbain fragile, eau/route/incombustible ;
- véhicules CCF individuels se déplaçant sur le graphe routier existant ;
- extinction locale quand un véhicule est adjacent ou proche d'une cellule enflammée ;
- victoire si aucune flamme active ne reste avant destruction des bâtiments prioritaires.

Ce MVP doit valider la boucle feu -> dispatch -> arrivée -> attaque -> extinction avant d'ajouter topographie, GIFF automatisés, avions, bulldozers, spotting ou météo avancée.

## Simulation d'incendie cible

La simulation cible repose sur un automate cellulaire performant en C# :

| État | Rôle gameplay |
| --- | --- |
| Non brûlé | Combustible intact, peut s'enflammer selon chaleur, vent et type de terrain. |
| Sec / à risque | Cellule préchauffée ou vulnérable, probabilité d'ignition augmentée. |
| Feu faible | Début ou fin de combustion, facile à traiter par attaque directe. |
| Feu actif | Front principal, propage fortement la chaleur aux voisins. |
| Feu intense | Tête de feu accélérée par vent ou pente, dangereuse pour les unités. |
| Braises | Zone sans flammes vives mais susceptible de reprise. |
| Brûlé / éteint | Zone consommée, utilisée comme barrière naturelle au feu. |

La probabilité d'ignition doit rester configurable et compréhensible. Elle peut combiner :

- inflammabilité du combustible ;
- influence du vent dans la direction de propagation ;
- pente locale, lorsque le relief sera intégré ;
- humidité ou traitement préventif ;
- résistance particulière des routes, eaux, bâtiments et zones déjà brûlées.

Les futures actions du joueur modifieront directement cette grille : eau, retardant, pare-feu, protection de façade, noyage ou interdiction de passage.

## Unités et doctrine

Le jeu s'inspire de la doctrine française feux de forêt, en simplifiant les contraintes pour rester jouable.

| Unité | Rôle |
| --- | --- |
| VLHR | Reconnaissance, levée de doute, commandement léger. |
| CCF | Pivot du MVP, attaque directe ou indirecte en milieu naturel. |
| CCGC | Ravitaillement massif en eau, lent et dépendant des routes. |
| FPT | Protection urbaine et interfaces forêt-habitat. |
| Équipe au sol | Traitement fin, noyage, accès aux zones difficiles. |
| Bulldozer | Création de pare-feux par suppression du combustible. |
| HBE | Largage précis, rotations vers points d'eau proches. |
| ABE | Frappe massive ou retardant sur tête de feu, ressource rare. |

À terme, le joueur doit pouvoir engager des **GIFF** plutôt que microgérer chaque camion. Un GIFF pourrait gérer automatiquement son positionnement local le long d'une lisière, pendant que le joueur décide de la mission et de la priorité.

## Architecture technique cible

Fire Logistics garde les mêmes technologies principales que LogisticBuilder, avec une couche 3D native plus importante.

| Composant | Technologie cible | Rôle |
| --- | --- | --- |
| Moteur | Godot 4.6.2 .NET | Runtime natif PC, scène 3D, orchestration, export. |
| Langage simulation | C# / .NET 8 | Simulation feu, unités, routage, état de jeu. |
| Core métier | `FireLogistics.Core` | Code pur testable sans Godot. |
| Carte stratégique | MapLibre GL JS dans WebView WRY | Carte France, couches data, diagnostics, HUD stratégique. |
| 3D | Godot 3D natif | Terrain, véhicules, flammes, fumée, effets d'eau, lecture locale. |
| Données carte | OSM, PMTiles, graphe routier binaire | Routes, villes, eau, bâtiments, dispatch. |
| Végétation | THEIA OSO 2023 Raster, 10 m | Occupation du sol et combustibles. |
| Pipeline data | Python + Node.js | Inspection, conversion, chunking, diagnostics. |
| Tests | xUnit + node:test + scripts smoke Godot | Régression Core, WebView, rendu et lancement. |

Principe d'architecture : Godot reste un adaptateur et un renderer. Les règles métier doivent vivre dans `FireLogistics.Core`, pour être testables en headless, réutilisables et robustes.

## Rôle de la 3D

La 3D doit être portée par **Godot natif**, pas par la WebView. La WebView reste excellente pour la carte stratégique, les couches MapLibre et les panneaux de gestion ; Godot doit afficher les éléments qui demandent présence, volume et lisibilité immédiate :

- terrain local autour de l'incident ;
- véhicules et groupes d'intervention ;
- flammes, fumée, braises et zones noircies ;
- largages aériens, jets d'eau et retardant ;
- relief simplifié et obstacles tactiques ;
- caméra de crise permettant d'inspecter une zone à risque.

Le MVP peut démarrer avec une carte 2D MapLibre et une scène 3D simple. La 3D doit ensuite devenir la vue tactique locale, synchronisée depuis l'état de simulation C#.

## Données géographiques

Les données doivent rester locales, chunkées et chargées à la demande.

### Sources prévues

- **OpenStreetMap / PMTiles** : carte vectorielle, routes, eau, bâtiments, lieux.
- **Graphe routier LogisticBuilder LBRG v3** : base à reprendre pour dispatch et temps de trajet.
- **THEIA OSO 2023 Raster** : occupation du sol France métropolitaine à environ 10 m.
- **Hydrants / points d'eau** : futurs points de ravitaillement.
- **Casernes / bases aériennes** : points de départ des unités.
- **Relief** : futur MNT pour pente et accessibilité.

### Règles OSO

L'archive `OSO_20230101_RASTER.tar.gz` ne doit pas être commitée. Le pipeline devra :

- préserver la résolution native 10 m ;
- utiliser du nearest-neighbour pour toute donnée catégorielle ;
- inspecter projection, NoData, type de pixels et nomenclature avant mapping ;
- ne jamais charger toute la France en mémoire ;
- produire des chunks locaux compressés et versionnés ;
- garder la classe OSO originale afin de pouvoir changer le mapping combustible sans reconstruire toute la source.

Les dossiers de données lourdes à ignorer par Git devront inclure au minimum :

```text
/OSO_20230101_RASTER.tar.gz
/.cache/vegetation/
/data-sources/vegetation/
/assets/web/data/vegetation/
```

## Réutilisation depuis LogisticBuilder

Les éléments suivants sont pertinents à reprendre ou adapter :

- structure Godot 4.6.2 .NET avec projet C# principal ;
- séparation entre nœuds Godot et Core métier testable ;
- `LocalWebServer` pour servir `assets/web` localement à la WebView ;
- intégration WebView WRY et pont IPC C# <-> JavaScript ;
- MapLibre GL JS, styles PMTiles et organisation `assets/web`;
- graphe routier chunké LBRG v3 et pathfinding C# ;
- frames binaires Base64 pour données fréquentes vers la WebView ;
- scripts `setup.bat`, `test.bat`, `run.bat`, `export.bat` ;
- tests xUnit pour le Core et `node:test` pour les helpers Web ;
- logique de smoke test Godot headless ;
- conventions de données locales hors Git dans `assets/web/data`.

Les éléments à ne pas reprendre tels quels :

- économie nationale, marchés départementaux et commodities ;
- `NationalMarketService`, MAPI, production et graphes de commodities ;
- UI de production, Sankey, onglets entreprise/bâtiments/flotte orientés business ;
- pipelines bâtiments industriels/commerce sauf pour inspiration technique ;
- logique de vente B2C et hubs commerciaux.

## Modules prévus

Ces modules décrivent l'intention architecturale. Ils ne sont pas encore des contrats figés.

```text
FireLogistics/
├── README.md
├── setup.bat / test.bat / run.bat / export.bat
├── project.godot
├── src/
│   ├── Main.cs
│   ├── GameState.cs
│   ├── network/
│   └── FireLogistics.Core/
│       ├── Fire/                 # automate cellulaire, états, propagation
│       ├── Response/             # unités, GIFF, ordres, eau, fatigue
│       ├── Logistics/            # graphe routier, ETA, dispatch
│       ├── World/
│       │   └── Vegetation/       # OSO, chunks, combustibles, fenêtres 10 m
│       ├── Bridge/               # payloads WebView, frames binaires, DTO
│       └── Infrastructure/       # serveur local, chemins runtime, JSON
├── assets/
│   └── web/                      # MapLibre, HUD, diagnostic layers
├── tools/
│   └── vegetation-builder/       # inspection et build OSO
├── tests/
│   ├── FireLogistics.Core.Tests/
│   └── web/
└── docs/
```

## Interfaces prévues

Le README documente seulement les interfaces futures :

- loader de végétation OSO par chunks ;
- requête de classe OSO ou profil combustible à une longitude/latitude ;
- chargement d'une fenêtre combustible 10 m autour d'un incident ;
- pont C# vers WebView pour couches MapLibre et diagnostics ;
- synchronisation de l'état de simulation vers la scène Godot 3D ;
- frames binaires pour données fréquentes, afin d'éviter des JSON massifs par tick.

Le premier format binaire végétation pourra s'inspirer du format proposé `.lbvg`, mais il devra être validé par tests avant d'être considéré stable.

## Commandes disponibles

Ces commandes existent dans le scaffold initial.

```powershell
.\setup.bat
```

Prépare les dépendances, les dossiers locaux et les données minimales disponibles. Le traitement national OSO ne doit jamais être lancé implicitement par un setup normal.

```powershell
.\test.bat
```

Lance la régression : build C#, tests Core, tests Web, puis smoke test Godot headless si l'exécutable est disponible.

```powershell
.\run
.\run --headless
.\run --headless --quit-after 1
```

Lance le jeu en fenêtre ou en headless. Le mode multi-instance/co-op n'est pas encore implémenté dans Fire Logistics.

```powershell
.\export.bat windows
.\export.bat winmac --zip
```

Construit les exports joueurs portables, en copiant `assets/web` à côté de l'exécutable.

Note : l'export est encore un scaffold. La copie post-export complète de `assets/web` et la validation des templates restent à durcir.

### Pipeline végétation prévu

```powershell
python tools/vegetation-builder/inspect_oso.py --input OSO_20230101_RASTER.tar.gz
```

Inspecte l'archive OSO, détecte les rasters, la projection, la résolution, le NoData, les classes et la nomenclature.

```powershell
python tools/vegetation-builder/build_vegetation.py `
  --input OSO_20230101_RASTER.tar.gz `
  --output assets/web/data/vegetation `
  --bbox <lon_min> <lat_min> <lon_max> <lat_max>
```

Construit d'abord une zone pilote, sans charger la France entière.

```powershell
python tools/vegetation-builder/build_vegetation.py `
  --input OSO_20230101_RASTER.tar.gz `
  --output assets/web/data/vegetation `
  --full-france
```

La génération nationale ne doit être testée qu'après validation du pipeline synthétique, de la zone pilote, du loader C# et des tests.

## Roadmap

### Phase 0 - Cadrage et scaffold

- README complet du projet. Fait.
- Inventaire des composants LogisticBuilder à reprendre. Fait.
- Décision : Godot 3D natif pour le rendu tactique local. Fait.
- Règles de gestion des données lourdes. Fait.
- Projet Godot/.NET minimal, Core, WebView et tests bootstrap. Fait.
- Fond de carte France PMTiles repris de LogisticBuilder dans `assets/web/data/france-openmaptiles.pmtiles`. Fait.
- Fond monde terre/eau repris de LogisticBuilder dans `assets/web/data/world-backdrop.geojson`. Fait.
- Couche combustible permanente France entière dérivée des classes PMTiles (`wood`, `farmland`, `grass`, `scrub`, `water`, `landuse`). Fait.

### Phase 1 - Bootstrap technique approfondi

- Durcir l'export joueur et la copie `assets/web`.
- Ajouter une vraie structure d'état de jeu dans `FireLogistics.Core`.
- Préparer le pont binaire C# -> WebView pour les futures couches feu/unités.
- Ajouter une première scène 3D tactique contrôlée par état Core.
- Ajouter les prochaines couches carte France : casernes, points d'eau, incidents, météo et périmètres opérationnels.
- Préparer le futur multi-instance seulement après stabilisation solo.

### Phase 2 - Données végétation

- Inspecter `OSO_20230101_RASTER.tar.gz`.
- Construire un pipeline OSO reproductible.
- Générer une zone pilote chunkée à 10 m.
- Lire les chunks depuis C# sans charger toute la France.
- Afficher une couche MapLibre de diagnostic.

### Phase 3 - Simulation feu MVP

- Implémenter l'automate cellulaire 2D.
- Ajouter vent global, combustibles simples et états de combustion.
- Générer un incident test.
- Connecter les unités CCF à l'extinction locale.
- Tester la victoire/défaite sur scénario court.

### Phase 4 - Dispatch et logistique opérationnelle

- Adapter le graphe routier LBRG v3.
- Ajouter casernes, points d'eau et temps d'arrivée.
- Gérer capacité d'eau, ravitaillement et indisponibilité.
- Ajouter ordres d'attaque, protection, noyage et redéploiement.

### Phase 5 - 3D tactique

- Créer une scène Godot 3D locale.
- Visualiser terrain, véhicules, feu, fumée et zones brûlées.
- Synchroniser la scène depuis l'état Core.
- Ajouter lisibilité des vents, lignes d'arrêt et risques immédiats.

### Phase 6 - Profondeur gameplay

- GIFF automatisés.
- Topographie et accessibilité hors-route.
- HBE, ABE, bulldozers, équipes au sol.
- Reprises de feu, fatigue, météo, scénarios et progression.

## Critères d'acceptation initiaux

Le projet initial sera considéré correctement cadré quand :

- le README décrit clairement la vision Fire Logistics ;
- les technologies sont alignées avec LogisticBuilder ;
- la 3D est cadrée comme un rendu Godot natif ;
- la WebView MapLibre conserve son rôle de carte stratégique et HUD ;
- la réutilisation LogisticBuilder est concrète et limitée aux bons composants ;
- les données OSO sont identifiées comme locales, lourdes et non versionnées ;
- les fonctionnalités futures ne sont pas présentées comme déjà implémentées ;
- un autre développeur peut comprendre l'ordre de construction du prototype.

## Notes de développement

- Garder le code métier dans `FireLogistics.Core`.
- Garder les nœuds Godot comme adaptateurs fins.
- Tester toute règle métier nouvelle avec xUnit.
- Éviter les JSON massifs pour les flux fréquents ; préférer des payloads binaires versionnés.
- Ne pas inventer la nomenclature OSO : elle doit être extraite des métadonnées réelles.
- Ne pas convertir les données catégorielles avec interpolation bilinéaire ou cubique.
- Ne pas lancer de traitement national lourd sans commande explicite.
- Le jeu doit démarrer même si les données OSO ne sont pas disponibles, avec un avertissement clair et la couche végétation désactivée.

## Relief 3D sous budget 50 Go

Le relief 3D utilise une stratégie multi-source pour rester sous un budget strict de **50 Go de téléchargement**.

Choix initial :

- **France entière** : BD ALTI 25 m en priorité, ou RGE ALTI 5 m seulement si le poids réel des paquets reste sous budget après inspection.
- **Zones tactiques** : RGE ALTI 1 m uniquement sur zones pilotes à fort intérêt incendie, par exemple Bouches-du-Rhône, Var, Alpes-Maritimes ou Corse.
- **LiDAR HD / 50 cm** : source trop lourde pour la France entière, réservée à des comparaisons ou à de très petites zones.

Le rendu Godot applique une exagération verticale de `1.8x` par défaut, avec une limite prévue à `2.5x` pour améliorer la lisibilité. Les altitudes source restent stockées en mètres réels ; l'exagération ne touche que le mesh affiché.

La cartographie MapLibre utilise maintenant aussi un relief local :

- source DEM `raster-dem` locale `assets/web/data/terrain-dem/tilejson.json`;
- terrain MapLibre actif avec exagération `2.2x`;
- couche `terrain-hillshade` placée au-dessus des combustibles et sous les routes/bâtiments.

Les tuiles actuelles sont générées depuis **BD ALTI 25 m France métropolitaine** téléchargé localement dans `data-sources/terrain/`. Sur cette machine, le téléchargement du COG de 1,30 Go a pris environ 2 min 34 s et la génération propre du zoom 8 a pris environ 2 min 38 s.

Le DEM local est volontairement limité au zoom 8 pour éviter l'ancien artefact de grand rectangle visible aux bas zooms. Les pixels hors emprise BD ALTI sont encodés à `0 m`, afin de garder la mer plate.

Fichiers ajoutés :

```text
tools/terrain-builder/inspect_sources.py
tools/terrain-builder/write_demo_chunk.py
tools/terrain-builder/README.md
assets/terrain/index.json
assets/terrain/chunks/demo/marseille-demo.flht
```

Inspection des paquets avant téléchargement :

```powershell
python tools/terrain-builder/inspect_sources.py --max-download-gb 50
python tools/terrain-builder/inspect_sources.py --dataset bd_alti --skip-datagouv-services --max-download-gb 50
python tools/terrain-builder/inspect_sources.py --dataset rge_alti --keyword 13 --max-download-gb 50
```

Le script ne télécharge rien. Il lit les métadonnées data.gouv, additionne les tailles connues et signale les ressources dont la taille n'est pas publiée. Les ressources à taille inconnue ne doivent pas être lancées en batch sans validation manuelle.

Premier paquet recommandé identifié par l'API officielle Géoplateforme :

```text
BD ALTI 25 m COG France métropolitaine
URL : https://data.geopf.fr/telechargement/download/archive_BDALTI_COG/archive/MNT_FRANCE-BDALTI_25M_L93_lzw.COG.TIF
Poids annoncé : 1,30 Go
```

Génération locale utilisée :

```powershell
node tools/terrain-builder/build_bdalti_terrarium_tiles.mjs `
  --input data-sources/terrain/MNT_FRANCE-BDALTI_25M_L93_lzw.COG.TIF `
  --output assets/web/data/terrain-dem `
  --min-zoom 8 `
  --max-zoom 8
```

Le runtime ne dépend plus de la source DEM en ligne utilisée temporairement au prototype.

Le format de chunk `.flht` est volontairement minimal et versionné :

- en-tête `FLHT`, version `1`;
- largeur, hauteur, taille de cellule, origine locale;
- altitude min/max;
- tableau `float32` des altitudes en mètres source.

Le chunk présent dans `assets/terrain/chunks/demo/` est un relief procédural de validation. Il n'est pas une donnée IGN. Les futurs chunks IGN lourds iront dans `assets/terrain/chunks/ign/`, `national/` ou `pilot/`, qui sont exclus de Git.

## Statut

Scaffold initial implémenté. Le dépôt compile, les tests Core/Web bootstrap passent, Godot démarre en headless avec une scène 3D terrain heightfield, et la WebView charge le style France PMTiles local avec fond monde et couche combustible permanente. Les systèmes de feu, végétation OSO fine, relief IGN réel, routage opérationnel, unités et gameplay restent à implémenter.
