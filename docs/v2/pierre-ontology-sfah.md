# Pierre: Foundational Culinary Ontology & Transformation Architecture

**Grounded in:** Samin Nosrat, *Salt, Fat, Acid, Heat* (SFAH)

**Target System:** Harvey's — Pierre Layer (`src/brain/ingredients.js`, `src/brain/pierre-raw.js`, future Foundation-only Swift `MarcoCore`)

**Diet Scope:** Vegetarian + Eggs (Indian & everyday home kitchen staples)

**Separation of Concerns:** This document defines **culinary physics and classification** (what an ingredient is, what a technique physically does to it, what constitutes a sauce vs. a sautéed vegetable, and whether a dish is balanced). It does **not** price cooking effort or time (that is Marco's job) and does **not** invent personal preference weights (those come from the owner's ratings and benchmark).

## 0. Why Pierre Currently Misclassifies Dishes

Right now, Pierre treats a dish as a **flat bag of `(food, technique)` vectors**. That representation cannot distinguish between:

* `tomato @ sautéed` (hot, blistered, discrete solid pieces) and **tomato sauce** (broken-down pectin + reduced tomato water + emulsified fat = a cohesive liquid coating).

* `oats (raw) + tomato (raw)` (inedible uncooked grain + salad veg) and **masala oats** (hydrated, gelatinized starch simmered in seasoned liquid + aromatics).

* `butter` used as a **cooking medium** (sautéing paneer), a **binder/emulsion** (swirled into starchy pasta water), or a **seasoning** (spread cold on toast).

To fix this, Pierre needs a **5-layer culinary model** derived directly from *Salt, Fat, Acid, Heat*:

1. **Matter Ontology:** What each ingredient is chemically (`water`, `fat`, `starch`, `sugar`, `protein`, `cellulose_pectin`) and what **physical phase** it currently occupies.

2. **The Four Elements as Operators:** `Salt`, `Fat`, `Acid`, and `Heat` are not just static taste tags—they are **operators with specific roles, media, and chemical constraints**.

3. **The Transformation Matrix:** A deterministic state machine mapping `(FoodClass, CurrentPhase) × Method -> (OutputPhase, ChemicalEffects, TextureDelta, FlavorDelta)`.

4. **Composite Entities ("What Makes What"):** Exact structural definitions for intermediate culinary objects (`AromaticBase`, `Sauce`, `Emulsion`, `Mash`, `Batter`, `Dressing`, `Tadka`).

5. **Balance & Diagnostic Engine:** Samin's exact diagnostic hierarchy (`Salt/Fat/Acid` $\to$ `Umami` $\to$ `Texture Contrast` $\to$ `Aromatics/Freshness`) plus chemical vetoes.

## 1. Layer 1: Matter Ontology (Ingredients & Physical Phases)

Every food in the kitchen is composed of four elemental building blocks (SFAH p. 102, 207): **water**, **fat**, **carbohydrates** (starches, sugars, cellulose, pectin), and **protein**. How a food reacts to heat, salt, fat, and acid depends on which building blocks dominate it.

### 1.1 Molecular Food Classes (`foodClass`)

Replace ad-hoc food groupings with **8 deterministic molecular classes** (every food in `pierre-raw.js` maps to one primary class):

| `foodClass` | Dominant Chemistry | Behavior Under Heat, Salt & Acid (SFAH) | Harvey's Examples | 
| ----- | ----- | ----- | ----- | 
| `dry_starch_seed` | Starch + tough cellulose shell, very low water | **Inedible raw.** Requires water + gentle heat (simmer/boil/pressure) to hydrate & gelatinize into `tender`/`creamy`. Salt early to soften pectin; **never add acid before tender** (acid toughens skins). | `rice`, `pasta`, `oats`, `poha`, `chickpeas` (dry), `moong_dal`, `toor_dal`, `rajma`, `kala_chana`, `soya_chunks` | 
| `hydrated_starch` | Gelatinized starch + water | Ready to eat or receive a second heat layer (toast/fry/sauté) to evaporate surface water and trigger Maillard browning/crispness. Releases surface starch to emulsify sauces. | `bread`, `roti`, `potato` (boiled), `chickpeas` (boiled), `rice` (cooked), `pasta` (cooked) | 
| `watery_veg_fruit` | High water + pectin/cellulose + simple sugars | Releases water rapidly when salted (osmosis) or heated. Produces steam (blocking browning unless spaced out and heated intensely). Breaks down into liquid/jam when simmered; blisters when sautéed. | `tomato`, `onion`, `capsicum`, `cucumber`, `cabbage`, `mushroom`, `carrot`, `apple`, `mango`, `banana` | 
| `dense_protein_dairy` | Coagulated casein/protein + fat + moderate water | Does not melt; browns via Maillard in hot fat or dry air (`crisp` crust, `chewy`/`tender` inside). Gentle heat preserves moisture; harsh dry/microwave heat squeezes water out. | `paneer`, `cheese_slices` *(meltable sub-flag)*, `mozzarella` *(meltable)* | 
| `delicate_protein` | Uncoiled protein strands in water | Coagulates rapidly at low heat ($\sim 63\text{--}80^\circ\text{C}$). **Gentle heat** keeps tender/creamy; **intense or microwave heat** squeezes water out $\to$ rubbery/dry. Salt + tiny acid help tenderize. | `eggs` | 
| `protein_powder_flour` | Milled protein or starch, zero water | **Not a standalone dish.** Must be hydrated into a `liquid_suspension` (shake) or `batter` (pancake/chilla) and then set with heat. | `whey`, `besan`, `suji` | 
| `pure_or_emulsified_fat` | Lipids (+ water/milk solids in dairy) | Pure fats (`oil`, `ghee`) withstand high heat ($>175\text{--}200^\circ\text{C}$) for browning/crispness. Emulsified fats (`butter`, `cream`, `curd`, `peanut_butter`) break if overheated; `curd`/`milk` curdle if boiled with acid. | `oil`, `ghee`, `butter`, `cream`, `curd`, `hung_curd`, `milk`, `peanut_butter`, `almonds`, `peanuts`, `walnuts`, `cashews` | 
| `aromatic_herb_acid` | Volatile aromatic oils, organic acids, capsaicin | Fat-soluble aromatics (`garlic`, `chilli`, spices) **must bloom in warm fat** to unlock flavor; burn quickly at high heat. Fresh herbs & citrus (`coriander`, `lemon`) lose brightness under heat—**garnish late**. | `garlic`, `green_chilli`, `coriander`, `lemon`, `spices`, `salt`, `soy_sauce` | 

