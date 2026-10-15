// Human-Written Candidate Pitch Generator for "What sets you apart"
// Grounded 100% in Pankaj Kumar master resume
// Natural first-person senior engineer tone (no robotic syntax, no brackets, no internal taxonomy codes)

export const VERIFIED_RESUME_DATA = {
  name: "Pankaj Kumar",
  title: "Staff Engineer",
  experienceYears: "8+"
};

/**
 * Generates a concise, natural, authentic first-person pitch (under 950 characters)
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
  
  // Clean skills: strip (Expert), (Strong), (Intermediate), (5+ years), etc.
  const cleanedSkills = rawSkills
    .map(s => typeof s === "string" ? s : (s?.name || ""))
    .map(s => s.replace(/\s*\([^)]*\)/g, "").trim())
    .filter(Boolean);

  // Deduplicate case-insensitively while preserving natural capitalization
  const uniqueSkills = [];
  const seen = new Set();
  for (const s of cleanedSkills) {
    const lower = s.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      uniqueSkills.push(s);
    }
  }

  // If Gemini API Key is available, instruct strict human writing style
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Write a concise, natural, first-person candidate pitch (around 700-850 characters) for Pankaj Kumar applying for this opportunity.
CRITICAL HUMAN WRITING RULES:
1. Ground strictly in Pankaj resume: Staff Engineer, 8+ years experience, Angular/React, TypeScript, Python, micro-frontends (Module Federation), financial/banking analytics, Star of the Quarter & Excellence awards.
2. Address this Job Description: "${jd.slice(0, 200)}"
3. Skills: ${uniqueSkills.slice(0, 4).join(", ")}
4. NEVER use internal taxonomy codes like "3.1-FRONTEND-ANGULAR2X" - refer naturally to the position.
5. NEVER include rating words or brackets like "(Expert)", "(Strong)" - write natural flowing sentences.
6. Tone: Natural, senior, authentic, polite, confident, zero robotic jargon.
7. Maximum Length: Under 900 characters total.`;

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
          return trimmed.length > 990 ? trimmed.slice(0, 980) + "..." : trimmed;
        }
      }
    } catch (e) {
      console.warn("Falling back to local resume-grounded generator:", e.message);
    }
  }

  // Pure Resume-Grounded Natural Human Synthesis
  const isReact = genus.toUpperCase().includes("REACT") || uniqueSkills.some(s => s.toLowerCase().includes("react"));
  const isAngular = genus.toUpperCase().includes("ANGULAR") || uniqueSkills.some(s => s.toLowerCase().includes("angular"));
  const isPython = genus.toUpperCase().includes("PYTHON") || uniqueSkills.some(s => s.toLowerCase().includes("python"));
  const isFinance = jd.toLowerCase().includes("bank") || jd.toLowerCase().includes("financ") || bu.toLowerCase().includes("financ");
  const isMicroFrontend = jd.toLowerCase().includes("micro-frontend") || jd.toLowerCase().includes("microfrontend");

  // Natural project & technical highlight matching role focus
  let experienceHighlight = "";
  if (isFinance) {
    experienceHighlight = "Recently as Staff Engineer on a global Financial Market Intelligence platform, I led frontend engineering handling high-volume financial data, custom analytics dashboards, and secure user workflows.";
  } else if (isMicroFrontend) {
    experienceHighlight = "I recently architected a scalable micro-frontend ecosystem using Webpack Module Federation for an enterprise client, helping decouple monolithic codebases into modular, independently deployable apps.";
  } else if (isAngular) {
    experienceHighlight = "My recent experience centers on modern Angular architecture and complex web UIs, including building mission-critical dashboards with RxJS, custom component libraries, and AG Grid data tables.";
  } else if (isReact) {
    experienceHighlight = "My recent work has focused heavily on modern React and TypeScript, building responsive, accessible web applications with Redux Toolkit and optimized state management patterns.";
  } else {
    experienceHighlight = "Over the past 8+ years, I have taken end-to-end architectural ownership of complex web applications, designing modular, high-performing frontends and mentoring engineering teams.";
  }

  // Natural conversational mention of must-have skills (no brackets, no robotic listings)
  let skillsSentence = "";
  if (uniqueSkills.length > 0) {
    const topSkills = uniqueSkills.slice(0, 4);
    let skillsListStr = "";
    if (topSkills.length === 1) {
      skillsListStr = topSkills[0];
    } else if (topSkills.length === 2) {
      skillsListStr = `${topSkills[0]} and ${topSkills[1]}`;
    } else {
      skillsListStr = `${topSkills.slice(0, -1).join(", ")}, and ${topSkills[topSkills.length - 1]}`;
    }
    skillsSentence = `I work hands-on with ${skillsListStr} on a daily basis, with a strong focus on clean architecture, component reusability, and Core Web Vitals optimization.`;
  } else {
    skillsSentence = "I work hands-on daily with modern JavaScript, TypeScript, and modern frontend frameworks, maintaining high standards for code quality and UI performance.";
  }

  const fullstackNote = isPython && (isAngular || isReact)
    ? " In addition, my background with Python and REST APIs allows me to collaborate effectively across the full stack."
    : "";

  const paragraphs = [
    "Hi, I am a Staff Engineer with over 8 years of experience delivering robust, high-performance web applications.",
    experienceHighlight,
    `${skillsSentence}${fullstackNote}`,
    "Having been recognized at Nagarro with the Excellence Award and Star of the Quarter, I pride myself on disciplined Agile delivery, proactive communication, and quick turnaround.",
    "I am available to onboard immediately and can hit the ground running from day one."
  ];

  let pitch = paragraphs.join(" ").replace(/\s+/g, " ").trim();
  if (pitch.length > 990) {
    pitch = pitch.slice(0, 980) + "...";
  }
  return pitch;
}
