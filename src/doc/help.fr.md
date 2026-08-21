# Local Check — Guide utilisateur

**Local Check** est un outil d'analyse post-vol destiné aux pilotes de planeur et aux clubs de vol à voile. Il rejoue un fichier IGC en le confrontant à une base de zones d'atterrissage et vérifie que le pilote est resté à portée de plané d'un aérodrome ou d'un champ vachable pendant tout le vol.

---

## À propos

- **Auteur :** [ACPH - Aéroclub Pierre Herbaud](https://aeroclub-issoire.fr/)
- **Code source :** [github.com/tfraudet/local-check](https://github.com/tfraudet/local-check)
- **Licence :** MIT

---

## Démarrage rapide

1. Ouvrez le panneau **Vol** depuis la barre latérale gauche (icône avion).
2. Glissez-déposez un fichier `.IGC`, ou cliquez pour parcourir et en sélectionner un.
3. Une fois analysés, la trace du vol, le barogramme et les zones d'atterrissage apparaissent automatiquement.
4. Utilisez les **contrôles de rejeu** en bas pour rejouer le vol et inspecter l'analyse de sécurité.

---

## Aperçu de l'interface

L'application s'organise autour d'une barre latérale gauche permanente et de trois zones de visualisation principales.

### Barre latérale

La navigation icônes-seulement à gauche est toujours visible :

- **Avion** — Charger et gérer le vol courant
- **Réglages** — Configurer les paramètres d'analyse et les sources de données
- **Info** — Ouvrir cette documentation d'aide
- **FR/EN** — Changer de langue
- **Soleil / Lune** — Basculer entre thème clair et sombre

Cliquer sur une icône déploie un panneau contextuel à côté de la barre latérale.

### Disposition principale

- **Carte** (partie haute) — Trace du vol, zones d'atterrissage, trajectoire de dégagement et zone atteignable
- **Barogramme** (partie basse)
  - Droite : **Profil de la trajectoire de dégagement** — profil du terrain et plan de vol vers la meilleure zone atteignable
  - Gauche : **Barogramme** — altitude en fonction du temps, synchronisé avec le curseur de la carte
- **Contrôles de rejeu** — Barre temporelle, lecture/pause, sélecteur de vitesse et affichage de l'heure

---

## Panneau Vol

Une fois un vol chargé, le panneau Vol affiche :

- Nom du pilote, type de planeur, date du vol
- Durée, distance totale, altitude minimale et maximale
- Vitesse sol maximale
- Nom du fichier source et statut de validation

---

## Contrôles de rejeu

- **Lecture / Pause** — Démarrer ou mettre en pause le rejeu
- **Pas en avant / arrière** — Avancer d'un échantillon à la fois
- **Réinitialiser** — Revenir au début du vol
- **Vitesse** — De **1x** à **32x**
- **Barre temporelle** — Cliquer ou glisser pour sauter à un instant précis

### Raccourcis clavier

| Touche | Action |
|--------|--------|
| `Espace` | Lecture / Pause |
| `Flèche gauche` | Pas en arrière |
| `Flèche droite` | Pas en avant |
| `Début` | Retour au début |

---

## Analyse Du Local

Le panneau **Local Statistiques** classe le vol par rapport à vos paramètres de sécurité :

- **Toujours dans le local** (vert) — Le vol est toujours resté à portée de plané sûre
- **Marginal** (jaune) — Les marges sont passées sous le seuil de sécurité à un moment donné
- **Hors local** (rouge) — Le pilote est sorti de la zone de plané sûre au moins une fois

Métriques affichées :

- **Temps hors local** — Durée et pourcentage du vol passé hors zone sûre
- **Hauteur manquante min** — Plus petit déficit pour atteindre une zone d'atterrissage
- **Hauteur manquante max** — Plus grand déficit enregistré
- **Nombre de sorties** — Combien d'épisodes hors local distincts se sont produits
- **Aller à la première sortie** — Cliquer pour positionner le rejeu au premier instant hors local

### Coloration de la trace

La trace sur la carte est colorée selon la phase et le statut de sécurité :

- Montée initiale
- Moteur en marche (ENL au-dessus du seuil)
- Dans le local
- Marginal
- Hors local
- Arrivée finale (si la détection est activée)

---

## Trajectoire de dégagement & zone atteignable

### Trajectoire de dégagement

Une ligne pointillée reliant la position de rejeu courante à la zone d'atterrissage offrant la **hauteur d'arrivée projetée la plus élevée** au-dessus du sol. Elle se met à jour en continu pendant le rejeu et est colorée selon le statut (dans le local / marginal / hors local).

Par défaut, la trajectoire est tracée en **ligne droite**. Lorsque le **Routage tenant compte du relief** est activé dans les Réglages, la trajectoire contourne les crêtes qui bloqueraient le plan direct (voir *Routage tenant compte du relief* ci-dessous).

Lorsque le routage est désactivé, le plan en ligne droite peut heurter le relief avant d'atteindre la zone d'atterrissage — cela apparaît sur le graphique de profil mais ne modifie **pas** la couleur du statut, qui repose uniquement sur la hauteur d'arrivée projetée comparée à la hauteur d'arrivée de sécurité. Activez le routage tenant compte du relief pour obtenir une trajectoire qui passe effectivement au-dessus du terrain.

Le graphique **Profil de la trajectoire de dégagement** (à droite du barogramme) montre :

- L'élévation du terrain le long de la trajectoire de dégagement
- Le plan de vol depuis la position actuelle
- Le repère d'arrivée sur la zone d'atterrissage cible
- La ligne cible d'arrivée sécurisée

### Zone atteignable

Une superposition verte translucide représentant la zone atteignable depuis la position actuelle, compte tenu de la finesse définie dans ```Paramètres``` et du terrain sous-jacent. Configurable via :

- **Taille de grille** — 90 / 180 / 360 / 720 m (plus petit = plus détaillé, plus lent)
- **Diamètre** — 10 à 60 km autour de la position courante

Une annotation s'affiche si la résolution demandée dépasse le nombre maximum de cellules supporté.

Lorsque le **Routage tenant compte du relief** est désactivé, les cellules dont le plan direct heurte le terrain sont exclues — la zone s'arrête au pied de la crête la plus proche. Activé, la zone atteignable s'étend dans les vallées derrière les crêtes partout où un plan de vol détourné reste réalisable.

### Étiquettes de hauteur d'arrivée

Lorsqu'elle est activée, chaque zone d'atterrissage visible affiche une pastille indiquant la hauteur d'arrivée projetée depuis la position actuelle, colorée automatiquement selon le statut de sécurité. Ces hauteurs utilisent la distance détournée quand le **Routage tenant compte du relief** est actif, si bien qu'une zone située derrière une crête n'affiche plus une hauteur trop optimiste issue d'un calcul en ligne droite.

### Routage tenant compte du relief

Désactivé par défaut. Lorsqu'il est activé depuis les Réglages, Local Check cherche une trajectoire contournant les crêtes plutôt que de rejeter une zone d'atterrissage située derrière un obstacle. Le coût en altitude du détour est intégré au calcul de plané, garantissant une estimation exacte de la zone atteignable, du dégagement et des hauteurs d'arrivée.

Sous le capot :

- **Trajectoire de dégagement, étiquettes de hauteur d'arrivée, sélection de la meilleure zone dans le local** — recherche **Theta\*** (A\* à angle libre sur la grille d'élévation) par requête. La visibilité s'appuie sur la même primitive de garde au relief que la vérification en ligne droite : le plan de vol doit rester au-dessus du terrain + garde au sol tout le long du segment détourné.
- **Zone atteignable** — un seul balayage **Dijkstra** depuis la position pilote marque chaque cellule de la grille avec sa distance détournée minimale en une passe ; exécuter un Theta\* par cellule serait beaucoup trop lent.

Compromis :

- Le routage est coûteux en CPU et introduit une latence visible sur le panneau de dégagement et sur la zone atteignable, en particulier sur de grands vols ou avec une grille fine.
- Une hauteur d'arrivée détournée est toujours ≤ à celle en ligne droite. En terrain plat, le routage dégénère en ligne droite et les valeurs sont identiques.
- **Court-circuit ligne droite** : dès que le vol plané direct depuis la position courante passe déjà au-dessus du terrain + garde au sol tout le long du segment, Theta\* n'est pas exécuté et la ligne droite est retournée — un détour ne peut jamais faire mieux (il est plus long, donc sa hauteur d'arrivée serait inférieure). Conséquence : le libellé du profil de dégagement peut basculer entre *Vol plané direct* et *Vol plané détourné* pendant le rejeu même avec le routage activé : quand vous êtes assez haut pour franchir une crête en direct, il affiche *Vol plané direct* ; quand vous descendez sous ce seuil et qu'un contournement devient nécessaire, il passe à *Vol plané détourné*. Le libellé reflète la géométrie du moment, pas l'état du switch.
- **Borne de portée** : aucune route ne peut dépasser `(altitude courante − altitude du terrain) × finesse de travail`, puisque le planeur doit encore arriver au niveau du terrain ou au-dessus. La recherche est bornée par ce budget : un terrain hors d'atteinte derrière une crête est écarté immédiatement au lieu de l'être après un balayage exhaustif.
- **Aucune route faisable → ligne droite** : quand le relief ne laisse aucun détour valide, le routage ne retourne rien et le panneau revient au profil en ligne droite, libellé *Vol plané direct*. C'est volontaire : le graphique montre alors le plan de plané traversant le terrain, ce qui est la réponse honnête, plutôt qu'un *Vol plané détourné* dont la trajectoire percute la roche.
- Laissez l'option désactivée pour les vols en plaine ; activez-la pour le vol en montagne où une ligne droite couperait une crête alors qu'un détour par une vallée ou un col est en pratique réalisable.