### 1.2 Physical Phases (`phase`)

A food's identity is incomplete without its **physical phase**. Pierre must track `phase` because dish forms (like a pasta or a sandwich) accept specific *phases*, not just ingredient IDs.

| `phase` | Definition | Can Coat a Base? | Can Anchor a Plate? | Examples | 
| ----- | ----- | ----- | ----- | ----- | 
| `raw_inedible` | Unhydrated dry grain/legume, raw egg, dry powder | No | No | raw `pasta`, raw `eggs`, dry `oats`, dry `whey` | 
| `raw_edible` | Ready to eat cold/as-is, intact cell walls | No | Only in cold forms | raw `tomato`, raw `onion`, `bread`, `paneer`, `banana` | 
| `discrete_cooked` | Heated, retains distinct solid pieces (blistered, seared, boiled whole, toasted) | **No** | Yes | `tomato@sauteed`, `paneer@pan_fried`, `bread@toasted`, `eggs@boiled` | 
| `paste_mash` | Cell walls mechanically or thermally broken into thick, spreadable/scoopable mass | Partially (spread) | Yes (as mash) | `chickpeas@mashed`, `potato@mashed`, `peanut_butter`, `pesto` | 
| `cohesive_sauce` | Continuous liquid/jammy phase (reduced pectin/water + fat, or stabilized emulsion) | **Yes** | No (coats anchor) | `pomarola` (simmered tomato + oil), `curd_sauce`, `cacio_e_pepe` emulsion, `dal` | 
| `flavored_fat` | Liquid fat infused with bloomed aromatics | **Yes** (light coat) | No | `aglio_olio` (garlic + chilli in olive oil), `tadka` (spices in ghee) | 
| `liquid_drink` | Pourable hydrated suspension or broth | No | Yes (Rung 1) | `whey@shake_water`, `whey@shake_milk`, `broth` | 
| `set_batter` | Hydrated flour/protein cooked on griddle/pan into a unified flatbread/cake | No | Yes | `whey@pancake`, `besan@chilla`, `eggs@omelette` | 

> **Key Rule:** `tomato@sauteed` has `phase = discrete_cooked`. A tomato sauce has `phase = cohesive_sauce`. They are different physical states and are **never** interchangeable.

## 2. Layer 2: The Four Elements as Formal Operators

In SFAH, Salt, Fat, Acid, and Heat are not four equal taste sliders. Each has a distinct physical function and timing rule.

### 2.1 SALT — The Flavor Amplifier & Structural Modifier

* **Function:** Unlocks volatile aromatics, suppresses bitterness, enhances sweetness, weakens pectin (softens veg/beans), and prevents protein strands from clumping tightly (keeps eggs tender).

* **Constraint:** Salt has an **absolute threshold** (under-salted = flat; over-salted = inedible; cannot be "balanced" by adding bland food beside it, only diluted).

* **Two Timing Modes:**

  1. `season_within`: Added early or to cooking water (pasta, rice, boiled chickpeas, scrambled eggs) so diffusion seasons the interior.

  2. `season_finish`: Added at the end for surface punch or crunch.

* **Layering Rule:** Salt comes from crystals (`salt`) **and** salty ingredients (`cheese_slices`, `butter`, `soy_sauce`, `chaat_masala`, pickles). Pierre tracks `saltSources` so dishes with cheese/soy do not double-penalize or miss salt.

* **Modeling Rule for Harvey's:** Keep `salt` as a **dish-level dimension** fed by assumed `salt` + salty ingredients. Stop asking for `salt` per raw unseasoned food in quizzes.

### 2.2 FAT — The Flavor Carrier, Heat Medium & Texture Engine

