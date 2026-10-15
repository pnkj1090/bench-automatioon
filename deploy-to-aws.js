import { 
  EC2Client, 
  DescribeSecurityGroupsCommand, 
  CreateSecurityGroupCommand, 
  AuthorizeSecurityGroupIngressCommand,
  DescribeKeyPairsCommand,
  CreateKeyPairCommand,
  DeleteKeyPairCommand,
  RunInstancesCommand,
  DescribeInstancesCommand
} from '@aws-sdk/client-ec2';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';

dotenv.config({ path: path.join(os.homedir(), '.env') });

const REGION = 'ap-south-1'; // Mumbai
const KEY_NAME = 'demand-automator-key';
const SG_NAME = 'demand-automator-sg';
const PEM_PATH = path.join(process.cwd(), `${KEY_NAME}.pem`);

const ec2 = new EC2Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim()
  }
});

const delay = ms => new Promise(r => setTimeout(r, ms));

async function getOrCreateSecurityGroup() {
  console.log(`[AWS] Checking Security Group '${SG_NAME}'...`);
  try {
    const res = await ec2.send(new DescribeSecurityGroupsCommand({
      GroupNames: [SG_NAME]
    }));
    const sgId = res.SecurityGroups[0].GroupId;
    console.log(`[AWS] Found existing Security Group: ${sgId}`);
    return sgId;
  } catch (err) {
    if (err.name === 'InvalidGroup.NotFound') {
      console.log(`[AWS] Creating new Security Group '${SG_NAME}'...`);
      const createRes = await ec2.send(new CreateSecurityGroupCommand({
        GroupName: SG_NAME,
        Description: 'Security group for 24/7 Demand Automator (SSH & Port 3000)'
      }));
      const sgId = createRes.GroupId;

      // Authorize SSH (22) and Port 3000
      await ec2.send(new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH access' }]
          },
          {
            IpProtocol: 'tcp',
            FromPort: 3000,
            ToPort: 3000,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'Dashboard access' }]
          }
        ]
      }));
      console.log(`[AWS] Created and configured Security Group: ${sgId}`);
      return sgId;
    }
    throw err;
  }
}

async function getOrCreateKeyPair() {
  console.log(`[AWS] Checking Key Pair '${KEY_NAME}'...`);
  const pemExists = fs.existsSync(PEM_PATH);

  try {
    const res = await ec2.send(new DescribeKeyPairsCommand({
      KeyNames: [KEY_NAME]
    }));

    if (pemExists) {
      console.log(`[AWS] Found existing Key Pair and local .pem file.`);
      return KEY_NAME;
    } else {
      console.log(`[AWS] Remote key exists but local .pem missing. Recreating key pair...`);
      await ec2.send(new DeleteKeyPairCommand({ KeyName: KEY_NAME }));
    }
  } catch (err) {
    if (err.name !== 'InvalidKeyPair.NotFound') {
      throw err;
    }
  }

  console.log(`[AWS] Generating new Key Pair '${KEY_NAME}'...`);
  const createRes = await ec2.send(new CreateKeyPairCommand({
    KeyName: KEY_NAME,
    KeyType: 'rsa',
    KeyFormat: 'pem'
  }));

  fs.writeFileSync(PEM_PATH, createRes.KeyMaterial, { mode: 0o400 });
  execSync(`chmod 400 "${PEM_PATH}"`);
  console.log(`[AWS] Key Pair saved to ${PEM_PATH} (permissions 400).`);
  return KEY_NAME;
}

async function launchInstance(sgId, keyName) {
  const AMI_ID = 'ami-0cede6fe40e6ac719'; // Amazon Linux 2023 x86_64 in ap-south-1
  console.log(`[AWS] Launching Free Tier t3.micro instance with AMI ${AMI_ID}...`);

  const userDataScript = `#!/bin/bash
dnf update -y
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs git
npm install -g pm2
mkdir -p /home/ec2-user/bench-automation
chown -R ec2-user:ec2-user /home/ec2-user/bench-automation
echo "BOOTSTRAP_COMPLETE" > /tmp/bootstrap.log
`;

  const runRes = await ec2.send(new RunInstancesCommand({
    ImageId: AMI_ID,
    InstanceType: 't3.micro',
    MinCount: 1,
    MaxCount: 1,
    KeyName: keyName,
    SecurityGroupIds: [sgId],
    UserData: Buffer.from(userDataScript).toString('base64'),
    TagSpecifications: [
      {
        ResourceType: 'instance',
        Tags: [
          { Key: 'Name', Value: 'demand-automator-247' },
          { Key: 'Project', Value: 'BenchAutomation' }
        ]
      }
    ]
  }));

  const instanceId = runRes.Instances[0].InstanceId;
  console.log(`[AWS] Instance created: ${instanceId}. Waiting for public IP...`);
  return instanceId;
}

async function waitForRunningInstance(instanceId) {
  let publicIp = null;
  while (!publicIp) {
    await delay(5000);
    const res = await ec2.send(new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    }));
    const inst = res.Reservations[0].Instances[0];
    const state = inst.State.Name;
    console.log(`[AWS] Instance state: ${state}...`);
    if (state === 'running' && inst.PublicIpAddress) {
      publicIp = inst.PublicIpAddress;
    }
  }
  console.log(`[AWS] Instance is RUNNING with Public IP: ${publicIp}`);
  return publicIp;
}

async function main() {
  console.log("====================================================");
  console.log("🚀 AUTONOMOUS AWS CLOUD DEPLOYMENT INITIATED");
  console.log("   Region: ap-south-1 (Mumbai)");
  console.log("   Tier: AWS Free Tier (t3.micro)");
  console.log("====================================================\n");

  const sgId = await getOrCreateSecurityGroup();
  const keyName = await getOrCreateKeyPair();
  const instanceId = await launchInstance(sgId, keyName);
  const publicIp = await waitForRunningInstance(instanceId);

  console.log("\n====================================================");
  console.log(`🎉 AWS EC2 INSTANCE DEPLOYED SUCCESSFULLY!`);
  console.log(`   Instance ID : ${instanceId}`);
  console.log(`   Public IP   : ${publicIp}`);
  console.log(`   SSH Key     : ${PEM_PATH}`);
  console.log(`   SSH Command : ssh -i "${PEM_PATH}" ec2-user@${publicIp}`);
  console.log("====================================================\n");

  fs.writeFileSync('aws-deployment-info.json', JSON.stringify({
    instanceId,
    publicIp,
    region: REGION,
    keyName,
    pemPath: PEM_PATH,
    deployedAt: new Date().toISOString()
  }, null, 2));

  console.log("Saved deployment details to aws-deployment-info.json");
}

main().catch(err => {
  console.error("❌ DEPLOYMENT FAILED:", err);
  process.exit(1);
});
