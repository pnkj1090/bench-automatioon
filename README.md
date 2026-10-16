# ⚡ Opportunistic Placement Automation Suite

An enterprise-grade, autonomous cloud monitoring and candidate placement suite for the Nagarro Opportunistic Placement portal (`https://opportunistic-placement.azurewebsites.net/demands`).

Built to run 24/7 on AWS EC2 with autonomous Azure AD session renewal, business-hours scheduling, intelligent role classification, dynamic pitch generation, instant mobile push alerts (ntfy.sh), and an encrypted zero-exposure management dashboard.

---

## 🌟 Key Architecture & Features

### 1. 🕒 Business Hours Scheduler (Mon–Fri, 8 AM – 8 PM IST)
- Operates strictly during business hours (**Monday through Friday, 8:00 AM to 8:00 PM IST**).
- Automatically enters low-resource standby mode overnight and across weekends (Saturday & Sunday).
- Configurable directly in `config.js`.

### 2. 🔄 Autonomous 24/7 Azure AD Session Renewal (`renew-session-headless.js`)
- **Proactive Headless Renewer**: Every 20 hours, a headless Chromium browser on EC2 opens the portal with persistent Microsoft Entra ID session cookies (`ESTSAUTHPERSISTENT`), resets the 24-hour Single Page App (SPA) token window, and extracts fresh tokens.
- **Fast 45-Minute OAuth Rotation**: Rotates access tokens every 45 minutes using standard OAuth2 refresh grants.
- **Reactive Self-Healing**: If any `401 Unauthorized` or `AADSTS700084` occurs, the engine triggers the headless browser immediately, re-authenticates, and retries seamlessly without failing scans.

### 3. 🎯 Smart Role Classifier (`classifier.js`)
Evaluates opportunities against candidate skills and genus levels:
| Demand Role Profile | Qualification | Engine Action |
| :--- | :---: | :--- |
| **Frontend Alone** (React, Angular, Vue, Web) | ✅ Qualified | **APPLY** with tailored pitch & resume |
| **Frontend + Python Combined** | ✅ Qualified | **APPLY** with tailored pitch & resume |
| **Python Only** (e.g. Backend FastAPI/Django only) | 🚫 Disqualified | **SKIP** (Logs reason, leaves untouched) |
| **Already Applied / Under Review** | ⏭️ Skipped | **SKIP** (Prevents duplicate submissions) |

### 4. 📝 Human-Sounding AI Pitch & Authentic Resume Upload
- **Pitch Generator**: Generates customized candidate pitches (< 1,000 characters) emphasizing relevant frontend and full-stack capabilities in natural, professional language.
- **Skill Checklist**: Automatically verifies and checks 100% of required must-have skills on the application modal.
- **Resume Submission**: Direct multi-part form attachment of authentic `.docx` resume.

