# Running the Demand Automator on AWS (24/7 Cloud Execution)

This guide shows you how to run the automation continuously on AWS so it operates even when your computer is completely turned off.

---

## The Recommended Approach: AWS EC2 with PM2 (Free Tier)

An **AWS EC2 `t3.micro`** or **`t4g.nano`** instance is ideal for this:
- **Cost**: **$0.00 / Free** (Eligible for AWS 12-Month Free Tier).
- **Process Manager**: **PM2** ensures the worker stays alive 24/7, restarts automatically on unexpected failures, and boots up on server restarts.

---

### Step 1: Launch an EC2 Instance

1. Log into your **AWS Management Console** and navigate to **EC2**.
2. Click **Launch Instance**:
   - **Name**: `demand-automator`
   - **OS**: Amazon Linux 2023 (or Ubuntu 22.04 LTS)
   - **Instance Type**: `t3.micro` (or `t4g.nano`)
   - **Key Pair**: Select or create a `.pem` key pair (e.g. `my-key.pem`) to SSH into the machine.
3. Click **Launch Instance**.

---

### Step 2: Connect to your EC2 Instance

Open Terminal on your Mac and SSH into the instance:
```bash
chmod 400 my-key.pem
ssh -i my-key.pem ec2-user@<YOUR-EC2-PUBLIC-IP>
```

---

### Step 3: Install Node.js & PM2

Run the following commands inside your EC2 terminal:
```bash
# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Install PM2 (Process Manager)
sudo npm install -g pm2

# Verify installation
node -v
pm2 -v
```

---

### Step 4: Transfer Project Files to EC2

From your **local Mac terminal**, copy the project folder and resume to your EC2 instance:
```bash
scp -i my-key.pem -r "/Users/pnkj/Practice/bench automation" ec2-user@<YOUR-EC2-PUBLIC-IP>:~/bench-automation
```

---

### Step 5: How to Get Your Azure Authentication Token

Because the production site is protected by corporate Azure AD (Microsoft login):
1. In Chrome, go to `https://opportunistic-placement.azurewebsites.net/demands` and log in.
2. Press `F12` or `Cmd+Option+I` to open Developer Tools -> click the **Network** tab.
3. Click the "Apply Filter" button to trigger a network call.
4. Find the request named **`fetchDemands`**.
5. Click it, scroll down to **Request Headers**, and copy the value of `Authorization`:
   `Bearer eyJ0eXAiOiJKV1QiLC...`
6. Copy the token string (the part after `Bearer `).

---

### Step 6: Start the 24/7 Worker on AWS

In your **EC2 SSH terminal**:
```bash
cd ~/bench-automation

# Start the worker with PM2 and pass your token
pm2 start worker.js --name "demand-automator" -- --target=prod --token="YOUR_AZURE_BEARER_TOKEN"

# Ensure it starts automatically if the EC2 instance reboots
pm2 save
pm2 startup
```

---

### Step 7: Monitoring & Useful Commands

```bash
# View live streaming logs
pm2 logs demand-automator

# Check status
pm2 status

# Stop or restart the automator
pm2 stop demand-automator
pm2 restart demand-automator
```

Now you can close your terminal and turn off your laptop — the worker will continue querying Azure, filtering roles, and submitting applications every 30 seconds uninterrupted.
