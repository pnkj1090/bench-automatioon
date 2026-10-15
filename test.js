// Self-Verification Test Suite for Classifier and Demand Logic

import { evaluateDemand } from './classifier.js';

console.log("=== RUNNING CLASSIFIER LOGIC TESTS ===\n");

const testCases = [
  {
    name: "Scenario 1: Pure Python role",
    demand: {
      demandId: "TEST-1",
      genus: "2.2-PYTHON",
      additionalSkills: ["Python", "FastAPI", "PostgreSQL"],
      interested: false
    },
    expectedEligible: false,
    expectedReasonContains: "Only Python"
  },
  {
    name: "Scenario 2: Frontend alone (React)",
    demand: {
      demandId: "TEST-2",
      genus: "3.1-FRONTEND-REACT",
      additionalSkills: ["React", "TypeScript", "Redux"],
      interested: false
    },
    expectedEligible: true,
    expectedReasonContains: "Frontend"
  },
  {
    name: "Scenario 3: Frontend alone (Angular)",
    demand: {
      demandId: "TEST-3",
      genus: "3.1-FRONTEND-ANGULAR2X",
      additionalSkills: ["Angular", "RxJS", "TypeScript"],
      interested: false
    },
    expectedEligible: true,
    expectedReasonContains: "Frontend"
  },
  {
    name: "Scenario 4: Frontend with Python combined",
    demand: {
      demandId: "TEST-4",
      genus: "3.2-FRONTEND-REACT",
      additionalSkills: ["React", "Python", "REST APIs"],
      interested: false
    },
    expectedEligible: true,
    expectedReasonContains: "Frontend + Python"
  },
  {
    name: "Scenario 5: Already applied role",
    demand: {
      demandId: "TEST-5",
      genus: "3.1-FRONTEND-REACT",
      additionalSkills: ["React"],
      interested: true
    },
    expectedEligible: false,
    expectedReasonContains: "Already applied"
  }
];

let allPassed = true;

for (const tc of testCases) {
  const result = evaluateDemand(tc.demand);
  const eligibleMatches = result.eligible === tc.expectedEligible;
  const reasonMatches = result.reason.includes(tc.expectedReasonContains);

  if (eligibleMatches && reasonMatches) {
    console.log(`✅ [PASS] ${tc.name}`);
    console.log(`   -> Eligible: ${result.eligible} | Reason: "${result.reason}"`);
  } else {
    allPassed = false;
    console.error(`❌ [FAIL] ${tc.name}`);
    console.error(`   Expected Eligible: ${tc.expectedEligible}, Got: ${result.eligible}`);
    console.error(`   Expected Reason to contain: "${tc.expectedReasonContains}", Got: "${result.reason}"`);
  }
}

console.log("\n=================================");
if (allPassed) {
  console.log("🎉 ALL CLASSIFIER LOGIC TESTS PASSED!");
} else {
  console.error("💥 SOME TESTS FAILED!");
  process.exit(1);
}