Fat plays **three mutually exclusive roles** in a dish (SFAH p. 103–105). Pierre must tag every fat usage with its `fatRole`:

1. `fatRole: 'cooking_medium'` — Heated to $> 110^\circ\text{C}$ (typically $175\text{--}200^\circ\text{C}$) to eliminate surface water and drive Maillard browning and `crisp` crusts (e.g., `oil` for pan-frying paneer, `butter` for omelette). *Requires sufficient smoke point; butter burns $> 175^\circ\text{C}$, refined oil/ghee tolerate $> 200^\circ\text{C}$.*

2. `fatRole: 'main_binder'` — Emulsified with water/starch to create `creamy` sauces (e.g., `butter` + starchy pasta water; `curd` + mash), or worked into doughs/batters for `tender`/`flaky`/`light` textures.

3. `fatRole: 'seasoning'` — Added unheated or at the very end to carry aroma, coat the tongue, and fix dryness (e.g., `butter` spread on toast, `ghee` stirred into khichdi, `olive_oil` drizzled over chickpeas).

**The Emulsion Law (SFAH p. 127–133):**
Fat and water naturally repel each other. Creating a `creamy` `cohesive_sauce` from fat + water requires an **emulsifier** (`starch` from pasta water/potatoes/chickpeas, `lecithin` from egg yolk, `casein` from cheese/butter/curd) plus **agitation** at controlled temperature. Melting butter alone in a hot pan *breaks* its emulsion into greasy oil + milk solids; swirling cold butter into starchy water *builds* an emulsion.

### 2.3 ACID — The Relative Balancer & Chemical Gate

* **Function:** Triggers salivation ("mouthwatering"), cuts richness/fat, relieves starchy/heavy palates, and balances sweetness. Unlike salt, **acid balance is relative** (sourness is balanced by fat, sugar, salt, or starch).

* **Two Timing Roles (SFAH p. 180–183):**

  1. `acidRole: 'cooking_acid'` — Added during cooking; heat mellows sharp edges and deepens savoriness (e.g., `tomato` simmered in sauce/bhurji).

  2. `acidRole: 'garnishing_acid'` — Added off-heat/at serving for bright, volatile lift (e.g., `lemon` juice, `curd`/`dahi` spooned over mash or khichdi, raw `tomato`, pickles).

* **Produced Acid (SFAH p. 177–178):** Browning (`Maillard` + `caramelization`) and fermentation (`curd`, `cheese`, `soy_sauce`) generate subtle acidity automatically.

* **Chemical Constraints (Hard Rules for Pierre):**

  * `ACID_TOUGHENS_PECTIN`: Acid slows pectin breakdown. Onions and legumes (`chickpeas`, `dal`) must be softened/cooked *before* adding tomatoes or lemon.

  * `ACID_CURDLES_FRESH_DAIRY`: Fresh `milk` curdles if boiled with `acid` (`tomato`, `lemon`). `curd` splits if boiled aggressively—stir in off-heat or at gentle simmer.

### 2.4 HEAT — The Transformation Operator (Medium $\times$ Intensity $\times$ Steam)

Heat is **not a taste** (note: in `pierre-raw.js`, `taste.heat` means *capsaicin/pungency/spiciness*—rename internally or document clearly as `pungency`/`spiceHeat` so the agent never confuses chili heat with thermal `Heat`).

Thermal Heat is defined by **four parameters** (SFAH p. 204–275):

1. **Heat Medium:** `water` (capped at $100^\circ\text{C} / 212^\circ\text{F}$), `fat` ($150\text{--}200^\circ\text{C}+$), `air` (convection/radiant: oven, air fryer, toaster), or `dielectric` (microwave: heats internal water, capped at $100^\circ\text{C}$).

2. **Intensity:** `gentle` (goal: **tenderness, hydration, cell breakdown, flavor melding**) vs. `intense` (goal: **browning, crisping, water evaporation, rapid cooking**).

3. **Steam Control:** `open` (steam escapes $\to$ surface dries $\to$ browning occurs above $110^\circ\text{C} / 230^\circ\text{F}$) vs. `trapped` (lid/crowded pan/microwave $\to$ steam condenses $\to$ temp stays at $100^\circ\text{C}$ $\to$ wilting/sweating/steaming, **zero browning**).

4. **Duration:** `flash` (20–60 sec, e.g., blooming garlic/spices), `short` (2–8 min, e.g., sauté, toast, scramble), `sustained` (15+ min, e.g., simmer sauce, boil beans, caramelize onions).

#### Canonical Method Dictionary (Zero Ambiguity for the Agent)