### 5. 🔔 Instant Mobile Push Alerts (`ntfy.js`)
- Integrates with [ntfy.sh](https://ntfy.sh) to send instant push notifications directly to your phone lock screen with sound whenever an eligible demand is auto-applied.
- Zero signup, zero API keys, 100% free forever.
- Configurable directly from the web dashboard.

### 6. 🔒 Zero-Exposure Security Model
- **No Public Web Endpoints**: The management dashboard binds strictly to `127.0.0.1:3000` (loopback only) on the cloud instance. Public inbound port 3000 is permanently closed on the AWS Security Group.
- **Encrypted SSH Tunneling**: Accessible from your local machine via an encrypted tunnel (`./open-dashboard.sh`), opening `http://localhost:3000` securely.
- **Hardened Permissions**: Token storage (`token.txt`, `refresh-token.txt`) is restricted with Unix `chmod 600`.
- **Git Shield**: Private keys (`*.pem`), tokens, session cookies (`auth-state.json`), `.env` files, deployment metadata, and personal resume files (`*.docx`) are strictly ignored via `.gitignore`.

---

## 🚀 Step-by-Step Guide: Deploying on Your Own AWS Account

Follow these steps to run this automation suite 24/7 on your own AWS account:

### Step 1: Personalize Your Candidate Profile

1. **Replace the Resume**:
   - Place your authentic resume in the root folder as `resume.docx` (replacing the existing file).
2. **Update Pitch & Experience**:
   - In `ai-pitch-generator.js`, customize your role title (e.g. *Senior Software Engineer*, *Lead Consultant*), years of experience, and primary skill specializations.
3. **Review Role Filters**:
   - In `config.js`, customize `CONFIG.filters.genus`, `CONFIG.filters.location`, and `CONFIG.rules` to match your targeted roles.

---

### Step 2: Deploy to AWS EC2

You can deploy using either the automated script or manual console setup:

#### Option A: Automated Provisioning Script
1. Export your AWS credentials in your terminal:
   ```bash
   export AWS_ACCESS_KEY_ID="YOUR_ACCESS_KEY"
   export AWS_SECRET_ACCESS_KEY="YOUR_SECRET_KEY"
   export AWS_REGION="ap-south-1" # Or your preferred AWS region
   ```
2. Run the deployment script:
   ```bash
   node deploy-to-aws.js
   ```
   *This automatically provisions the EC2 instance, security group, SSH key pair (`demand-automator-key.pem`), and transfers the project files.*

#### Option B: Manual AWS Console Launch
1. Launch an EC2 instance:
   - **Name**: `demand-automator`
   - **AMI**: Amazon Linux 2023
   - **Instance Type**: `t3.micro` (or `t2.micro`)
   - **Storage**: 8 GB gp3 SSD
   - **Key Pair**: Download your `.pem` key (e.g. `demand-automator-key.pem`)
   - **Security Group Inbound Rules**:
     - Port `22` (SSH) — restricted to your IP
2. SSH into your instance:
   ```bash
   chmod 400 demand-automator-key.pem
   ssh -i demand-automator-key.pem ec2-user@<YOUR_EC2_PUBLIC_IP>
   ```
3. Install Node.js 18+ and PM2:
   ```bash
   sudo dnf install -y nodejs
   sudo npm install -g pm2
   ```
4. Transfer project files to `/home/ec2-user/bench-automation/`.

---

### Step 3: Configure EC2 for Headless Browser (Crucial)

Because `t3.micro` has 1 GB RAM, configure swap memory and system libraries to ensure Chromium runs reliably without hitting Linux OOM killer:

Inside your EC2 SSH session:
```bash
# 1. Enable 2 GB swap space
sudo dd if=/dev/zero of=/swapfile bs=128M count=16
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab

# 2. Install Chromium native system shared libraries
sudo dnf install -y atk at-spi2-atk libX11 libXcomposite libXdamage libXext libXfixes libXrandr mesa-libgbm libxcb libxkbcommon alsa-lib at-spi2-core nss pango cups-libs

# 3. Install project dependencies and Playwright Chromium
cd /home/ec2-user/bench-automation
npm install
npx playwright install chromium
```

---

### Step 4: 1-Time Session Synchronization (Laptop -> EC2)

To enable autonomous cloud renewal, the EC2 instance needs Microsoft's persistent SSO cookie (`ESTSAUTHPERSISTENT`):

1. On your local laptop, open `sync-session-to-ec2.js` and ensure `EC2_HOST` matches your EC2 public IP.
2. Run the synchronizer script:
   ```bash
   node sync-session-to-ec2.js
   ```
3. A browser window opens on your screen. Sign in with your corporate Microsoft SSO credentials and select **"Stay signed in: Yes"**.
4. The script automatically captures your persistent session cookies, uploads `auth-state.json` to your EC2 instance, and executes a verification test.

---

### Step 5: Start 24/7 PM2 Daemons on EC2

In your EC2 SSH terminal:
```bash
cd /home/ec2-user/bench-automation

# Start the scanner daemon and web dashboard
pm2 start worker.js --name "prod-automator" -- --target=prod
pm2 start dashboard.js --name "web-dashboard"

# Install log rotation to keep disk usage under control
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5

# Ensure PM2 services restart automatically across server reboots
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user
```

---

### Step 6: Access the Dashboard & Configure Alerts

1. From your local Mac/PC, run:
   ```bash
   ./open-dashboard.sh
   ```
   This creates an encrypted SSH tunnel and opens `http://localhost:3000` in your browser.
2. (Optional) To enable Mobile Push Alerts:
   - Click **🔔 Push Alerts** in the top navigation.
   - Enter any unique topic name (e.g. `pankaj-nagarro-alerts`).
   - Open the free **ntfy** app on your phone, subscribe to the same topic, and tap **Send Test**.

---

## 💰 Monthly AWS Cost Breakdown

Running continuously on AWS in `ap-south-1` (Mumbai):

| Resource | Rate | Monthly Cost (USD) | Monthly Cost (INR) |
| :--- | :--- | :--- | :--- |
| **EC2 `t3.micro`** (720 hrs/mo) | $0.0104 / hr | $7.49 | ~₹625 |
| **Public IPv4 Address** | $0.0050 / hr | $3.60 | ~₹300 |
| **8 GB gp3 SSD Disk** | $0.08 / GB-mo | $0.64 | ~₹53 |
| **Data Transfer Egress** | First 100 GB/mo free | $0.00 | ₹0 |
| **Total (Standard On-Demand)** | | **~$11.73 / month** | **~₹975 / month** |
| **Total (AWS 12-Month Free Tier)** | | **$0.00 / month** | **₹0 (100% Free)** |

*Daily run rate: ~$0.39 / day (~₹32 / day).*

---

## 📁 Repository Structure

```text
├── config.js                 # Global settings (Schedule, targets, poll intervals)
├── engine.js                 # Autonomous cloud production runner & API client
├── renew-token.js            # Microsoft Entra ID OAuth2 token renewal service
├── renew-session-headless.js # Autonomous 24/7 headless browser token renewer
├── sync-session-to-ec2.js    # 1-time session state synchronizer (Laptop -> EC2)
├── dashboard.js              # Private monitoring dashboard server (localhost:3000)
├── classifier.js             # Intelligent role classification (Frontend vs Python)
├── ai-pitch-generator.js     # Context-aware candidate pitch synthesis
├── ntfy.js                   # Instant mobile push alert integration (ntfy.sh)
├── whatsapp.js               # Backward-compatible proxy to ntfy.js
├── open-dashboard.sh         # One-click SSH tunnel to access cloud dashboard locally
├── deploy-to-aws.js          # Automated EC2 provisioner and deployment orchestrator
├── ecosystem.config.cjs      # PM2 process configuration for production
├── server.js                 # Local mock portal backend (for offline testing)
├── mock-service.js           # Mock API service simulator
├── mock-data.js              # Initial mock opportunities and demand fixtures
├── public/                   # Web dashboard UI assets (HTML, CSS, JS)
├── resume.docx               # Authentic candidate resume submitted with applications
├── Dockerfile                # Containerized deployment definition
└── AWS_DEPLOYMENT.md         # Additional AWS architecture and deployment notes
```

---

## 📄 License
Private & Confidential. Intended solely for personal career automation and opportunistic placement monitoring.
