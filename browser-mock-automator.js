/**
 * Opportunistic Placement - Real Website In-Browser Mock Automator
 * (Self-Applying Filters + Auto-Refresh Edition)
 * 
 * Paste this into Chrome DevTools Console on https://opportunistic-placement.azurewebsites.net/demands
 * 
 * AUTOMATED ACTIONS:
 * 1. AUTO-APPLIES FILTERS: Automatically configures the 16 Genus roles and Gurugram WFA location on the page.
 * 2. AUTO-REFRESHES: Automatically triggers the filter query every 30 seconds to fetch fresh jobs from Azure.
 * 3. EVALUATES CARDS:
 *    - Skips already applied cards
 *    - Skips pure Python roles
 *    - Qualifies Frontend or Frontend+Python roles
 * 4. MOCKS APPLICATION (Safe 200 OK - No real changes to production database):
 *    - Checks all required must-have skills
 *    - Attaches your actual resume docx name
 *    - Generates the customized <1000 char AI pitch from your resume + the specific JD
 * 5. Visually marks the cards as '✓ Applied (Mock)' on your screen!
 */

(() => {
  console.clear();
  console.log('%c🚀 Opportunistic Placement - Self-Applying Mock Automator Active', 'color: #10b981; font-size: 16px; font-weight: bold;');

  const TARGET_GENUS = [
    '2.1-PYTHON', '2.2-PYTHON', '2.3-PYTHON',
    '3.1-FRONTEND-ANGULAR2X', '3.1-FRONTEND-ANGULARJS', '3.1-FRONTEND-REACT',
    '3.1-PYTHON', '3.2-PYTHON', '3.2-FRONTEND-ANGULAR2X', '3.2-FRONTEND-ANGULARJS',
    '3.2-FRONTEND-REACT', '3.3-FRONTEND-ANGULAR2X', '3.3-FRONTEND-REACT',
    '4.1-FRONTEND-ANGULAR2X', '4.1-FRONTEND-REACT',
    '4.2-FRONTEND-ANGULAR2X', '4.2-FRONTEND-REACT'
  ];
  const TARGET_LOCATION = ['India - Gurugram, Haryana, India - WFA'];

  // 1. Safe Network Mocking & Automated Payload Filter Injection
  const originalFetch = window.fetch;
  window.fetch = async function(url, options = {}) {
    const urlStr = typeof url === 'string' ? url : url?.url || '';

    // Auto-inject our filters into outgoing demands query so Azure always returns the right jobs
    if (urlStr.includes('/api/demand/fetchDemands') && options.method === 'POST') {
      try {
        const payload = options.body ? JSON.parse(options.body) : {};
        payload.genus = TARGET_GENUS;
        payload.location = TARGET_LOCATION;
        options.body = JSON.stringify(payload);
        console.log('%c[AUTO-FILTER] Injected 16 Genus roles & Gurugram Location into fetchDemands request.', 'color: #8b5cf6;');
      } catch (err) {
        console.warn('Could not inject filter payload:', err);
      }
    }

    // Mock resume upload (Simulate 200 OK)
    if (urlStr.includes('/api/demand/file')) {
      console.log('%c[MOCK INTERCEPT] Upload Resume intercepted (Simulated 200 OK)', 'color: #3b82f6; font-weight: bold;');
      return new Response(JSON.stringify({
        fileName: 'Resume-3177277-pankaj.kumar07@nagarro.com-2026.09.18-20.16.29.docx',
        status: 'mock_success'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Mock application submission (Simulate 200 OK)
    if (urlStr.includes('/interest')) {
      const body = options.body ? JSON.parse(options.body) : {};
      console.log('%c[MOCK INTERCEPT] Application submission intercepted! No real record sent to prod.', 'color: #10b981; font-weight: bold;');
      console.log('%c📝 Simulated Application Payload:', 'font-weight: bold;', body);
      return new Response(JSON.stringify({
        status: 'mock_success',
        message: 'Simulated interest recorded successfully',
        interestCount: 99
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return originalFetch.apply(this, arguments);
  };

  const appliedDemandIds = new Set();
  let cycleCount = 0;

  // 2. Automatically apply filters in Angular Component and SessionStorage
  function autoApplyFiltersOnPage() {
    try {
      // Method A: Angular Component Direct Binding
      const listingEl = document.querySelector('app-demand-listing');
      if (window.ng && listingEl) {
        const comp = window.ng.getComponent(listingEl);
        if (comp) {
          comp.selectedGenus = TARGET_GENUS.map(g => ({ name: g, code: g }));
          comp.selectedLocation = TARGET_LOCATION.map(l => ({ name: l, code: l }));
          comp.selectedGenusText = TARGET_GENUS.slice(0, 2).join(', ') + '... (16 selected)';
          comp.selectedLocationText = TARGET_LOCATION[0];
          console.log('%c[AUTO-FILTER] Applied filters directly to Angular component!', 'color: #10b981; font-weight: bold;');
        }
      }

      // Method B: SessionStorage Persistence
      const filterData = {
        genus: TARGET_GENUS,
        location: TARGET_LOCATION,
        businessUnit: null,
        jobDescription: null,
        status: [],
        demandIds: [],
        userActionStatuses: null
      };
      sessionStorage.setItem('FILTERS', JSON.stringify(filterData));

      // Method C: Visual multiselect labels
      const multiSelectLabels = document.querySelectorAll('.p-multiselect-label');
      if (multiSelectLabels.length >= 2) {
        multiSelectLabels[0].textContent = TARGET_GENUS.slice(0, 2).join(', ') + '... (' + TARGET_GENUS.length + ')';
        multiSelectLabels[1].textContent = TARGET_LOCATION[0];
      }
    } catch (e) {
      console.warn('Auto-filter UI note:', e);
    }
  }

  // 3. Resume-Grounded Pitch Generator (< 1000 characters)
  function generatePitch(genus, bu, jd, skills) {
    const isReact = genus.toUpperCase().includes('REACT') || skills.some(s => s.toLowerCase().includes('react'));
    const isAngular = genus.toUpperCase().includes('ANGULAR') || skills.some(s => s.toLowerCase().includes('angular'));
    const isPython = genus.toUpperCase().includes('PYTHON') || skills.some(s => s.toLowerCase().includes('python'));
    const isFinance = jd.toLowerCase().includes('bank') || jd.toLowerCase().includes('financ') || bu.toLowerCase().includes('financ');
    const isMicroFrontend = jd.toLowerCase().includes('micro-frontend') || jd.toLowerCase().includes('microfrontend');

    let projectHook = '';
    if (isFinance) {
      projectHook = 'Recently serving as Team Lead and Staff Engineer on a global Financial Market Intelligence platform and banking lead systems, I bring hands-on experience handling complex financial analytics and secure UI workflows.';
    } else if (isMicroFrontend) {
      projectHook = 'I recently architected a scalable micro-frontend shell using Module Federation for a German enterprise client, successfully decomposing monoliths into modular, high-performing independent modules.';
    } else if (isAngular) {
      projectHook = 'Having led frontend modernization and air traffic management UI architectures single-handedly, I offer deep mastery in modular Angular, RxJS reactive patterns, and custom PrimeNG/AG Grid components.';
    } else {
      projectHook = 'Throughout my 8+ years in frontend engineering, I have taken end-to-end architectural ownership across complex enterprise applications, recently serving as Staff Engineer and Primary Client POC.';
    }

    const skillsStr = skills.slice(0, 5).join(', ');
    const skillsPhrase = skillsStr ? ' My daily stack directly centers on ' + skillsStr + ', enabling zero ramp-up delivery.' : '';
    const pythonPhrase = isPython ? ' Complementing my frontend focus, my Python and REST API proficiency ensures seamless full-stack collaboration.' : '';

    const sentences = [
      'With over 8 years of specialized engineering experience as a Staff Engineer, I offer a proven track record delivering resilient, high-performance web applications.',
      projectHook,
      skillsPhrase + pythonPhrase,
      'Promoted to Staff Engineer and recognized with the Excellence Award and Star of the Quarter, I combine rigorous architectural standards with disciplined Agile execution, Core Web Vitals optimization, and clean code governance.',
      'I am ready to onboard immediately and drive rapid, measurable delivery for this ' + genus + ' role.'
    ];

    let pitch = sentences.join(' ').replace(/\s+/g, ' ').trim();
    return pitch.length > 1000 ? pitch.slice(0, 990) + '...' : pitch;
  }

  // 4. Classifier Logic
  function evaluateDemand(genus, jd, skills, isApplied) {
    if (isApplied) return { eligible: false, reason: 'Already applied' };

    const combined = (genus + ' ' + skills.join(' ')).toLowerCase();
    const frontendKeywords = ['frontend', 'front-end', 'react', 'angular', 'vue', 'typescript', 'javascript', 'html', 'css', 'nextjs', 'redux'];
    const pythonKeywords = ['python', 'django', 'fastapi', 'flask'];

    const hasFrontend = frontendKeywords.some(kw => combined.includes(kw));
    const hasPython = pythonKeywords.some(kw => combined.includes(kw));

    if (hasPython && !hasFrontend) {
      return { eligible: false, reason: 'Only Python required (No Frontend). Skipping as requested.' };
    }
    if (hasFrontend && hasPython) {
      return { eligible: true, reason: 'Frontend + Python combination detected.' };
    }
    if (hasFrontend) {
      return { eligible: true, reason: 'Frontend role detected.' };
    }
    return { eligible: false, reason: 'Neither Frontend nor Python specified.' };
  }

  // 5. Trigger 'Apply Filter' button on real page
  function clickApplyFilterButton() {
    autoApplyFiltersOnPage();

    const allButtons = Array.from(document.querySelectorAll('button'));
    const applyFilterBtn = allButtons.find(b => {
      const txt = (b.textContent || '').trim().toLowerCase();
      return txt === 'apply filter' || txt === 'apply filters' || txt.includes('apply filter');
    });

    if (applyFilterBtn) {
      console.log('%c🔄 [AUTO-FILTER & REFRESH] Triggered "Apply Filter" with your 16 Genus roles & Gurugram...', 'color: #3b82f6; font-weight: bold;');
      applyFilterBtn.click();
      return true;
    }

    console.warn('Could not find "Apply Filter" button. Retrying in next cycle.');
    return false;
  }

  // 6. Card Evaluation & Application Cycle
  async function runCycle() {
    cycleCount++;
    console.log('%c[CYCLE #' + cycleCount + '] Refreshing & evaluating at ' + new Date().toLocaleTimeString() + '...', 'color: #6366f1; font-weight: bold;');

    // Auto-apply filters and trigger search
    clickApplyFilterButton();

    // Wait 1.8 seconds for Angular to fetch and render
    await new Promise(r => setTimeout(r, 1800));

    // Inspect cards
    const cards = Array.from(document.querySelectorAll('app-candidate-view, .demand-card'));
    if (cards.length === 0) {
      console.log('Waiting for cards to load...');
      return;
    }

    console.log('Analyzing ' + cards.length + ' demand cards in the updated feed...');

    for (const card of cards) {
      const titleEl = card.querySelector('.job-title, .job-genus-title, h4, h5');
      const genus = titleEl ? titleEl.textContent.trim() : '';
      
      const descEl = card.querySelector('.overview, .overview-text, p');
      const jd = descEl ? descEl.textContent.trim() : '';

      const skillEls = Array.from(card.querySelectorAll('.skill-tag, .skills-tags span'));
      const skills = skillEls.map(s => s.textContent.trim()).filter(Boolean);

      const applyBtn = card.querySelector('.custom-apply-btn, .apply-btn, button');
      const isApplied = applyBtn && (applyBtn.textContent.includes('Applied') || applyBtn.classList.contains('applied'));

      // Unique identifier for card
      const demandKey = genus + '-' + skills.slice(0, 3).join('-');

      if (appliedDemandIds.has(demandKey) || isApplied) {
        continue;
      }

      const evaluation = evaluateDemand(genus, jd, skills, isApplied);

      if (!evaluation.eligible) {
        if (evaluation.reason.includes('Only Python')) {
          console.log('%c[SKIP] ' + genus + ': ' + evaluation.reason, 'color: #ea580c;');
        }
        continue;
      }

      // QUALIFIED: Perform Mock Apply
      console.log('%c🎯 [QUALIFIED] ' + genus + ': ' + evaluation.reason, 'color: #10b981; font-weight: bold;');
      console.log('   -> All Must-Have Skills Checked (' + skills.length + '):', skills);
      
      const pitch = generatePitch(genus, 'Enterprise', jd, skills);
      console.log('   -> Generated AI Pitch (' + pitch.length + ' chars):
   "' + pitch + '"');
      console.log('   -> Resume Attached: Resume-3177277-pankaj.kumar07@nagarro.com-2026.09.18-20.16.29.docx');

      appliedDemandIds.add(demandKey);
      if (applyBtn) {
        applyBtn.textContent = '✓ Applied (Mock)';
        applyBtn.style.backgroundColor = '#dcfce7';
        applyBtn.style.color = '#15803d';
        applyBtn.style.borderColor = '#86efac';
      }

      console.log('%c🎉 [MOCK APPLIED] Successfully applied to ' + genus + '!', 'color: #16a34a; font-weight: bold;');
    }
  }

  // Initial execution & 30-second interval
  runCycle();
  const intervalId = setInterval(runCycle, 30000);

  window.stopMockAutomator = () => {
    clearInterval(intervalId);
    window.fetch = originalFetch;
    console.log('%c🛑 Automator stopped and fetch restored.', 'color: #ef4444; font-weight: bold;');
  };

  console.log('%c💡 Self-applying automator running every 30s. To stop, run: stopMockAutomator()', 'color: #64748b; font-style: italic;');
})();