| Method ID | Medium | Intensity | Steam | Duration | Primary Physical Result | Can Brown (Maillard)? | 
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | 
| `raw` | none | none | — | 0 | No change (`cold` state) | No | 
| `bloom_tadka` | `fat` | `gentle`–`med` | `open` | `flash` | Releases fat-soluble aromatics into oil/ghee (`flavored_fat`) | No (burning = bitter veto) | 
| `sweat` | `fat` (minimal) | `gentle` | `trapped` | `short`–`sustained` | Softens veg (`onion`), turns translucent, releases moisture | **No** | 
| `saute` | `fat` (thin coat) | `intense` | `open` | `short` | Rapid surface evaporation + browning on small pieces; **stays `discrete_cooked`** | **Yes** | 
| `pan_fry` | `fat` (generous) | `med`–`intense` | `open` | `short` | Forms `crisp` golden crust on larger pieces (`paneer`, `potato`, `pancake`) while cooking interior | **Yes** | 
| `deep_fry` | `fat` (submerged) | `intense` ($\sim 185^\circ\text{C}$) | `open` | `short` | Total surface dehydration $\to$ max `crisp` (`onion@deep_fried`) | **Yes** | 
| `boil_blanch` | `water` | `intense` ($100^\circ\text{C}$) | `open` | `short` | Hydrates pasta/grains, softens veg pectin cleanly, seasons from within | **No** | 
| `simmer` | `water` / own juice | `gentle` ($82\text{--}96^\circ\text{C}$) | `open`/`ajar` | `sustained` | Breaks down cell walls/pectin into `cohesive_sauce`, tenderizes legumes/oats | **No** | 
| `reduce` | `water` / sauce | `intense` | `open` (wide) | `sustained` | Evaporates water $\to$ concentrates umami/acid/salt & thickens sauce | **No** | 
| `pressure_cook` | `water` + steam | `intense` ($>115^\circ\text{C}$) | `trapped` | `sustained` | Rapidly hydrates & softens `dry_starch_seed` (`chickpeas`, `dal`, `khichdi`) | **No** | 
| `toast` | `air` / dry metal | `intense` | `open` | `short` | Browns & crisps surface only (`bread`, nuts, spices) without cooking interior | **Yes** | 
| `air_fry_roast` | `air` (convection) | `intense` | `open` | `short`–`med` | Circulating hot air dries surface $\to$ `crisp` + Maillard on dense/starchy foods; concentrates veg sugars | **Yes** | 
| `melt` | `air` / residual | `gentle` | `open` | `flash` | Liquefies solid fat/cheese into `creamy` coating (`cheese_slices@melted`) | **No** | 
| `microwave` | `dielectric` (water) | `intense` internal | `trapped` | `short` | Steams food from inside at $\le 100^\circ\text{C}$; softens starches/paneer, **over-coagulates delicate eggs** | **No** | 
| `mash_puree` | mechanical | none | — | `flash` | Breaks softened cell walls into `paste_mash` or smooth `cohesive_sauce` (requires prior hydration/cooking) | **No** | 
| `blend_shake` | mechanical | none | — | `flash` | Suspends powder/fruit in liquid $\to$ `liquid_drink` (`whey@shake`, banana shake) | **No** | 

## 3. Layer 3: The Transformation Matrix (What Makes What)

Instead of guessing from raw vectors, Pierre evaluates a part via a **state transition**:

```
TransformedPart = transform(food, method, context)
```

### 3.1 `FoodClass × Method` State-Transition Matrix

| `foodClass` | `saute` / `pan_fry` | `air_fry_roast` | `simmer` / `boil` / `pressure` | `microwave` | `mash_puree` *(on cooked)* | 
| ----- | ----- | ----- | ----- | ----- | ----- | 
| `dry_starch_seed` | **Veto** *(unless pre-hydrated)* | **Veto** *(raw grains burn/stay hard)* | `hydrated_starch` (`creamy`+, `tender`+, `water`+) | Only if submerged in water (`oats`, `soya`) | `paste_mash` (`creamy`++) | 
| `hydrated_starch` | `discrete_cooked` (`crisp`+, `fat`+, Maillard) | `discrete_cooked` (`crisp`++, Maillard) | Overcooks $\to$ mushy | Reheats / softens (`chewy`+, `crisp` 0) | `paste_mash` (`creamy`++) | 
| `watery_veg_fruit` | `discrete_cooked` (`crisp`-, `sugar`+, light char; **NOT a sauce**) | `discrete_cooked` (`sugar`++, caramelize if spaced) | **Breaks down pectin** $\to$ `cohesive_sauce` (if reduced/smashed) or soft veg | Steams $\to$ soft/watery (`crisp` 0) | `cohesive_sauce` / `paste_mash` | 
| `dense_protein_dairy` | `discrete_cooked` (`crisp`+2, `chewy`+, Maillard) | `discrete_cooked` (`crisp`+2, Maillard) | Softens / stays `discrete_cooked` | Softens (`creamy`+, `juicy`+, no crust) | Crumbles (`bhurji` base) | 
| `delicate_protein` (`eggs`) | `set_batter` / `discrete_cooked` (omelette, fried egg, scramble) | Sets if held in vessel (`egg_in_toast`) | `discrete_cooked` (`boiled`, `poached`) | **Veto** (`eggs@microwaved`: rubbery/sulfurous) | N/A | 
| `protein_powder_flour` | **Requires hydration first** $\to$ `set_batter` (`pancake`, `chilla`) | **Veto** | Porridge / thickener | Mug cake *(risk of rubbery)* | N/A | 
| `pure_or_emulsified_fat` | Acts as `cooking_medium` (butter browns/clarifies) | Coatings only | `milk`/`curd` risk curdling if boiled with acid | Melts/breaks butter emulsion | Emulsifies into `cohesive_sauce` | 
| `aromatic_herb_acid` | `bloom_tadka` (`flavored_fat`); burns if intense/long | Burns easily | Infuses liquid gently; citrus/herbs lose `fresh` | Dulls aromatics | `paste_mash` (`chutney`, `pesto`) | 

