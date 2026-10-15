// Initial Mock Data representing the Opportunistic Placement portal

export function getInitialMockDemands() {
  return [
    {
      demandId: "DEM-40912",
      genus: "3.1-FRONTEND-REACT",
      businessUnit: "Financial Services",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Looking for an experienced React developer to build complex, responsive micro-frontend applications for global banking clients. Strong focus on modern state management, high performance, and accessibility.",
      additionalSkills: ["React", "TypeScript", "Redux Toolkit", "Webpack", "Jest"],
      interestCount: 3,
      interested: false,
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
    },
    {
      demandId: "DEM-40913",
      genus: "2.2-PYTHON",
      businessUnit: "Cloud Engineering",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Python backend engineer needed to develop RESTful APIs and asynchronous data processing pipelines using FastAPI, PostgreSQL, and Redis. AWS experience is a plus.",
      additionalSkills: ["Python", "FastAPI", "PostgreSQL", "Docker", "Redis"],
      interestCount: 5,
      interested: false,
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 4).toISOString()
    },
    {
      demandId: "DEM-40914",
      genus: "3.2-FRONTEND-REACT",
      businessUnit: "Digital Health",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Full stack / Frontend heavy role developing patient engagement portals using React alongside Python backend microservices. Needs strong component architecture and API integration.",
      additionalSkills: ["React", "Python", "TypeScript", "Next.js", "REST APIs"],
      interestCount: 1,
      interested: false,
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 6).toISOString()
    },
    {
      demandId: "DEM-40915",
      genus: "3.1-FRONTEND-ANGULAR2X",
      businessUnit: "Telecom Media",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Seeking an Angular developer skilled in Angular 15+, RxJS, and PrimeNG to build enterprise customer self-service portals with clean modular architecture.",
      additionalSkills: ["Angular", "RxJS", "TypeScript", "HTML5/SCSS", "PrimeNG"],
      interestCount: 2,
      interested: false,
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 8).toISOString()
    },
    {
      demandId: "DEM-40916",
      genus: "3.1-PYTHON",
      businessUnit: "Data Analytics",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Core Python developer responsible for backend ETL services and data ingestion microservices using Django and Celery.",
      additionalSkills: ["Python", "Django", "Celery", "PostgreSQL"],
      interestCount: 6,
      interested: false,
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 12).toISOString()
    },
    {
      demandId: "DEM-40917",
      genus: "3.3-FRONTEND-REACT",
      businessUnit: "Automotive Commerce",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Senior React Engineer to lead frontend development for multi-tenant ecommerce web applications. (You have already applied for this role previously).",
      additionalSkills: ["React", "TypeScript", "Redux", "GraphQL"],
      interestCount: 8,
      interested: true, // Already applied!
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 18).toISOString()
    },
    {
      demandId: "DEM-40918",
      genus: "4.1-FRONTEND-REACT",
      businessUnit: "Energy & Utilities",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Staff Frontend Architect required to guide design system architecture, state management strategies, and frontend performance across teams.",
      additionalSkills: ["React", "Architecture", "Micro Frontends", "TypeScript", "Vite"],
      interestCount: 0,
      interested: false,
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 20).toISOString()
    },
    {
      demandId: "DEM-40919",
      genus: "2.3-PYTHON",
      businessUnit: "Platform Services",
      location: "India - Gurugram, Haryana, India - WFA",
      jobDescription: "Pure backend Python scripting and automation role for devops pipelines and test infrastructure.",
      additionalSkills: ["Python", "PyTest", "Bash", "Linux"],
      interestCount: 4,
      interested: false,
      country: "India",
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString()
    }
  ];
}
