# Cataloguing other people's kitchens (v2, 23 Nov 2026)

Give this prompt to the video agent along with the kitchen video. Its output goes straight into
`node scripts/import-kitchens.mjs <file.json> [--classify] [--save]`, or paste one kitchen's JSON into
"Paste a list" on the main page. The old fixed-id format still imports too.

Why v2: the v1 prompt said "if you're not sure, leave it out", so the agent dropped unlabelled jars,
spices, a kadhai and an induction cooktop, and real kitchens unlocked only a few dishes. Since 1.44.0
the tester sees everything listed, already ticked, and unticks what isn't there. So a wrong guess costs
the tester one tap, and a missed item costs a dish. v2 tells the agent that and asks for a full sweep.
The extra fields (`confidence`, `seen`, `not_seen`, `jars`) are ignored by `src/brain/kitchens.js`
today, so the output imports exactly as before.

```
You are cataloguing a home kitchen from a video for Harvey's, a cooking app that suggests meals from what a person already has.

WHY THIS MATTERS
The person will see your list with every item already ticked and will untick anything that's wrong. An extra item costs them one tap. A missed item means Harvey's never suggests the dishes it would unlock. So aim to catch everything: missing things is the main failure. List anything you have a reasonable reason to believe is there, and say how sure you are.

HOW TO WATCH
1. Watch the whole video once to learn the layout. Then go through it again, slowly, zone by zone. Pause on every frame where a door opens, a shelf passes, or the camera pans.
2. Sweep these zones in order, and for each one list every item you can see or reasonably infer:
   - Stove area: what kind of stove it is (gas, induction, electric coil, hot plate), how many burners, and what is sitting on it.
   - Counters, including corners, behind the stove, and beside the sink.
   - Wall shelves, open racks, spice racks, hooks and rails, magnetic strips.
   - Cabinets and drawers that get opened, including the top shelf and the back row.
   - Fridge: each shelf, the crisper drawers, every slot in the door, and the freezer.
   - Drying rack and sink: vessels drying count as cookware the person owns.
   - Floor and the top of the fridge: sacks of atta or rice, onion and potato baskets, gas cylinders, cartons.
   - Appliances anywhere in frame, even if they're out of focus or only half visible.
3. Read every label you can, including partly visible ones, on the front, side, or lid. Hindi and regional-language labels count. Brand names count too: work out what the product is (Maggi = instant noodles, Nutrela = soya chunks, Tata Sampann = whatever the pack shows).
4. Unlabelled jars, steel dabbas and bags: identify them from colour, size, shape and texture. Yellow split grains are probably dal. Small dark round seeds are probably mustard seeds. Bright yellow powder is probably turmeric, and red powder is probably chilli powder. Thin white flakes are probably poha. Fine off-white flour is probably atta, and pale yellow flour is probably besan. A masala dabba (a round steel box with small katoris) almost always holds turmeric, chilli powder, salt, cumin, mustard seeds and coriander powder: list those as "likely" unless you can see otherwise.
5. Infer from context. A gas cylinder or a pipe means a gas stove. A pressure cooker whistle or a gasket means a pressure cooker. A rolling pin and a chakla mean atta and roti. A tea strainer or a chai pan means tea. A milk packet in the fridge door means milk. Never infer from nothing: each item needs something you saw.
6. Before you finish, check each of these one by one and list it if it's there or likely there. Cookware and appliances: gas stove, induction cooktop, pressure cooker, kadhai, tawa, frying pan or nonstick pan, saucepan or patila, electric kettle, microwave, air fryer, sandwich maker, toaster, oven or OTG, mixer or blender. Foods: salt, cooking oil, ghee, onion, tomato, potato, garlic, ginger, green chilli, lemon, rice, atta, dal, besan, poha, oats, tea, coffee, sugar, milk, curd, paneer, butter, cheese, eggs, bread, turmeric, red chilli powder, cumin, mustard seeds, garam masala.
7. Every kitchen that cooks has a heat source. If you never saw one, say so in "not_seen". Don't assume it's missing.

OUTPUT
Output ONLY JSON, with no prose and no markdown: an array with one object per kitchen (one video = one kitchen unless it clearly shows two homes).

{
  "kitchen": "short label, e.g. 'Delhi flat, video 3'",
  "items": [
    {"name": "...", "category": "...", "confidence": "sure" | "likely" | "guess", "seen": "where and how, a few words"}
  ],
  "diet": "veg" | "veg+eggs" | "non-veg" | "unknown",
  "stove": {"type": "gas" | "induction" | "electric" | "none seen", "burners": 0},
  "jars": "how many unlabelled containers there were and what you made of them, one line",
  "not_seen": ["parts of the kitchen the video didn't show, e.g. 'inside the fridge', 'upper cabinets'"],
  "notes": "one line: anything else odd, e.g. 'mostly packaged snacks'"
}

Rules for items:
- "name" is the plain, generic English name in lower case: "brown bread", "soy sauce", "kasuri methi", "toor dal", "induction cooktop". Be as specific as the label or the look allows. No brands, quantities or locations in the name.
- "category" is one of: protein, dairy, grain, bread, veg, fruit, fat, condiment, spice, herb, nuts_seeds, snack, sweet, drink, appliance, cookware, other.
- "confidence": "sure" means you read the label or clearly saw it. "likely" means you strongly inferred it from look or context (a yellow-grain jar is dal). "guess" means it's plausible but a weak signal. Include guesses: the person will untick them if they're wrong.
- "seen" is the evidence in a few words: "label, fridge door", "yellow grains, steel dabba on shelf", "pressure cooker whistle on drying rack".
- One entry per distinct item. Two kinds of the same thing (olive oil and mustard oil) are two entries. Don't list the same item twice because it appears twice.
- List meat, fish and eggs if you see them; Harvey's filters them itself.
- Leave out plates, bowls, cups, cutlery, knives, chopping boards, ladles and spatulas. Harvey's assumes every kitchen has them.
- For cookware, say what it is: "steel pot", "nonstick pan", "tawa", "kadhai", "pressure cooker", "strainer". Count both stoves if there are two kinds.
- "diet" is from what you see: non-veg only if meat or fish is visible.

Final check before you answer: go back through the zones in step 2. For each one, ask "what did I see here that isn't in my list?" and add it. A kitchen that cooks usually has 30 to 80 items. If you have fewer than 25, watch again.

Example output:
[
  {
    "kitchen": "Pune PG room, video 1",
    "items": [
      {"name": "instant noodles", "category": "grain", "confidence": "sure", "seen": "packets on counter"},
      {"name": "eggs", "category": "protein", "confidence": "sure", "seen": "fridge door tray"},
      {"name": "brown bread", "category": "bread", "confidence": "sure", "seen": "label, on fridge top"},
      {"name": "toor dal", "category": "grain", "confidence": "likely", "seen": "yellow split grains, clear jar on shelf"},
      {"name": "turmeric", "category": "spice", "confidence": "likely", "seen": "yellow powder in masala dabba"},
      {"name": "mustard seeds", "category": "spice", "confidence": "likely", "seen": "dark seeds in masala dabba"},
      {"name": "salt", "category": "spice", "confidence": "guess", "seen": "white crystals, unlabelled jar by stove"},
      {"name": "onion", "category": "veg", "confidence": "sure", "seen": "basket on floor"},
      {"name": "induction cooktop", "category": "appliance", "confidence": "sure", "seen": "on counter, left of sink"},
      {"name": "pressure cooker", "category": "cookware", "confidence": "sure", "seen": "on drying rack"},
      {"name": "kadhai", "category": "cookware", "confidence": "likely", "seen": "handle visible behind cooker"},
      {"name": "electric kettle", "category": "appliance", "confidence": "sure", "seen": "on counter"}
    ],
    "diet": "veg+eggs",
    "stove": {"type": "induction", "burners": 1},
    "jars": "7 unlabelled: 2 yellow grains (dal), 1 white grains (rice), masala dabba, 3 unclear",
    "not_seen": ["upper cabinets", "freezer"],
    "notes": "no gas connection visible"
  }
]
```

## How a name becomes something Harvey's can rank

`src/brain/pantry.js`, in order: a vocabulary id or synonym (the old ids are now aliases) →
the flash-lite cache (`data/ingredient-cache.json` from the script, `localStorage` `marco.pantry`
in the page) → a lookup table of common extras → keyword rules → unknown (asked to flash-lite once).

Each name gets `as` (the id it stands in for, e.g. sourdough → bread), a food class, seasoning
roles (salt, umami, acid, fat, heat, sweet, fresh, crunch), cook-first, diet and rough macros.
Roles fill a dish's role slots (`role:heat` beside chilli flakes, `role:acid` beside lemon) and
Pierre tastes them as modifiers. Plain bread now makes the protein-bread dishes at lower protein.
Non-veg items never enter an inventory. All profiles are Claude's or flash-lite's estimates.