### 3.2 Worked Trace: Why Sautéed Tomatoes $\ne$ Tomato Sauce

Here is how the ontology resolves the exact failure case you identified:

| Operation | Inputs | Method Parameters | Physical Result (`phase`) | Sensory Outcome | Valid as Pasta Sauce? | 
| ----- | ----- | ----- | ----- | ----- | ----- | 
| **Sautéed Tomatoes** (`tomato@sauteed`) | `tomato` (`watery_veg_fruit`) + thin `oil` | `medium: fat`, `intensity: intense`, `duration: short`, `steam: open` | **`discrete_cooked`** (intact skins/chunks, slight blister, water still bound in flesh) | `acid: 2`, `sugar: 1`, `fresh: 1`, `juicy: 2`, **cannot cling to or coat pasta** | **No** (it is a vegetable topping/mix-in) | 
| **Tomato Sauce / Pomarola** (SFAH p. 426–428) | `tomato` + `oil` (`fatRole: main_binder`) + `salt` + optional `onion@sweated` + `garlic@bloomed` | `medium: own_juice`, `intensity: gentle` (`simmer` $\to$ `reduce`), `duration: sustained` + agitation/purée | **`cohesive_sauce`** (pectin broken down, water reduced, oil emulsified into tomato pulp) | `umami: 3` *(concentrated by reduction)*, `acid: 2`, `sugar: 2`, `fat: 2`, `creamy: 2` | **Yes** (coats a `hydrated_starch` base) | 
| **Quick Bhurji / Masala Base** | `onion@browned` + `garlic@bloomed` + `tomato@simmered_down` + `salt` + `fat` | `sweat/brown` onion first (`ACID_TOUGHENS_PECTIN`), then cook down tomato until jammy | **`cohesive_sauce` (thick masala)** | `umami: 2`, `acid: 2`, `fat: 2`, `spiceHeat: 1–2` | **Yes** (binds `paneer`, `eggs`, `chickpeas`) | 

**What the agent learns from this:** A `sauce` is never created by a single `food@sauteed` tag. A `sauce` is a **composite entity** that requires a continuous liquid/emulsified phase.

## 4. Layer 4: Composite Culinary Entities ("What Makes What")

To let Pierre classify and construct dishes cleanly without brute-force bag-of-ingredient scoring, define **7 canonical composite entities** (all pure data schemas):

### 4.1 Intermediate Building Blocks

1. **`AromaticBase` (Soffritto / Indian Bhuna / Tadka):**

   * `tadka_bloom`: `fat(cooking_medium)` + `aromatic_herb_acid` (`garlic`, `chilli`, whole spices) @ `bloom_tadka` $\to$ produces `flavored_fat`.

   * `masala_base`: `onion` @ `sweat`/`brown` *(must soften before acid!)* + `garlic` @ `bloom_tadka` + `tomato` @ `simmer` (until jammy) + `salt` $\to$ produces `cohesive_sauce`.

2. **`Sauce` (4 Families — adapted from SFAH p. 419 & 522):**

   * `reduced_veg_sauce`: `watery_veg_fruit` (`tomato`) @ `simmer` + `reduce` + `fat(main_binder)` + `salt` $\to$ `cohesive_sauce`.

   * `starch_fat_emulsion`: `fat` (`butter` / `cheese` / `oil`) + `starchy_water` (from `pasta`/`potato`/`chickpeas`) + agitation $\to$ `cohesive_sauce` (e.g., Cacio e Pepe, creamy cheese pasta).

   * `cultured_dairy_sauce`: `curd` / `hung_curd` + `salt` + optional `aromatic`/`tadka`/`fresh_herb` $\to$ `cohesive_sauce` (cold/room-temp; never boiled).

   * `pounded_herb_nut_sauce`: `fresh_herb` / `nuts` (`peanuts`, `walnuts`) + `fat` + `acid` + `salt` @ `mash_puree` $\to$ `paste_mash` / `cohesive_sauce` (pesto, chutney).

3. **`Dressing / Vinaigrette`:**

   * `fat(seasoning)` + `acid(garnishing_acid)` + `salt` + optional `macerated_onion` $\to$ coats raw salads/chaats.

### 4.2 Dish Forms (`FORMS` Grammar Updated with Physical Phases)

Every dish in Harvey's—whether from `catalogue.js`, generated from pantry parts, or proposed by AI—is classified into a **Form**. Each Form declares which **phases** it requires, preventing incoherent bags like `raw oats + raw tomato`.