---

## Réglages

Tous les réglages sont conservés dans votre navigateur (localStorage).

### Paramètres principaux

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| **Finesse** | 20 | Finesse utilisée pour le calcul du local |
| **Hauteur d'arrivée de sécurité** | 300 m | Hauteur minimale au-dessus de la zone d'atterrissage à l'arrivée |
| **Garde au sol** | 150 m | Hauteur minimale au-dessus du terrain le long du plan. Conditionne la garde en route (routage et zone atteignable), pas la classification d'arrivée |
| **Détecter l'arrivée finale** | On | Détecter et marquer automatiquement l'arrivée finale |
| **Routage tenant compte du relief** | Off | Contourne les crêtes pour la trajectoire de dégagement, les hauteurs d'arrivée et la zone atteignable au lieu d'un simple calcul en ligne droite. Plus lent — laisser désactivé en plaine (voir *Routage tenant compte du relief* ci-dessus) |
| **Pas de temps** | 20 s | Intervalle d'échantillonnage pour le local check (min 1 s) |
| **Seuil ENL** | 500 | Niveau sonore moteur au-dessus duquel le moteur est considéré en marche |
| **Recalibrer l'altitude sur le QNH local** | Off | Corriger l'altitude pression brute du fichier IGC vers le QNH du jour en s'appuyant sur l'altitude terrain au décollage |
| **Source d'élévation du terrain** | AWS Terrain | Backend DEM utilisé pour construire la grille d'élévation — AWS Terrain (~25 m DTM en Europe, CDN rapide) ou Microsoft Planetary Computer (~30 m DSM, canopée/bâti inclus, plus lent) |

