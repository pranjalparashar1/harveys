// Public surface of Marco's brain. Everything here is pure and testable in Node.
export { CATALOGUE } from './catalogue.js';
export { DEFAULT_CONFIG, PROVISIONAL } from './config.js';
export { FOODS, EQUIPMENT, ASSUMED_BASICS, CAPABILITIES, labelFor, kindOf } from './vocabulary.js';
export { buildInventory, matchName } from './inventory.js';
export { rank, contextLambda, checkMeal, frictionFeatures, payoff, scoreMeal, describeMissing } from './ranker.js';
export { validateMeal } from './validate.js';