| Form ID | Required Slots (with Required `phase`) | Optional Lift Slots | Classic & Macro-Hack Examples | 
| ----- | ----- | ----- | ----- | 
| `shake` | `liquid_drink` (`whey@shake_water`, `whey@shake_milk`, `milk + banana@blended`) | `sweet_mod`, `peanut_butter` | Whey protein shake; Banana-milk shake | 
| `cold_bowl` | `creamy_base` (`curd`, `milk`, `whey_pudding`) + `solid_addon` (`raw_edible` fruit, `discrete_cooked` crunch) | `sweet_mod`, `nut_crunch` | Curd + whey + banana; Whey + makhana bowl; Oats + milk *(soaked/cooked)* | 
| `toast_melt` | `bread@toasted` (`discrete_cooked`) + `topping` (`melted` cheese, `paste_mash`, `discrete_cooked` egg/paneer) | `fat(seasoning)`, `garnishing_acid`, `spice_mod` | Air-fryer protein cheese toast; Peanut butter toast; Egg-in-toast | 
| `sandwich` | `bread` (`raw_edible` or `toasted`) + `filling` (`discrete_cooked` or `paste_mash`) + `moisture_bridge` (`butter`, `cheese@melted`, `curd`, `mayo`) | `crisp_raw_veg`, `chaat_masala` | Tawa paneer cheese sandwich | 
| `savory_mash` | `paste_mash` (`chickpeas@mashed`, `potato@mashed`, `dal`) + `fat(seasoning/binder)` (`butter`, `ghee`, `oil`) | `garnishing_acid` (`curd`, `lemon`), `crisp_raw_veg` (`onion`), `tadka_bloom` | **Boiled mashed chickpeas + butter + dahi** | 
| `griddle_cake` | `set_batter` (`whey@pancake`, `besan@chilla`, `eggs@omelette`) | `fat(cooking_medium)`, `garnishing_acid` (`curd`/chutney) or `sweet_mod` | **Whey + milk pancake**; Besan chilla; Butter omelette | 
| `quick_stir_bhurji` | `protein` (`paneer`/`eggs`/`soya` @ `discrete_cooked`) + `fat(cooking_medium)` + `seasoning` (`salt` + `spice_mod` OR `masala_base`) | `garnishing_acid` (`lemon`, `coriander`) | Microwave paneer bhurji; Classic egg/paneer bhurji; Pan-fried paneer | 
| `coated_base` | `base` (`hydrated_starch`: `pasta`, `rice`, `poha`, `cooked_oats`) + **coating** (`cohesive_sauce` OR `flavored_fat` OR `cultured_dairy_sauce`) | `protein_topper` (`paneer@pan_fried`), `crisp_garnish` (`peanuts`, `onion@deep_fried`), `cheese` | Pasta aglio olio + paneer (`flavored_fat`); Pasta alla Pomarola (`cohesive_sauce`); Masala oats; Kanda poha; Curd rice | 
| `chaat_salad` | `base_veg_or_legume` (`raw_edible` veg OR `hydrated_starch` `chickpeas`) + `garnishing_acid` (`lemon`, `tomato`, `curd`) + `salt`/`chaat_masala` | `crisp_raw_veg` (`onion`, `cucumber`), `fresh_herb` (`coriander`), `crisp_nut` | Chana chaat; Shirazi salad | 
| `one_pot` | `hydrated_starch` (`rice` + `dal` @ `pressure_cook`/`simmer`) + `fat(seasoning)` (`ghee`) | `cultured_dairy_sauce` (`curd`), `tadka_bloom` | Moong dal khichdi + ghee + curd | 

> **Why `coated_base` fixes the pasta/oats bug:** If the pantry has `pasta` + `tomato@sauteed` (and no sauce/flavored oil), `coated_base` sees **no valid coating** (`discrete_cooked` is not `cohesive_sauce` or `flavored_fat`). Pierre immediately knows it is *not* a sauced pasta—it must either simmer the tomato with oil into a `reduced_veg_sauce`, or use `garlic + oil` as a `flavored_fat` (`aglio_olio`).

## 5. Layer 5: Balance, Contrast & Diagnostic Engine (Pierre's Judgment)

Grounded in SFAH's *Balance, Layering, and Restraint* (p. 285–288), Pierre judges any structurally valid dish through a **4-stage deterministic pipeline**.

### Stage 1: Chemical & Structural Vetoes $\to$ `tier: 'veto'`

Reject immediately if any invariant fails:

1. **Inedible Phase:** Any part remains `raw_inedible` at serving (e.g., raw `pasta`, raw `oats` in a hot dish, unhydrated `whey` powder, raw `eggs`).

2. **Rated Technique Veto:** Any part matches a user-vetoed `food@technique` (e.g., `eggs@microwaved`, `soya_chunks@boiled`).

3. **Sweet / Savory Clash:** Savory aromatics (`onion`, `garlic`, `chaat_masala`, `soy_sauce`) combined with sweet-only profiles (`whey` sweet, `honey`, `banana`, `mango`) outside an explicit sweet-sour form.

4. **Missing Anchor / Formless Condiment:** No anchor/base slot filled (structurally blocks `"100 g butter with salt"`).

5. **Chemical Breakage:** Boiling `milk` with strong `acid` (`lemon`/`tomato`), or adding `acid` to dry legumes before they are hydrated.

### Stage 2: Samin's Flavor Balance Check (Salt, Fat, Acid, Umami)

