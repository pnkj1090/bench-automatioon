import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration for Demand Automation & Filter Rules

export const CONFIG = {
  // Polling interval in milliseconds (every 30 seconds as requested)
  pollIntervalMs: 30000,

  // Operating Schedule (IST Timezone: Mon-Fri, 8:00 AM - 8:00 PM IST; Excludes Sat & Sun)
  schedule: {
    enabled: true,
    timezone: "Asia/Kolkata",
    startHour: 8,   // 8:00 AM IST
    endHour: 20,    // 8:00 PM IST (20:00)
    daysOfWeek: [1, 2, 3, 4, 5] // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri (Excludes 0=Sun, 6=Sat)
  },

  // Selected filters as specified in the screenshots
  filters: {
    businessUnit: null,
    jobDescription: null,
    status: [],
    demandIds: [],
    userActionStatuses: null,
    page: {
      pageNumber: 1,
      pageSize: 50,
      sortBy: "createdAt",
      sortDirection: "desc"
    },
    genus: [
      "2.1-PYTHON",
      "2.2-PYTHON",
      "2.3-PYTHON",
      "3.1-FRONTEND-ANGULAR2X",
      "3.1-FRONTEND-ANGULARJS",
      "3.1-FRONTEND-REACT",
      "3.1-PYTHON",
      "3.2-PYTHON",
      "3.2-FRONTEND-ANGULAR2X",
      "3.2-FRONTEND-ANGULARJS",
      "3.2-FRONTEND-REACT",
      "3.3-FRONTEND-ANGULAR2X",
      "3.3-FRONTEND-REACT",
      "4.1-FRONTEND-ANGULAR2X",
      "4.1-FRONTEND-REACT",
      "4.2-FRONTEND-ANGULAR2X",
      "4.2-FRONTEND-REACT"
    ],
    location: [
      "India - Gurugram, Haryana",
      "India - WFA"
    ]
  },

  // Qualification Rules
  rules: {
    frontendKeywords: [
      "frontend", "front-end", "front end", "react", "reactjs", "react.js",
      "angular", "angularjs", "angular2x", "vue", "vuejs", "typescript",
      "javascript", "html", "css", "nextjs", "next.js", "redux", "svelte"
    ],
    pythonKeywords: [
      "python", "django", "fastapi", "flask", "pandas", "numpy", "pydantic"
    ]
  },

  // Candidate Profile & Resume Settings
  candidateProfile: {
    resumePath: process.env.RESUME_PATH || (fs.existsSync("/Users/pnkj/Downloads/Resume-3177277-pankaj.kumar07@nagarro.com-2026.09.18-20.16.29.docx") ? "/Users/pnkj/Downloads/Resume-3177277-pankaj.kumar07@nagarro.com-2026.09.18-20.16.29.docx" : path.join(__dirname, "resume.docx")),
    resumeFileName: "Resume-3177277-pankaj.kumar07@nagarro.com-2026.09.18-20.16.29.docx",
    checkAllMustHaveSkills: true,
    useAiPitchGenerator: true
  },

  // Environments
  environments: {
    mock: {
      baseUrl: "http://localhost:3000",
      authHeader: null
    },
    prod: {
      baseUrl: "https://opportunistic-placement.azurewebsites.net",
      authToken: process.env.AUTH_TOKEN || null
    }
  }
};
