// Demand Classifier and Eligibility Logic

import { CONFIG } from './config.js';

/**
 * Checks whether a demand meets the eligibility criteria:
 * - Must NOT be already applied (interested: false)
 * - Must include Frontend alone OR Frontend with Python
 * - Must NOT be ONLY Python
 *
 * @param {Object} demand The demand record from the API
 * @returns {Object} { eligible: boolean, reason: string, tags: Object }
 */
export function evaluateDemand(demand) {
  if (!demand) {
    return { eligible: false, reason: "Invalid demand record", tags: {} };
  }

  // Check if already applied
  if (demand.interested === true) {
    return {
      eligible: false,
      reason: "Already applied to this demand",
      tags: { alreadyApplied: true }
    };
  }

  const genus = (demand.genus || "").toLowerCase();
  const title = (demand.jobTitle || demand.title || "").toLowerCase();
  const desc = (demand.jobDescription || "").toLowerCase();
  const skills = Array.isArray(demand.additionalSkills)
    ? demand.additionalSkills.map(s => (typeof s === 'string' ? s : s?.name || '').toLowerCase())
    : [];

  const combinedSearchText = `${genus} ${title} ${skills.join(' ')}`;

  // 1. Detect Frontend presence
  const frontendMatches = [];
  for (const kw of CONFIG.rules.frontendKeywords) {
    if (combinedSearchText.includes(kw)) {
      frontendMatches.push(kw);
    }
  }
  const hasFrontend = frontendMatches.length > 0;

  // 2. Detect Python presence
  const pythonMatches = [];
  for (const kw of CONFIG.rules.pythonKeywords) {
    if (combinedSearchText.includes(kw)) {
      pythonMatches.push(kw);
    }
  }
  const hasPython = pythonMatches.length > 0;

  const tags = {
    demandId: demand.demandId || demand.id,
    genus: demand.genus,
    hasFrontend,
    hasPython,
    frontendMatches: [...new Set(frontendMatches)],
    pythonMatches: [...new Set(pythonMatches)],
    mustHaveSkills: demand.additionalSkills || []
  };

  // Rule 1: ONLY Python -> DO NOT APPLY
  if (hasPython && !hasFrontend) {
    return {
      eligible: false,
      reason: "Only Python required (Frontend NOT found). Skipping as requested.",
      tags
    };
  }

  // Rule 2: Frontend with Python -> APPLY
  if (hasFrontend && hasPython) {
    return {
      eligible: true,
      reason: "Eligible: Frontend + Python combination detected.",
      tags
    };
  }

  // Rule 3: Frontend alone -> APPLY
  if (hasFrontend && !hasPython) {
    return {
      eligible: true,
      reason: "Eligible: Frontend role detected (Angular/React/etc.).",
      tags
    };
  }

  // Rule 4: Neither detected in genus/skills
  return {
    eligible: false,
    reason: "Neither Frontend nor Python specified in core requirements.",
    tags
  };
}