Samin's diagnostic order (SFAH p. 286):

1. **Salt Check:** Savory dishes require `salt` (assumed present as basic modifier) or a salty ingredient (`cheese`, `butter`, `soy_sauce`). Sweet dishes still benefit from a pinch of salt.

2. **Balance Axis (Counterpoint Law):**

   * **Mouth-drying starch** (`bread`, `pasta`, `rice`, `chickpeas`, `potato`) requires **moisture/lubrication** (`fat`, `cohesive_sauce`, `emulsion`, or `cultured_dairy_sauce`). *Plain boiled chickpeas fail here.*

   * **Rich / fatty anchor** (`paneer`, `cheese`, `butter`, `eggs`, `peanut_butter`) wants **acid or fresh relief** (`curd`, `lemon`, `tomato`, `onion`, `coriander`) to prevent palate fatigue.

   * **Sweet anchor** (`banana`, `whey`, `oats + honey`) wants **acid, salt, or fat** (`curd`, `peanut_butter`, `milk`) so it is not one-note sugar.

3. **Umami Check (SFAH p. 189–191):**

   * Track `umami` from concentrated/fermented/browned sources: `cheese`, `soy_sauce`, `mushroom`, `simmered_tomato`, `Knorr/stock`, and **Maillard-browned parts** (`pan_fried`, `air_fried`, `toasted`, `browned_onion`).

   * Respect the **"toomami" ceiling** (SFAH p. 190): piling 4+ heavy umami bombs together yields a muddy, "kitchen-sink" dish.

### Stage 3: Texture & Temperature Contrast Check

From SFAH p. 285–286 (*Dynamic Contrast*):

* **Texture Aggregation:** Per-dimension `max` over parts that occupy a meaningful share of the bite (`centre >= 2` or main form slot).

* **True Contrast Rule:** Texture contrast counts only when **$\ge 2$ distinct textures reach level $\ge 2$ from *different* parts** (prevents a single ingredient like raw tomato from claiming multi-texture contrast by itself).

  * Classic pairs: `crisp` + `creamy` (toasted bread + melted cheese; makhana + whey pudding), `crisp` + `chewy` (pan-fried paneer + pasta), `creamy` + `crunchy` (chickpea mash + raw onion/peanuts).

* **Temperature / State Contrast:** Derived automatically from technique (`raw` = `cold`, `@technique` = `hot`). `hot` base + `cold` acidic/fresh garnish (e.g., hot `chickpeas@mashed + butter` + cold `curd`; hot `khichdi` + cold `curd`; hot `pasta` + fresh `coriander`) is a classic high-palatability signature.

### Stage 4: Tier Output & Upgrade Diagnosis (`veto | floor | pass | crave`)

| Tier | Condition | What Pierre Returns | 
| ----- | ----- | ----- | 
| `veto` | Fails any Stage 1 invariant. | Rejection reason (e.g., `eggs@microwaved is vetoed`, `pasta has no sauce/coating`). | 
| `floor` | Structurally valid Form, **no veto**, but fails Stage 2 balance (e.g., dry starch with no fat/acid/sauce, like plain boiled chickpeas). | Returns the **exact missing element** from Samin's diagnostic order + cheapest inventory modifier to lift it (e.g., `"Needs fat + acid: add butter + curd"`). | 
| `pass` | Valid Form + clears Stage 2 balance (hits minimum snob floor). | Passes to White; carries flavor/texture summary chips (`fat + acid + fresh`, `crisp + creamy`). | 
| `crave` | Only earned from **owner signal** (explicit `crave` verdict or repeat `"Cooked this"` log) — never invented by formula in v1. | Prioritized within its Marco effort rung. | 

## 6. Concrete Data Structures (JS & Swift-Portable Blueprint)

Everything below is pure data (no closures, no DOM, no network) so it fits directly into `src/brain/ingredients.js` and ports 1-to-1 to `Codable, Sendable` Swift structs in `MarcoCore`.

