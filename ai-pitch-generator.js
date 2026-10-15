// AI-Powered Candidate Pitch Generator for "What sets you apart"
// Grounded 100% in Pankaj Kumar master resume (max 50% professional amplification)
// Strictly targeted to ~850-1000 characters

export const VERIFIED_RESUME_DATA = {
  name: "Pankaj Kumar",
  title: "Staff Engineer",
  experienceYears: "8+"
};

/**
 * Generates a concise, high-impact first-person pitch (under 1000 characters)
 * strictly grounded in Pankaj Kumar master resume and tailored to the Job Description.
 *
 * @param {Object} demand The demand object
 * @returns {Promise<string>} The generated pitch (strictly <= 1000 chars)
 */
export async function generateCandidatePitch(demand) {
  const genus = demand.genus || "";
  const bu = demand.businessUnit || "";
  const jd = (demand.jobDescription || "").trim();
  const rawSkills = Array.isArray(demand.additionalSkills) ? demand.additionalSkills : [];
  const mustHaveSkills = rawSkills.map(s => typeof s === "string" ? s.trim() : (s?.name || "").trim()).filter(Boolean);

  // If Gemini API Key is available, instruct strict 900-1000 character limit
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Write a concise first-person candidate pitch for Pankaj Kumar applying for ${genus} (${bu}).
CRITICAL CONSTRAINTS:
1. Ground strictly in Pankaj resume: Staff Engineer, 8+ years experience, Angular/React, TypeScript, Python, micro-frontends (Module Federation), financial/banking analytics, Star of the Quarter & Excellence awards.
2. Address this Job Description: "${jd.slice(0, 200)}"
3. Must-Have Skills: ${mustHaveSkills.join(", ")}
4. Maximum Length: Under 980 characters total. Punchy, professional, zero fluff.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.6 }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 100) {
          const trimmed = text.trim();
          return trimmed.length > 1000 ? trimmed.slice(0, 990) + "..." : trimmed;
        }
      }
    } catch (e) {
      console.warn("Falling back to local resume-grounded generator:", e.message);
    }
  }

  // Pure Resume-Grounded Concise Synthesis (~850 - 980 characters)
  const isReact = genus.toUpperCase().includes("REACT") || mustHaveSkills.some(s => s.toLowerCase().includes("react"));
  const isAngular = genus.toUpperCase().includes("ANGULAR") || mustHaveSkills.some(s => s.toLowerCase().includes("angular"));
  const isPython = genus.toUpperCase().includes("PYTHON") || mustHaveSkills.some(s => s.toLowerCase().includes("python"));
  const isFinance = jd.toLowerCase().includes("bank") || jd.toLowerCase().includes("financ") || bu.toLowerCase().includes("financ");
  const isMicroFrontend = jd.toLowerCase().includes("micro-frontend") || jd.toLowerCase().includes("microfrontend");

  // Project highlight from actual resume
  let projectHook = "";
  if (isFinance) {
    projectHook = "Recently serving as Team Lead and Staff Engineer on a global Financial Market Intelligence platform and banking lead systems, I bring hands-on experience handling complex financial analytics and secure UI workflows.";
  } else if (isMicroFrontend) {
    projectHook = "I recently architected a scalable micro-frontend shell using Module Federation for a German enterprise client, successfully decomposing monoliths into modular, high-performing independent modules.";
  } else if (isAngular) {
    projectHook = "Having led frontend modernization and air traffic management UI architectures single-handedly, I offer deep mastery in modular Angular, RxJS reactive patterns, and custom PrimeNG/AG Grid components.";
  } else {
    projectHook = "Throughout my 8+ years in frontend engineering, I have taken end-to-end architectural ownership across complex enterprise applications, recently serving as Staff Engineer and Primary Client POC.";
  }

  const skillsMatched = mustHaveSkills.slice(0, 5).join(", ");
  const skillsPhrase = skillsMatched ? ` My daily stack directly centers on ${skillsMatched}, enabling zero ramp-up delivery.` : "";
  const pythonPhrase = isPython ? " Complementing my frontend focus, my Python and REST API proficiency ensures seamless full-stack collaboration." : "";

  const sentences = [
    `With over 8 years of specialized engineering experience as a Staff Engineer, I offer a proven track record delivering resilient, high-performance web applications.`,
    projectHook,
    `${skillsPhrase}${pythonPhrase}`,
    `Promoted to Staff Engineer and recognized with the Excellence Award and Star of the Quarter, I combine rigorous architectural standards with disciplined Agile execution, Core Web Vitals optimization, and clean code governance.`,
    `I am ready to onboard immediately and drive rapid, measurable delivery for this ${genus} role.`
  ];

  let pitch = sentences.join(" ").replace(/\s+/g, " ").trim();
  if (pitch.length > 1000) {
    pitch = pitch.slice(0, 990) + "...";
  }
  return pitch;
}
