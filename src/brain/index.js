// Public surface of Marco's brain. Everything here is pure and testable in Node.
export { CATALOGUE } from './catalogue.js';
export { DEFAULT_CONFIG, PROVISIONAL } from './config.js';
export { FOODS, PREP_KINDS, EQUIPMENT, ASSUMED_BASICS, CAPABILITIES, labelFor, kindOf } from './vocabulary.js';
export { buildInventory, matchName, parseItemList } from './inventory.js';
export { rank, contextLambda, checkMeal, frictionRaw, payoff, scoreMeal, describeMissing, judgeMeal, pierreHint, TIER_ORDER, rungOf, RUNGS, buildLadder, assemblyStepOf, soakNeeds } from './ranker.js';
export { pierreTier, dishProfile } from './ingredients.js';
export { validateMeal } from './validate.js';
export { inDiet, NOT_IN_DIET } from './learn.js';
export { cookLogEntry, liveRepairEntry, liveVerdicts } from './log.js';
export { PIERRE_SEED } from './train-data.js';