```
// 1. Extended food metadata (in pierre-raw.js or food-meta.js)
// Preserves existing texture/taste/centre ratings; adds molecular class + default phase.
const FOOD_ONTOLOGY = {
  tomato: {
    foodClass: 'watery_veg_fruit',
    rawPhase: 'raw_edible',
    umamiOnReduce: true,   // concentrated umami when simmered down (SFAH p. 191)
    acidRole: 'both',      // cooking_acid when simmered, garnishing_acid when raw
  },
  chickpeas: {
    foodClass: 'dry_starch_seed',
    rawPhase: 'raw_inedible',      // dry; 'hydrated_starch' if inventory state is pre_boiled/canned
    hydratedPhase: 'hydrated_starch',
  },
  paneer: {
    foodClass: 'dense_protein_dairy',
    rawPhase: 'raw_edible',
  },
  cheese_slices: {
    foodClass: 'dense_protein_dairy',
    rawPhase: 'raw_edible',
    meltable: true,
    saltySource: true,
    umamiSource: true,
  },
  butter: {
    foodClass: 'pure_or_emulsified_fat',
    rawPhase: 'raw_edible',
    fatRoles: ['cooking_medium', 'main_binder', 'seasoning'],
    saltySource: true,
    smokePoint: 'medium', // burns > 175°C
  },
  curd: {
    foodClass: 'pure_or_emulsified_fat',
    rawPhase: 'cohesive_sauce', // cultured_dairy_sauce ready as-is
    acidRole: 'garnishing_acid',
    curdlesOnBoil: true,
  },
  whey: {
    foodClass: 'protein_powder_flour',
    rawPhase: 'raw_inedible',
    flavorProfile: 'sweet',
  },
  eggs: {
    foodClass: 'delicate_protein',
    rawPhase: 'raw_inedible',
    emulsifier: true,
  },
};

// 2. Method definitions (physical physics — NOT preference weights)
const METHODS = {
  raw:        { medium: 'none',       intensity: 'none',    steam: 'none',    browns: false, tempState: 'cold' },
  bloom_tadka:{ medium: 'fat',        intensity: 'gentle',  steam: 'open',    browns: false, tempState: 'hot'  },
  sweat:      { medium: 'fat',        intensity: 'gentle',  steam: 'trapped', browns: false, tempState: 'hot'  },
  saute:      { medium: 'fat',        intensity: 'intense', steam: 'open',    browns: true,  tempState: 'hot'  },
  pan_fry:    { medium: 'fat',        intensity: 'intense', steam: 'open',    browns: true,  tempState: 'hot'  },
  air_fried:  { medium: 'air',        intensity: 'intense', steam: 'open',    browns: true,  tempState: 'hot'  },
  toasted:    { medium: 'air',        intensity: 'intense', steam: 'open',    browns: true,  tempState: 'hot'  },
  boiled:     { medium: 'water',      intensity: 'intense', steam: 'open',    browns: false, tempState: 'hot'  },
  simmered:   { medium: 'water',      intensity: 'gentle',  steam: 'open',    browns: false, tempState: 'hot'  },
  mashed:     { medium: 'mechanical', intensity: 'none',    steam: 'none',    browns: false, tempState: 'inherit' },
  melted:     { medium: 'air',        intensity: 'gentle',  steam: 'open',    browns: false, tempState: 'hot'  },
  microwaved: { medium: 'dielectric', intensity: 'intense', steam: 'trapped', browns: false, tempState: 'hot'  },
  shake_water:{ medium: 'mechanical', intensity: 'none',    steam: 'none',    browns: false, tempState: 'cold' },
  shake_milk: { medium: 'mechanical', intensity: 'none',    steam: 'none',    browns: false, tempState: 'cold' },
  pancake:    { medium: 'fat',        intensity: 'med',     steam: 'open',    browns: true,  tempState: 'hot'  },
};

// 3. Resolution order inside partVector(part)
//   1. Owner's dish-level verdict (highest authority)
//   2. Owner's rated food@technique row in pierre-raw.js (overrides physics priors)
//   3. FoodClass × Method transition matrix (deterministic phase + provisional texture/taste delta)
//   4. Raw vector (with rawPhase)

```

## 7. Integration Checklist for the Coding Agent (Step 3 Reference)

When implementing Step 3 (`src/brain/ingredients.js`) using this document:

1. **Do not delete existing taste/texture dimensions yet:** Keep `pierre-raw.js`'s 5 textures and 7 tastes intact until the Step 4 30-dish blind benchmark runs. Clarify in code comments that `taste.heat` = *pungency/spiciness* (distinct from thermal `METHODS`).

2. **Add `foodClass` and `phase` resolution first:** Ensure `partVector()` returns `{ ..., foodClass, phase, tempState }` so every downstream check knows whether a part is `discrete_cooked` vs. `cohesive_sauce` vs. `raw_inedible`.

3. **Enforce the `sauce` vs. `sauté` distinction in unit tests:**

   * `pasta@boiled + tomato@sauteed` $\to$ fails `coated_base` (`tomato@sauteed` is `discrete_cooked`, not `cohesive_sauce`).

   * `pasta@boiled + tomato@simmered + oil + salt` $\to$ passes `coated_base` (`cohesive_sauce` formed).

   * `pasta@boiled + garlic@bloom_tadka + oil + paneer@pan_fried` $\to$ passes `coated_base` (`flavored_fat` coating + `crisp` / `chewy` texture contrast).

   * `chickpeas@boiled` alone $\to$ `floor` (dry starch missing fat/acid; suggests `+ butter`, `+ curd`).

   * `chickpeas@mashed + butter + curd + salt` $\to$ `pass` (`savory_mash` form, `fat + acid + fresh`, `hot` mash + `cold` curd).

   * `butter + salt` alone $\to$ `veto` / `floor` (no anchor slot filled).

   * `oats(raw) + tomato(raw)` $\to$ `veto` (`raw_inedible` starch).

4. **Mark all numeric floor thresholds `PROVISIONAL`:** The *physical laws* (`sautéed tomato != sauce`, `raw pasta != edible`, `milk + acid + boil = curdle`) are permanent domain invariants. Any numeric cut-off (e.g., how many taste/texture dimensions clear `floor`) must live in `config.js` marked `PROVISIONAL = true` until calibrated by the Step 4 blind benchmark.