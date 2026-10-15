// Frontend Application Logic for Opportunistic Placement Clone & Automation Dashboard

const GENUS_OPTIONS = [
  "2.1-PYTHON", "2.2-PYTHON", "2.3-PYTHON",
  "3.1-FRONTEND-ANGULAR2X", "3.1-FRONTEND-ANGULARJS", "3.1-FRONTEND-REACT",
  "3.1-PYTHON", "3.2-PYTHON", "3.2-FRONTEND-ANGULAR2X", "3.2-FRONTEND-ANGULARJS",
  "3.2-FRONTEND-REACT", "3.3-FRONTEND-ANGULAR2X", "3.3-FRONTEND-REACT",
  "4.1-FRONTEND-ANGULAR2X", "4.1-FRONTEND-REACT",
  "4.2-FRONTEND-ANGULAR2X", "4.2-FRONTEND-REACT"
];

let selectedGenus = [...GENUS_OPTIONS];
let selectedLocation = ["India - Gurugram, Haryana, India - WFA"];
let currentDemands = [];
let activeModalDemand = null;

// Countdown timer tracking
let countdownSeconds = 30;
let countdownTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  loadDemands();
  initAutomationControls();
  startStatusPolling();
  startCountdown();
});

// 1. Initialize Filters & Dropdowns
function initFilters() {
  const genusListEl = document.getElementById('genusOptionsList');
  genusListEl.innerHTML = GENUS_OPTIONS.map(g => `
    <label class="check-item">
      <input type="checkbox" value="${g}" checked class="genus-checkbox">
      <span>${g}</span>
    </label>
  `).join('');

  // Toggle Popups
  const genusBox = document.getElementById('genusBox');
  const genusPopup = document.getElementById('genusPopup');
  const locationBox = document.getElementById('locationBox');
  const locationPopup = document.getElementById('locationPopup');

  genusBox.querySelector('.select-display').addEventListener('click', (e) => {
    e.stopPropagation();
    genusPopup.classList.toggle('show');
    locationPopup.classList.remove('show');
  });

  locationBox.querySelector('.select-display').addEventListener('click', (e) => {
    e.stopPropagation();
    locationPopup.classList.toggle('show');
    genusPopup.classList.remove('show');
  });

  document.addEventListener('click', () => {
    genusPopup.classList.remove('show');
    locationPopup.classList.remove('show');
  });

  genusPopup.addEventListener('click', e => e.stopPropagation());
  locationPopup.addEventListener('click', e => e.stopPropagation());

  // Checkbox changes
  genusListEl.addEventListener('change', () => {
    const checked = Array.from(document.querySelectorAll('.genus-checkbox:checked')).map(cb => cb.value);
    selectedGenus = checked;
    updateGenusSummary();
  });

  document.getElementById('selectAllGenusBtn').addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.genus-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    selectedGenus = allChecked ? [] : [...GENUS_OPTIONS];
    updateGenusSummary();
  });

  document.getElementById('applyFiltersBtn').addEventListener('click', () => {
    genusPopup.classList.remove('show');
    locationPopup.classList.remove('show');
    loadDemands();
  });

  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    selectedGenus = [...GENUS_OPTIONS];
    document.querySelectorAll('.genus-checkbox').forEach(cb => cb.checked = true);
    updateGenusSummary();
    loadDemands();
  });
}

function updateGenusSummary() {
  const summaryEl = document.querySelector('#genusDisplay .selected-summary');
  if (selectedGenus.length === 0) {
    summaryEl.textContent = 'None selected';
  } else if (selectedGenus.length === GENUS_OPTIONS.length) {
    summaryEl.textContent = `${selectedGenus.slice(0, 3).join(', ')}... (+${selectedGenus.length - 3})`;
  } else {
    summaryEl.textContent = `${selectedGenus.slice(0, 2).join(', ')}... (${selectedGenus.length} selected)`;
  }
}

// 2. Fetch and Render Demands
async function loadDemands() {
  try {
    const res = await fetch('/api/demand/fetchDemands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genus: selectedGenus,
        location: selectedLocation
      })
    });
    const data = await res.json();
    currentDemands = data.content || [];
    renderDemandsGrid(currentDemands);
  } catch (err) {
    console.error('Failed to load demands:', err);
  }
}