#### Recalibrer l'altitude sur le QNH local

L'altitude pression IGC est enregistrée par rapport à la pression atmosphérique standard (1013,25 hPa), et non par rapport au QNH du jour ; les altitudes affichées et l'AGL peuvent donc être décalés de plusieurs dizaines de mètres. Lorsque cette option est activée, Local Check :

1. Calcule la moyenne de l'altitude barométrique des ~8 premiers points stationnaires consécutifs (vitesse sol inférieure à 10 km/h) avant le décollage.
2. Échantillonne l'élévation du terrain à la même position.
3. Calcule un décalage (`terrain − moyenne baro`) et l'applique à toutes les altitudes pression du vol — barogramme, télémétrie, AGL, classification local-check, trajectoire de dégagement et zone atteignable reflètent tous la valeur corrigée.

Le décalage calculé est affiché sous l'interrupteur (par ex. `+42,3 m`). Si moins de 5 points valides avant décollage sont disponibles, ou si la position de décollage tombe hors grille d'élévation, la correction est désactivée et un avertissement s'affiche ; les points IGC bruts restent toujours la source de vérité.

### Bases de zones d'atterrissage

Activer ou désactiver les bases de champs vachables utilisées pour l'analyse :

- **Champs vachables des Alpes**
- **Champs vachables d'Auvergne (ACPH)**

