# Cataloguing other people's kitchens (1.29.0)

Give this prompt to the video agent. Its output goes straight into
`node scripts/import-kitchens.mjs <file.json> [--classify] [--save]`, or paste one kitchen's JSON into
"Paste a list" on the main page. The old fixed-id format still imports too.

```
You are cataloguing a home kitchen from video for Harvey's, a cooking app. Watch the whole video and list every food, appliance and cookware item you can actually see. Do not guess what might be inside closed containers.

Output ONLY JSON: an array with one object per kitchen (one video = one kitchen unless it clearly shows two homes). No prose, no markdown.

Each object:
{
  "kitchen": "short label, e.g. 'Delhi flat, video 3'",
  "items": [{"name": "...", "category": "..."}],
  "diet": "veg" | "veg+eggs" | "non-veg" | "unknown",
  "notes": "one line, optional: anything odd, e.g. 'no stove visible', 'mostly packaged snacks'"
}

Rules for items:
- "name" is the plain, generic name of what it is, in English, lower case: "brown bread", "protein bread", "soy sauce", "kasuri methi", "rice cooker". Be as specific as the label lets you (say "protein bread" or "brown bread" if the pack says so, otherwise "bread").
- No brands, quantities or locations in the name (Amul slices -> "cheese slices", Maggi -> "instant noodles", Nutrela -> "soya chunks"). A brand-only product becomes what it is.
- "category" is one of: protein, dairy, grain, bread, veg, fruit, fat, condiment, spice, herb, nuts_seeds, snack, sweet, drink, appliance, cookware, other.
- One entry per distinct item. Two kinds of the same thing (olive oil and mustard oil) are two entries.
- If you're not sure what something is, leave it out.
- List meat, fish and eggs if you see them; Harvey's filters them itself.
- Leave out plates, bowls, spoons, forks, mugs, knives, boards and spatulas. Harvey's assumes every kitchen has them.
- For cookware, say what it is: "steel pot", "nonstick pan", "tawa", "kadai", "pressure cooker", "strainer".
- "diet" is from what you see: non-veg only if meat or fish is visible.

Example output:
[
  {
    "kitchen": "Pune PG room, video 1",
    "items": [
      {"name": "instant noodles", "category": "grain"},
      {"name": "eggs", "category": "protein"},
      {"name": "brown bread", "category": "bread"},
      {"name": "butter", "category": "dairy"},
      {"name": "soy sauce", "category": "condiment"},
      {"name": "onion", "category": "veg"},
      {"name": "turmeric", "category": "spice"},
      {"name": "induction cooktop", "category": "appliance"},
      {"name": "steel pot", "category": "cookware"},
      {"name": "electric kettle", "category": "appliance"}
    ],
    "diet": "veg+eggs",
    "notes": "no fridge visible; only one burner"
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