function renderDemandsGrid(demands) {
  const grid = document.getElementById('demandsGrid');
  const countEl = document.getElementById('feedCount');
  countEl.textContent = `Showing ${demands.length} demands`;

  if (demands.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: #fff; border-radius: 12px;">
        <h3>No matching demands found</h3>
        <p style="color: #64748b; font-size: 0.9rem;">Try adjusting the Genus or Location filter above.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = demands.map(d => {
    const isApplied = d.interested === true;
    const skills = Array.isArray(d.additionalSkills) ? d.additionalSkills : [];
    
    return `
      <div class="demand-card ${isApplied ? 'is-applied' : ''}" data-id="${d.demandId}">
        <div class="card-header-bar">
          <div class="demand-id-badge">${d.demandId}</div>
          <h4 class="job-genus-title">${d.genus}</h4>
          <div class="meta-row">
            <span class="meta-badge">${d.businessUnit || 'Client Services'}</span>
            <span class="location-meta">📍 ${d.location}</span>
          </div>
        </div>

        <div class="card-divider"></div>

        <div class="card-body">
          <div>
            <div class="section-label">Overview</div>
            <p class="overview-text">${d.jobDescription || 'No description provided.'}</p>
          </div>

          <div>
            <div class="section-label">Must Have Skills</div>
            <div class="skills-wrapper">
              ${skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
            </div>
          </div>
        </div>

        <div class="card-footer">
          <span class="interested-meta">
            👥 ${d.interestCount || 0} interested
          </span>
          <button class="apply-btn ${isApplied ? 'applied' : ''}" 
                  ${isApplied ? 'disabled' : ''} 
                  onclick="openApplyModal('${d.demandId}')">
            ${isApplied ? '✓ Applied' : 'Apply Now'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// 3. Automation Controls & Telemetry
function initAutomationControls() {
  const toggleBtn = document.getElementById('toggleEngineBtn');
  const tickBtn = document.getElementById('tickNowBtn');
  const resetBtn = document.getElementById('resetMockBtn');
  const toggleLogsBtn = document.getElementById('toggleLogsBtn');
  const logsDrawer = document.getElementById('logsDrawer');
  const closeLogsBtn = document.getElementById('closeLogsBtn');
  const targetSelect = document.getElementById('targetEnvSelect');

  // Toggle Start / Stop
  toggleBtn.addEventListener('click', async () => {
    const isPaused = toggleBtn.querySelector('#btnText').textContent.includes('Start');
    const endpoint = isPaused ? '/api/automation/start' : '/api/automation/stop';
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: targetSelect.value })
    });
    fetchStatus();
  });

  // Manual Tick
  tickBtn.addEventListener('click', async () => {
    tickBtn.disabled = true;
    tickBtn.textContent = '⏳ Checking...';
    await fetch('/api/automation/tick', { method: 'POST' });
    countdownSeconds = 30;
    await fetchStatus();
    await loadDemands();
    tickBtn.disabled = false;
    tickBtn.textContent = '⚡ Trigger Check Now';
  });

  // Reset Mock Data
  resetBtn.addEventListener('click', async () => {
    await fetch('/api/mock/reset', { method: 'POST' });
    await fetchStatus();
    await loadDemands();
  });

  // Toggle Logs
  toggleLogsBtn.addEventListener('click', () => {
    logsDrawer.classList.toggle('open');
  });

  closeLogsBtn.addEventListener('click', () => {
    logsDrawer.classList.remove('open');
  });

  // Scenario Injectors
  document.getElementById('addFrontendJobBtn').addEventListener('click', async () => {
    await fetch('/api/mock/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genus: "3.2-FRONTEND-REACT",
        businessUnit: "Financial Services",
        jobDescription: "Senior React Engineer to lead next-generation trading terminal UI.",
        additionalSkills: ["React", "TypeScript", "TailwindCSS"]
      })
    });
    await loadDemands();
  });

  document.getElementById('addPythonJobBtn').addEventListener('click', async () => {
    await fetch('/api/mock/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genus: "2.2-PYTHON",
        businessUnit: "Analytics Core",
        jobDescription: "Pure Python backend role for building asynchronous data pipelines. No frontend requirements.",
        additionalSkills: ["Python", "FastAPI", "PostgreSQL"]
      })
    });
    await loadDemands();
  });

  document.getElementById('addMixedJobBtn').addEventListener('click', async () => {
    await fetch('/api/mock/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genus: "3.1-FRONTEND-ANGULAR2X",
        businessUnit: "Healthcare Systems",
        jobDescription: "Full stack developer with primary Angular skills and Python microservice integration experience.",
        additionalSkills: ["Angular", "Python", "RxJS", "FastAPI"]
      })
    });
    await loadDemands();
  });

  // Modal Setup
  document.getElementById('closeModalBtn').addEventListener('click', closeApplyModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeApplyModal);
  document.getElementById('submitModalBtn').addEventListener('click', submitApplyModal);
}

// 4. Live Polling of Automation Status
async function fetchStatus() {
  try {
    const res = await fetch('/api/automation/status');
    const data = await res.json();

    const pill = document.getElementById('enginePill');
    const stateText = document.getElementById('engineStateText');
    const btnText = document.getElementById('btnText');
    const btnIcon = document.getElementById('btnIcon');

    if (data.isRunning) {
      pill.classList.remove('paused');
      stateText.textContent = `Automation: RUNNING (Every ${data.intervalMs / 1000}s)`;
      btnText.textContent = 'Pause Automation';
      btnIcon.textContent = '⏸';
    } else {
      pill.classList.add('paused');
      stateText.textContent = 'Automation: PAUSED';
      btnText.textContent = 'Start Automation';
      btnIcon.textContent = '▶';
    }

    // Update Stats
    document.getElementById('statCycles').textContent = data.stats.cyclesCount;
    document.getElementById('statEvaluated').textContent = data.stats.totalEvaluated;
    document.getElementById('statApplied').textContent = data.stats.totalApplied;
    document.getElementById('statSkippedPython').textContent = data.stats.totalSkippedPythonOnly;

    // Update Logs
    const logBadge = document.getElementById('logCountBadge');
    logBadge.textContent = data.logs.length;

    const terminal = document.getElementById('logsTerminal');
    terminal.innerHTML = data.logs.map(l => {
      const time = l.timestamp.split('T')[1].split('.')[0];
      return `<div class="log-line ${l.level}">[${time}] [${l.level}] ${l.message}</div>`;
    }).join('');

  } catch (e) {
    console.error('Error fetching engine status:', e);
  }
}

function startStatusPolling() {
  fetchStatus();
  setInterval(async () => {
    await fetchStatus();
    await loadDemands();
  }, 2500);
}

function startCountdown() {
  countdownTimer = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      countdownSeconds = 30;
    }
    const badge = document.getElementById('countdownBadge');
    if (badge) {
      badge.textContent = `${countdownSeconds}s`;
    }
  }, 1000);
}

// 5. Apply Modal Actions
window.openApplyModal = function(demandId) {
  activeModalDemand = currentDemands.find(d => d.demandId === demandId);
  if (!activeModalDemand) return;

  document.getElementById('modalDemandTitle').textContent = `Submit Details for ${activeModalDemand.genus} (${activeModalDemand.demandId})`;
  
  const fileLabel = document.getElementById('fileDropLabel');
  if (fileLabel) {
    fileLabel.innerHTML = `<span class="icon">📄</span><span class="text">Resume-3177277-pankaj.kumar07@nagarro.com-2026.09.18-20.16.29.docx (Ready)</span>`;
  }

  const skillsList = document.getElementById('modalSkillsList');
  const skills = activeModalDemand.additionalSkills || [];
  skillsList.innerHTML = skills.map(s => `
    <span class="pill" style="background: #dcfce7; color: #15803d; border: 1px solid #86efac;">☑ ${s} (Selected)</span>
  `).join('');

  const genus = activeModalDemand.genus || "";
  const desc = activeModalDemand.jobDescription || "";
  
  document.getElementById('modalCandidateComments').value = 
    `With over 8 years of specialized engineering experience as a Staff Engineer, I offer comprehensive mastery in enterprise web architecture, modern frontend frameworks (${genus}), and scalable integrations.\n\nThroughout my career, I have architected and deployed mission-critical platforms, including large-scale market intelligence and research platforms in financial and enterprise domains.\n\nI have deep production expertise across all requested skills: ${skills.join(", ")}. On the frontend, I focus on building responsive, high-performance, and pixel-perfect interfaces prioritizing Core Web Vitals, state synchronization, and WCAG accessibility standards.\n\nAs a Staff Engineer and Team Lead, I actively mentor engineers, establish code quality governance, and drive rapid Agile sprint deliveries. My ownership of delivery and clean architecture ensures immediate, impactful contribution to your project goals.`;

  document.getElementById('applyModal').classList.add('open');
};

function closeApplyModal() {
  document.getElementById('applyModal').classList.remove('open');
  activeModalDemand = null;
}

async function submitApplyModal() {
  if (!activeModalDemand) return;
  const demandId = activeModalDemand.demandId;
  const comments = document.getElementById('modalCandidateComments').value;

  try {
    const res = await fetch(`/api/demand/${demandId}/interest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateComments: comments,
        fileName: "manual_upload_resume.pdf",
        additionalSkills: activeModalDemand.additionalSkills || []
      })
    });

    if (res.ok) {
      closeApplyModal();
      await loadDemands();
      await fetchStatus();
    }
  } catch (err) {
    alert("Application error: " + err.message);
  }
}