Les zones d'atterrissage sont marquées sur la carte avec un niveau de difficulté sur une échelle à quatre couleurs.

### Options d'affichage

- **Afficher la trajectoire de dégagement** — Montrer ou cacher la trajectoire pointillée
- **Afficher la zone atteignable** — Montrer ou cacher la surface atteignable en plané
- **Afficher les hauteurs d'arrivée sur les zones** — Montrer ou cacher les pastilles de hauteur d'arrivée

### Réinitialisation

**Réinitialiser aux valeurs par défaut** restaure tous les paramètres à leur valeur initiale.

---

## Thème

Utilisez le bouton **soleil / lune** en bas de la barre latérale pour basculer entre thème clair et sombre. Votre choix est mémorisé entre les sessions.

### Raccourcis clavier

| Touche | Action |
|--------|--------|
| `d` | Alterner entre thème sombre et clair |

---

## Langue

Utilisez le bouton **FR / EN** de la barre latérale pour basculer l'interface entre le français et l'anglais. Le libellé du bouton indique toujours la langue vers laquelle vous allez basculer (par exemple, `EN` quand l'interface est actuellement en français). Le changement s'applique immédiatement à tous les panneaux — infobulles de la barre latérale, panneaux Vol et Réglages, contrôles de rejeu et cette documentation d'aide — et votre choix est mémorisé entre les sessions.

---

## Sources de données & logique de chargement

Quand vous chargez un fichier IGC, Local Check l'analyse puis récupère en parallèle trois jeux de données externes, tous indexés sur la boîte englobante du vol. La progression de chacun apparaît dans la boîte de dialogue de chargement. Les données OpenAIP sont mises en cache localement (24 h) ; les données d'élévation sont re-téléchargées à chaque import.

### 1. Élévation du terrain (DEM)

Une grille régulière des hauteurs de terrain est téléchargée pour la boîte englobante du vol (élargie d'environ 20 km). Cette grille alimente le calcul de l'AGL, les profils de terrain, la garde au plan de vol, l'analyse de la zone atteignable et la recalibration QNH.

> **⏱ À noter :** le chargement des données d'élévation est l'une des étapes les plus lentes sur un nouveau vol. La durée dépend de la taille de la zone couverte, du backend choisi et des conditions réseau. La boîte de dialogue affiche la progression et le reste de l'application demeure réactif pendant ce temps.

La source d'élévation se choisit dans le **panneau Paramètres** et est mémorisée par utilisateur.

#### Source par défaut : AWS Terrain Tiles

Local Check récupère le DEM depuis **[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)** (tuiles PNG Terrarium d'AWS Open Data), servies via CloudFront. Aucune clé API n'est requise.

Stratégie de chargement :

1. Choisir un niveau de zoom Web Mercator dont la taille de pixel native est au plus égale au pas cible (~30 m) à la latitude de la bbox.
2. Énumérer les tuiles XYZ chevauchant la bbox à ce zoom.
3. Télécharger les tuiles en parallèle depuis le CDN et décoder PNG → RGBA via `createImageBitmap` + `OffscreenCanvas`.
4. Assembler les élévations décodées dans une grille de sortie unique (EPSG:4326, pas régulier lat/lon) en appliquant la formule Terrarium `(R × 256 + G + B / 256) − 32768` mètres par pixel.

Des caches internes à la session (pixels décodés + requêtes en vol) court-circuitent les rechargements. Les URLs des tuiles sont immuables, donc le cache HTTP du navigateur prend le relais entre rechargements de page.

Sources sous-jacentes selon la région (mosaïque) :

- **EU-DEM v1.1** (~25 m, **DTM**) — sur l'Europe
- **3DEP / NED** (~10 m) — sur les USA
- **SRTM v3** (~30 m) — mondial, ±60° de latitude
- **GMTED2010** (~250 m) — comblement ailleurs

La sortie est plafonnée à ~2 millions d'échantillons ; quand la requête dépasse ce budget, la résolution est dégradée par étapes ×2 successives jusqu'à tenir dans le budget.

#### DSM vs DTM

Les modèles numériques d'élévation existent en deux grandes variantes :

- **DTM (Digital Terrain Model)** — élévation « sol nu ». La végétation, les bâtiments et les autres éléments de surface sont retirés pour ne représenter que le sol.
- **DSM (Digital Surface Model)** — élévation « toit ». Le modèle capture ce que le capteur voit d'en haut, y compris canopées, bâtiments et autres structures.

AWS Terrain Tiles sert un **DTM** sur l'Europe (EU-DEM). C'est l'option la plus rapide et largement suffisante pour la plupart des vols. **Compromis :** pour l'analyse de posabilité et de plané, la hauteur qui menace réellement le planeur est celle du sommet de ce qui se dresse au sol (canopée, bâtiments), pas le niveau théorique du sol nu quelques mètres plus bas — sur terrain densément boisé, un DTM est donc légèrement moins conservateur qu'un DSM. Si ce compromis est gênant, bascule sur le backend DSM ci-dessous depuis le panneau Paramètres.

#### Backend alternatif : Microsoft Planetary Computer (DSM)

La source d'élévation peut être basculée depuis le **panneau Paramètres** vers le **[Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/)** — le catalogue open-data géospatial de Microsoft exposant des jeux de données d'observation de la Terre à l'échelle pétaoctet sous forme de Cloud-Optimised GeoTIFFs (COGs) via une API STAC publique. Aucune clé API n'est requise.

- Sert **Copernicus DEM GLO-30** (collection STAC `cop-dem-glo-30`) — **DSM** WorldDEM mondial ~30 m issu du radar interférométrique TanDEM-X (ESA / Airbus). Hauteurs au-dessus du géoïde EGM2008.
- Stratégie de chargement : recherche STAC des tuiles 1° × 1° chevauchant la bbox, signature de chaque URL d'asset via `/api/sas/v1/sign`, puis lecture des pixels utiles uniquement via les requêtes de plages d'octets de `geotiff.js`.
- Généralement plus lent au chargement qu'AWS Terrain (aller-retour STAC + signature, pas de cache CDN), mais un DSM est plus sûr pour l'AGL et la garde au plan de vol sur terrain boisé ou urbanisé.

### 2. Aérodromes (OpenAIP)

Les aérodromes sont récupérés depuis **OpenAIP** pour compléter les bases de champs vachables avec les pistes reconnues à l'échelle mondiale.

- Plutôt que d'interroger l'API REST OpenAIP à chaque changement de vue, Local Check télécharge les exports JSON par pays sur `https://storage.openaip.net/openaip-system-exports/<cc>_apt.json`.
- Les pays traversés sont détectés hors ligne à partir de la trace du vol via un jeu de polygones-pays 10 km (`@geo-maps/countries-land-10km`), échantillonné à ~30 points sur la trace. On obtient une petite liste de codes pays ISO alpha-2 (par ex. `fr`, `it`, `ch`).
- Les charges par pays sont **mises en cache dans `localStorage` pendant 24 h** — recharger un vol dans le même pays évite complètement le réseau.
- Seuls les types d'aérodromes pertinents sont conservés : aérodromes civils, sites vélivoles, aérodromes (civils / IFR), sites ULM, terrains d'aviation et altiports. Héliports, terrains militaires uniquement, terrains fermés, hydroaérodromes et pistes agricoles sont écartés d'emblée.
- Les aérodromes chargés sont ensuite filtrés à la boîte englobante du vol (élargie de ~60 km) avant d'être fusionnés dans le catalogue des zones d'atterrissage.

### 3. Bases de champs vachables

Deux bases vélivoles peuvent être activées depuis le panneau Réglages. Chacune est téléchargée la première fois que son interrupteur est activé (pas nécessairement au démarrage) et conservée en mémoire pour le reste de la session — les cycles activation/désactivation ultérieurs ne rechargent pas. Si les deux interrupteurs restent éteints, aucune donnée vachable n'est téléchargée.

| Source | Région | URL | Format |
|--------|--------|-----|--------|
| **Champs vachables des Alpes** | Alpes françaises / italiennes / suisses | `planeur-net.github.io/outlanding/guide_aires_securite.cup` | Fichier `.cup` SeeYou |
| **Champs vachables d'Auvergne (ACPH)** | Auvergne (France) | `aeroclub-issoire.fr/…/outlanding-fields-db.json` | JSON |

Les deux sont analysés côté client et convertis dans le format commun `LandingZone` avec position, altitude, orientation de l'axe principal quand disponible, et un niveau de difficulté codé par couleur.

**OpenAIP prime sur les bases vachables.** OpenAIP étant la source canonique des aérodromes, toute entrée vachable Alpes ou Auvergne située à moins de **400 m** d'une zone OpenAIP est écartée lors de l'assemblage de la liste active — cela évite qu'une entrée `.cup` d'aérodrome n'occulte l'enregistrement OpenAIP correspondant avec une position, un nom ou une altitude légèrement différents.

À l'analyse, chaque source est également nettoyée de ses propres doublons internes : deux entrées à moins de 250 m dans la même base sont fusionnées (un fichier source peut par exemple lister les deux seuils de piste ou deux points proches pour le même terrain). Les aérodromes et les entrées portant une difficulté explicite sont privilégiés aux points de virage sans étiquette lors de la fusion.

#### Niveaux de difficulté

Chaque champ vachable porte une note de difficulté sur une **échelle simplifiée à quatre couleurs**, du plus sûr au plus dur :

| Niveau | Signification |
|--------|---------------|
| 🟢 **Vert** | Aérodrome ou champ facile à poser |
| 🟠 **Orange** | Moyen — demande de l'attention |
| 🔴 **Rouge** | Difficile — pilotes expérimentés uniquement |
| ⚫ **Noir** | Très difficile — champ de dernier recours |

##### Alpes : conversion étiquette → niveau

La base Alpes `.cup` utilise les étiquettes vachables alpines intégrées à la description de chaque point (`{A}`, `{F}`, `{E}`, `{ZA}`, `{LA}`, `{M}`, `{D}`, `{TD}`, `{VD}`). Local Check les fait correspondre à l'échelle 4 couleurs comme suit :

| Étiquette alpine | Signification | Niveau |
|------------------|---------------|--------|
| `A` | Aérodrome | 🟢 Vert |
| `F` / `E` | Facile | 🟢 Vert |
| `ZA` / `LA` | Groupe de champs | 🟢 Vert |
| *(sans étiquette)* | Point non tagué | 🟢 Vert |
| `M` | Moyen | 🟠 Orange |
| `D` | Difficile | 🔴 Rouge |
| `TD` / `VD` | Très difficile | ⚫ Noir |

##### Auvergne

Le JSON ACPH Auvergne embarque déjà un champ de difficulté explicite : aucune traduction d'étiquette n'est nécessaire — le niveau est lu directement dans la source.

##### Aérodromes OpenAIP

Chaque aérodrome OpenAIP est traité comme un aérodrome et associé au niveau 🟢 **Vert**.

Activer ou désactiver une source dans le panneau Réglages ajoute ou retire les zones correspondantes de la carte et du calcul du local check, sans re-télécharger.

### 4. Orchestration du chargement

Quand vous chargez un fichier IGC, voici ce qui se passe en arrière-plan :

1. La trace du vol est analysée et le résumé (pilote, planeur, durée, distance…) devient disponible.
2. L'élévation du terrain et la liste des aérodromes OpenAIP pour les pays traversés sont récupérés en parallèle autour de la zone du vol.
3. L'analyse de sécurité (local check) s'exécute automatiquement dès que le vol, le terrain et au moins une zone d'atterrissage sont prêts.

Les bases de champs vachables sont indépendantes du chargement : elles sont téléchargées la première fois que vous activez leur interrupteur puis conservées pour le reste de la session.

La boîte de dialogue de chargement affiche la progression de chaque étape et se ferme d'elle-même une fois que tout est prêt. Modifier un réglage en cours de session (recalibration QNH, activation ou désactivation d'une source) rafraîchit l'analyse mais ne re-télécharge jamais les données — seul le chargement d'un nouveau vol le fait.

---

## Notes & astuces

- Les zones d'atterrissage sont recherchées uniquement dans les bases configurées — veillez à activer les régions pertinentes.
- Réduire la taille de grille de la zone atteignable augmente fortement le coût de calcul ; commencez par 360 m et affinez au besoin.
- Le paramètre Garde au sol n'influe pas sur la classification du local check (seule la hauteur d'arrivée la détermine), mais il conditionne bien la garde au relief **en route** : le plan de plané doit rester au-dessus du terrain + garde au sol sur chaque segment détourné et sur chaque rayon de la zone atteignable. L'augmenter réduit la zone atteignable et rend les détours plus difficiles à trouver.
- Les données d'élévation sont chargées à la demande ; la boîte de dialogue indique la progression pour l'élévation, la base des zones d'atterrissage et le calcul du local check.
- Les données OpenAIP par pays sont mises en cache côté client dans `localStorage` (24 h) — vider le stockage du navigateur force une nouvelle récupération au prochain chargement. Les données d'élévation sont re-téléchargées à chaque import.
- Des statistiques d'usage anonymes et sans cookies peuvent être collectées via [Umami](https://umami.is) (aucune donnée personnelle, aucun contenu de vol, aucun cookie) afin que le club puisse voir quelles fonctionnalités sont réellement utilisées.

---

## Crédits

Local Check a été inspiré par **[VerifLocal](https://condorutill.fr/index_fr.php)**, l'application desktop bien connue et largement utilisée par la communauté vélivole française pour l'analyse post-vol du local — notamment adoptée par la **FFVP** (Fédération Française de Vol en Planeur).

L'objectif de ce projet est de proposer une alternative **100 % web** :

- Fonctionne directement dans le navigateur — **aucune installation locale** requise.
- Fonctionne sous **macOS et Linux** aussi bien que sous Windows, tandis que VerifLocal est une application desktop Windows-only.
- Accessible instantanément depuis n'importe quel appareil disposant d'un navigateur, sans droits administrateur ni installation.

Merci à l'auteur de VerifLocal d'avoir défriché le concept — cette version web vise simplement à rendre le même type d'analyse accessible à un public plus large, quel que soit le système.
