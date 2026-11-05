import type { Rule } from "../model";
import { documentRules } from "./documents";
import { lcReviewRules } from "./lcReview";
import { ucp600Rules } from "./ucp600";

export * from "./ucp600";
export * from "./documents";
export * from "./lcReview";
export * from "./titles";
export * from "./custom";
export * from "./countryRisk";

/** 全部内置规则：先审证，再审单 */
export const allRules: Rule[] = [...lcReviewRules, ...ucp600Rules, ...documentRules];

/** 规则库版本：规则内容变化时递增，随每次审查结果落库，便于追溯 */
export const RULESET_VERSION = "builtin-0.2.0";
