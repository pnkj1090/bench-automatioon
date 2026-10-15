# ⚡ Opportunistic Placement Automation Suite

An enterprise-grade, autonomous cloud monitoring and candidate placement suite for the Nagarro Opportunistic Placement portal (`https://opportunistic-placement.azurewebsites.net/demands`).

Built to run 24/7 on AWS EC2 with autonomous Azure AD session renewal, business-hours scheduling, intelligent role classification, dynamic pitch generation, and an encrypted zero-exposure management dashboard.

---

## 🌟 Key Architecture & Features

### 1. 🕒 Business Hours Scheduler (Mon–Fri, 8 AM – 8 PM IST)
- Operates strictly during business hours (**Monday through Friday, 8:00 AM to 8:00 PM IST**).
- Automatically enters low-resource standby mode overnight and across weekends (Saturday & Sunday).
- Configurable directly in `config.js`.

### 2. 🔄 Autonomous Azure AD Token Renewal (`renew-token.js`)
- Directly interfaces with **Microsoft Entra ID** (`login.microsoftonline.com`) using Azure AD Refresh Tokens.
- Automatically refreshes the OAuth2 bearer access token every 45 minutes.
- Implements immediate 401 retry loops: if a token expires mid-cycle, the engine pauses, fetches a fresh token, and resumes seamlessly.
- Eliminates manual browser token extraction.

### 3. 🎯 Smart Role Classifier (`classifier.js`)
Evaluates opportunities against candidate skills and genus levels:
| Demand Role Profile | Qualification | Engine Action |
| :--- | :---: | :--- |
| **Frontend Alone** (React, Angular, Vue, Web) | ✅ Qualified | **APPLY** with tailored pitch & resume |
| **Frontend + Python Combined** | ✅ Qualified | **APPLY** with tailored pitch & resume |
| **Python Only** (e.g. Backend FastAPI/Django only) | 🚫 Disqualified | **SKIP** (Logs reason, leaves untouched) |
| **Already Applied / Under Review** | ⏭️ Skipped | **SKIP** (Prevents duplicate submissions) |

### 4. 📝 AI Pitch & Authentic Resume Upload
- **Pitch Generator**: Generates customized candidate pitches (< 1,000 characters) emphasizing relevant frontend and full-stack capabilities without exaggeration.
- **Skill Checklist**: Automatically verifies and checks 100% of required must-have skills on the application modal.
- **Resume Submission**: Direct multi-part form attachment of authentic `.docx` resume.

### 5. 🔒 Zero-Exposure Security Model
- **No Public Web Endpoints**: The management dashboard binds strictly to `127.0.0.1:3000` (loopback only) on the cloud instance. Public inbound port 3000 is permanently closed on the AWS Security Group.
- **Encrypted SSH Tunneling**: Accessible from your local machine via an encrypted tunnel (`./open-dashboard.sh`), opening `http://localhost:3000` securely.
- **Hardened Permissions**: Token storage (`token.txt`, `refresh-token.txt`) is restricted with Unix `chmod 600`.
- **Git Shield**: Private keys (`*.pem`), tokens, `.env` files, deployment metadata, and personal resume files (`*.docx`) are strictly ignored via `.gitignore`.

---

## 📁 Repository Structure

```text
├── config.js                 # Global settings (Schedule, targets, poll intervals)
├── engine.js                 # Autonomous cloud production runner & API client
├── renew-token.js            # Microsoft Entra ID OAuth2 token renewal service
├── dashboard.js              # Private monitoring dashboard server (localhost:3000)
├── classifier.js             # Intelligent role classification (Frontend vs Python)
├── ai-pitch-generator.js     # Context-aware candidate pitch synthesis
├── open-dashboard.sh         # One-click SSH tunnel to access cloud dashboard locally
├── deploy-to-aws.js          # Automated EC2 provisioner and deployment orchestrator
├── ecosystem.config.cjs      # PM2 process configuration for production
├── server.js                 # Local mock portal backend (for offline testing)
├── mock-service.js           # Mock API service simulator
├── mock-data.js              # Initial mock opportunities and demand fixtures
├── public/                   # Web dashboard UI assets (HTML, CSS, JS)
├── prod-automator.js         # Browser DevTools fallback console script
├── Dockerfile                # Containerized deployment definition
└── AWS_DEPLOYMENT.md         # Detailed AWS architecture and operational notes
```

---

## ⚙️ Configuration (`config.js`)

Key parameters can be customized in `config.js`:

```javascript
export default {
  // Operational Schedule (IST / Asia/Kolkata)
  schedule: {
    enabled: true,
    timezone: "Asia/Kolkata",
    activeDays: [1, 2, 3, 4, 5], // Monday (1) to Friday (5)
    activeStartHour: 8,          // 8:00 AM IST
    activeEndHour: 20            // 8:00 PM IST
  },

  // Target Filters
  targetLocations: ["India - Gurugram, Haryana", "India - WFA"],
  targetGenus: [
    "2.1-PYTHON", "2.2-PYTHON", "2.3-PYTHON", "3.1-PYTHON", "3.2-PYTHON",
    "3.1-FRONTEND-ANGULAR2X", "3.1-FRONTEND-ANGULARJS", "3.1-FRONTEND-REACT",
    "3.2-FRONTEND-ANGULAR2X", "3.2-FRONTEND-ANGULARJS", "3.2-FRONTEND-REACT",
    "3.3-FRONTEND-ANGULAR2X", "3.3-FRONTEND-REACT",
    "4.1-FRONTEND-ANGULAR2X", "4.1-FRONTEND-REACT",
    "4.2-FRONTEND-ANGULAR2X", "4.2-FRONTEND-REACT"
  ],

  // Engine Polling Interval
  pollIntervalMs: 30000 // 30 seconds
};
```

---

## 🚀 Cloud Operations & Management

The system runs on an AWS EC2 instance managed by **PM2**:

### 1. View Dashboard Securely (from your local Mac)
Run the launcher script:
```bash
./open-dashboard.sh
```
This opens an encrypted tunnel and launches `http://localhost:3000` in your browser.

### 2. Connect to the Cloud Server via SSH
```bash
ssh -i demand-automator-key.pem ec2-user@<YOUR_EC2_PUBLIC_IP>
```

### 3. Manage PM2 Background Services
```bash
# Check status of running services
pm2 status

# View live real-time automation logs
pm2 logs prod-automator

# View token auto-refresher logs
pm2 logs renew-token

# Restart all services
pm2 restart all
```

---

## 🧪 Local Testing & Mock Mode

To test changes offline without touching production APIs:

1. **Start Mock Portal**:
   ```bash
   npm run mock:server
   ```
2. **Run Automation Worker against Mock Portal**:
   ```bash
   npm run worker:mock
   ```
3. Open `http://localhost:3000` to interact with simulated demands, test job injections, and inspect candidate submissions.

---

## 📄 License
Private & Confidential. Intended solely for personal career automation and opportunistic placement monitoring.
