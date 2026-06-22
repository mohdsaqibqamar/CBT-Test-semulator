/**
 * ==========================================================================
 * NEET/JEE CBT SIMULATOR: CORE APP CONTROLLER & ROUTER
 * ==========================================================================
 */

// Global State
const state = {
    currentView: 'view-dashboard',
    tests: [],
    activeTest: {
        test_id: null,
        title: "",
        pages: [], // [{page_number, image_url, width, height}]
        crops: [], // [{question_number, page_number, crop_box, subject}]
        answer_key: {}, // {"1": "3", "2": "1"}
        subjects: {} // {"1": "Physics", "2": "Physics"}
    },
    slicer: {
        currentPageIndex: 0,
        zoom: 50,
        isDrawing: false,
        startX: 0, // In percentage
        startY: 0, // In percentage
        currentCrop: null, // {x, y, width, height} in percentage
        pendingAutoCrops: [],
        isResizingAutoCrop: false,
        activeAutoCropIndex: -1,
        activeAutoCropHandle: null
    }
};

const API_BASE = "http://127.0.0.1:8000";

// API Helper
async function apiCall(endpoint, data = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const resJson = await response.json();
        if (!resJson.success) {
            throw new Error(resJson.error || "API returned failed success flag");
        }
        return resJson;
    } catch (err) {
        console.error(`API Error on ${endpoint}:`, err);
        alert(`Error: ${err.message}`);
        throw err;
    }
}

// Router
function showView(viewId, pushHistory = true) {
    if (pushHistory) {
        history.pushState({ view: viewId }, '', '#' + viewId);
    }
    
    // Hide all views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    // Show active view
    const activeView = document.getElementById(viewId);
    if (activeView) {
        activeView.classList.add('active');
        state.currentView = viewId;
    }
    
    // Header actions adjustment
    if (viewId === 'view-exam') {
        document.getElementById('header-timer').classList.remove('hidden');
        document.getElementById('btn-dashboard').classList.add('hidden');
    } else {
        document.getElementById('header-timer').classList.add('hidden');
        document.getElementById('btn-dashboard').classList.remove('hidden');
    }
}

// Loader Utilities
function showLoader(message = "Processing PDF. Please wait...") {
    document.getElementById('loading-message').innerText = message;
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoader() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

/* ==========================================================================
   INITIALIZATION & EVENT LISTENERS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Handle Browser Back Button
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.view) {
            showView(e.state.view, false);
        } else {
            showView('view-dashboard', false);
        }
    });

    // Load existing tests on startup
    loadTestsList();
    
    // Desktop integration hooks
    window.addEventListener('pywebviewready', function() {
        document.querySelectorAll('.desktop-only').forEach(el => el.classList.remove('hidden'));
    });
    
    document.getElementById('btn-import-test')?.addEventListener('click', async () => {
        if (!window.pywebview) return;
        showLoader("Importing test... Please wait.");
        try {
            const res = await window.pywebview.api.import_test();
            if (res.status === 'success') {
                alert(res.message);
                await loadTestsList();
            } else if (res.status === 'error') {
                alert(res.message);
            }
        } catch (e) {
            alert("Error importing test: " + e);
        } finally {
            hideLoader();
        }
    });

    // Navigation Hooks
    document.getElementById('btn-dashboard').addEventListener('click', () => {
        loadTestsList();
        showView('view-dashboard');
    });

    // Create New Test Flow
    document.getElementById('btn-create-test').addEventListener('click', handleCreateTest);

    // Slicer View Actions
    document.getElementById('btn-prev-page').addEventListener('click', () => changeSlicerPage(-1));
    document.getElementById('btn-next-page').addEventListener('click', () => changeSlicerPage(1));
    
    document.getElementById('btn-delete-page').addEventListener('click', () => {
        if (!confirm("Are you sure you want to delete this page from the PDF?")) return;
        
        state.activeTest.pages.splice(state.slicer.currentPageIndex, 1);
        
        if (state.activeTest.pages.length === 0) {
            alert("All pages deleted! Please upload a new PDF.");
            showView('view-upload');
            return;
        }
        
        if (state.slicer.currentPageIndex >= state.activeTest.pages.length) {
            state.slicer.currentPageIndex = state.activeTest.pages.length - 1;
        }
        
        updateSlicerUI();
    });
    
    document.getElementById('btn-zoom-in').addEventListener('click', () => adjustSlicerZoom(10));
    document.getElementById('btn-zoom-out').addEventListener('click', () => adjustSlicerZoom(-10));
    document.getElementById('btn-save-crop').addEventListener('click', () => saveActiveCrop(false));
    document.getElementById('btn-select-current').addEventListener('click', autoDetectQuestionsOnPage);
    document.getElementById('btn-select-all').addEventListener('click', selectAllPages);
    document.getElementById('btn-slicer-done').addEventListener('click', proceedToDetails);

    // Profile Hooks
    document.getElementById('btn-profile-back').addEventListener('click', () => {
        loadTestsList();
        showView('view-dashboard');
    });
    document.getElementById('btn-profile-start').addEventListener('click', () => {
        const timerMins = parseInt(document.getElementById('input-timer-mins').value) || 180;
        state.activeTest.timerSeconds = timerMins * 60;
        startMockTestSetup(state.activeTest.test_id);
    });
    document.getElementById('input-timer-mins').addEventListener('input', (e) => {
        const val = parseInt(e.target.value) || 180;
        document.getElementById('profile-rules-timer').innerText = `${val} Minutes`;
    });

    // Crop Selection Drag Event Handlers
    initCropCanvasHandlers();
    
    // Handle Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (state.currentView === 'view-slicer') {
            if (e.key === 'Enter') {
                if (state.slicer.pendingAutoCrops && state.slicer.pendingAutoCrops.length > 0) {
                    saveAllAutoCrops();
                } else {
                    const btnSave = document.getElementById('btn-save-crop');
                    if (!btnSave.disabled) {
                        saveActiveCrop();
                    }
                }
            } else if (e.key === 'ArrowRight') {
                changeSlicerPage(1);
            } else if (e.key === 'ArrowLeft') {
                changeSlicerPage(-1);
            } else if (e.key === 'ArrowUp') {
                if (state.slicer.pendingAutoCrops && state.slicer.pendingAutoCrops.length > 0) {
                    state.slicer.pendingAutoCrops[0].num_questions = (state.slicer.pendingAutoCrops[0].num_questions || 1) + 1;
                    renderAutoCrops();
                }
            } else if (e.key === 'ArrowDown') {
                if (state.slicer.pendingAutoCrops && state.slicer.pendingAutoCrops.length > 0) {
                    state.slicer.pendingAutoCrops[0].num_questions = Math.max(1, (state.slicer.pendingAutoCrops[0].num_questions || 1) - 1);
                    renderAutoCrops();
                }
            }
        }
    });
});

/* ==========================================================================
   DASHBOARD / TEST LISTS
   ========================================================================== */

async function loadTestsList() {
    showLoader("Loading your tests...");
    try {
        const res = await apiCall('/api/list_tests');
        state.tests = res.tests || [];
        renderTestsGrid();
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

function renderTestsGrid() {
    const grid = document.getElementById('test-grid');
    grid.innerHTML = "";
    
    if (state.tests.length === 0) {
        grid.innerHTML = `
            <div class="no-tests glass">
                <div class="illustration">📂</div>
                <p>No tests created yet. Upload a PDF to create your first question bank!</p>
            </div>
        `;
        return;
    }
    
    state.tests.forEach(test => {
        const card = document.createElement('div');
        card.className = "test-card glass";
        
        const qCount = test.total_questions || Object.keys(test.subjects || {}).length || 0;
        
        card.innerHTML = `
            <h4>${test.title || "Untitled NEET Mock Test"}</h4>
            <div class="test-meta">
                <span class="badge physics">Physics</span>
                <span class="badge chemistry">Chemistry</span>
                <span class="badge biology">Biology</span>
                <span class="badge general">${qCount} Questions</span>
            </div>
            <div class="test-card-footer" style="display: flex; gap: 0.5rem; align-items: center;">
                <button class="btn btn-primary btn-sm btn-profile-test" data-id="${test.test_id}" style="flex: 1;">Revise</button>
                <button class="btn btn-secondary btn-sm btn-edit-test" data-id="${test.test_id}" style="flex: 1;">Edit</button>
                <button class="btn btn-icon btn-secondary btn-export-test desktop-only hidden" data-id="${test.test_id}" data-title="${test.title}" style="padding: 6px;" title="Share / Export Test">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </button>
                <button class="btn btn-icon btn-secondary btn-delete-test" data-id="${test.test_id}" style="padding: 6px;" title="Delete Test">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
        
        grid.appendChild(card);
    });

    // Add listeners to grid buttons
    document.querySelectorAll('.btn-profile-test').forEach(btn => {
        btn.addEventListener('click', (e) => showTestProfile(e.target.dataset.id));
    });
    document.querySelectorAll('.btn-edit-test').forEach(btn => {
        btn.addEventListener('click', (e) => resumeSlicing(e.target.dataset.id));
    });

    document.querySelectorAll('.btn-delete-test').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            // Traverse up to find the closest button in case the click was on the SVG
            const button = e.target.closest('.btn-delete-test');
            const testId = button.dataset.id;
            
            if (confirm("Are you sure you want to completely delete this test paper and all its data? This cannot be undone.")) {
                showLoader("Deleting test...");
                try {
                    await apiCall('/api/delete_test', { test_id: testId });
                    await loadTestsList(); // Reload the list
                } catch (err) {
                    console.error("Error deleting test:", err);
                    alert("Failed to delete the test.");
                } finally {
                    hideLoader();
                }
            }
        });
    });

    document.querySelectorAll('.btn-export-test').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const testId = e.currentTarget.getAttribute('data-id');
            const title = e.currentTarget.getAttribute('data-title');
            if (!window.pywebview) return;
            
            showLoader("Exporting test...");
            try {
                const res = await window.pywebview.api.export_test(testId, title);
                if (res.status === 'success') {
                    alert(res.message);
                } else if (res.status === 'error') {
                    alert(res.message);
                }
            } catch (err) {
                alert("Error exporting test: " + err);
            } finally {
                hideLoader();
            }
        });
    });
    
    // Ensure desktop buttons are shown if pywebview is already ready
    if (window.pywebview) {
        document.querySelectorAll('.desktop-only').forEach(el => el.classList.remove('hidden'));
    }
}

/* ==========================================================================
   CREATE TEST & RESUME
   ========================================================================== */

async function handleCreateTest() {
    try {
        // Step 1: Open native file selection
        const fileRes = await apiCall('/api/select_pdf');
        if (!fileRes.file_path) return;
        
        showLoader("Extracting PDF pages as high-resolution images... Please wait.");
        
        // Step 2: Convert PDF to PNGs
        const testId = "test_" + Date.now();
        const convRes = await apiCall('/api/convert_pdf', {
            pdf_path: fileRes.file_path,
            test_id: testId
        });
        
        // Initialize State
        state.activeTest = {
            test_id: testId,
            title: fileRes.file_name.replace('.pdf', ''),
            pages: convRes.pages,
            crops: [],
            answer_key: {},
            subjects: {}
        };
        
        // Set inputs in UI
        document.getElementById('slicer-test-title').value = state.activeTest.title;
        state.slicer.currentPageIndex = 0;
        state.slicer.zoom = 50;
        state.slicer.currentCrop = null;
        
        updateSlicerUI();
        showView('view-slicer');
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

async function resumeSlicing(testId) {
    showLoader("Loading test crops data...");
    try {
        const res = await apiCall('/api/get_test', { test_id: testId });
        const test = res.test;
        
        state.activeTest = {
            test_id: testId,
            title: test.title,
            pages: test.pages || [],
            crops: test.crops || [],
            answer_key: test.answer_key || {},
            subjects: test.subjects || {}
        };
        
        document.getElementById('slicer-test-title').value = state.activeTest.title;
        
        // Subject ranges inputs fallback
        // (Just extract range ends/starts from existing mappings if any)
        state.slicer.currentPageIndex = 0;
        state.slicer.zoom = 50;
        state.slicer.currentCrop = null;
        
        updateSlicerUI();
        showView('view-slicer');
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

async function showTestProfile(testId) {
    showLoader("Loading test profile...");
    try {
        const res = await apiCall('/api/get_test', { test_id: testId });
        const test = res.test;
        
        state.activeTest = {
            test_id: testId,
            title: test.title,
            timerSeconds: test.timer_seconds || (180 * 60),
            pages: test.pages || [],
            crops: test.crops || [],
            answer_key: test.answer_key || {},
            subjects: test.subjects || {},
            attempts: test.attempts || []
        };
        
        document.getElementById('profile-test-title').innerText = test.title || "Mock Test Profile";
        
        const initialTimerMins = Math.floor(state.activeTest.timerSeconds / 60);
        document.getElementById('input-timer-mins').value = initialTimerMins;
        document.getElementById('profile-rules-timer').innerText = `${initialTimerMins} Minutes`;
        
        const grid = document.getElementById('attempts-grid');
        grid.innerHTML = "";
        
        if (state.activeTest.attempts.length === 0) {
            grid.innerHTML = `
                <div class="no-tests glass">
                    <div class="illustration">📊</div>
                    <p>No attempts recorded yet. Start a new mock test!</p>
                </div>
            `;
        } else {
            state.activeTest.attempts.forEach((attempt, index) => {
                const card = document.createElement('div');
                card.className = "test-card glass";
                
                const score = attempt.overall.score || 0;
                const total = (attempt.overall.total_questions || 0) * 4;
                const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
                
                let badgeClass = "badge";
                if (percentage >= 80) badgeClass += " success";
                else if (percentage >= 50) badgeClass += " warning";
                else badgeClass += " danger";
                
                card.innerHTML = `
                    <h4>Attempt ${state.activeTest.attempts.length - index}</h4>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">${attempt.timestamp}</div>
                    <div class="test-meta">
                        <span class="${badgeClass}">Score: ${score} / ${total}</span>
                        <span class="badge">Accuracy: ${percentage}%</span>
                    </div>
                    <div class="test-card-footer mt-auto">
                        <button class="btn btn-secondary w-full" onclick="loadScorecardFromHistory('${testId}', '${attempt.result_id}')">View Detailed Scorecard</button>
                    </div>
                `;
                grid.appendChild(card);
            });
        }
        
        showView('view-test-profile');
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

/* ==========================================================================
   SLICER / VISUAL CROPPING ENGINE
   ========================================================================== */

function updateSlicerUI() {
    const page = state.activeTest.pages[state.slicer.currentPageIndex];
    if (!page) return;
    
    // Set page image source
    const imgEl = document.getElementById('pdf-page-image');
    imgEl.src = `${API_BASE}${page.image_url}`;
    
    // Reset page controls
    document.getElementById('current-page-num').innerText = state.slicer.currentPageIndex + 1;
    document.getElementById('total-pages-num').innerText = state.activeTest.pages.length;
    
    // Hide crop selection box
    document.getElementById('crop-selection-box').classList.add('hidden');
    document.getElementById('btn-save-crop').disabled = true;
    state.slicer.currentCrop = null;
    
    // Load pending auto-crops when changing pages
    if (page.pendingAutoCrops && page.pendingAutoCrops.length > 0) {
        state.slicer.pendingAutoCrops = JSON.parse(JSON.stringify(page.pendingAutoCrops));
        renderAutoCrops();
    } else {
        if (typeof cancelAutoCropsMode === 'function') cancelAutoCropsMode();
    }
    
    // Sync current question calculations
    calculateNextQuestionNumber();
    renderCropsList();
    
    // Maintain zoom visual state
    adjustSlicerZoom(0);
}

function changeSlicerPage(dir) {
    const newIdx = state.slicer.currentPageIndex + dir;
    if (newIdx >= 0 && newIdx < state.activeTest.pages.length) {
        state.slicer.currentPageIndex = newIdx;
        updateSlicerUI();
    }
}

function adjustSlicerZoom(amount) {
    const newZoom = Math.max(10, Math.min(250, state.slicer.zoom + amount));
    state.slicer.zoom = newZoom;
    document.getElementById('zoom-value').innerText = `${newZoom}%`;
    document.getElementById('crop-canvas-container').style.width = `${newZoom}%`;
}

// Bounding Box Logic inside Relative Container
function initCropCanvasHandlers() {
    const container = document.getElementById('crop-canvas-container');
    const selection = document.getElementById('crop-selection-box');
    
    container.addEventListener('mousedown', (e) => {
        // Prevent action on selection border handles if clicking them (prevent double trigger)
        if (e.target.classList.contains('resize-handle')) return;
        
        // Prevent action on delete buttons so it doesn't trigger drawing mode
        if (e.target.classList.contains('delete-btn')) return;
        
        // Check for Auto Crop Resize Handlers
        if (e.target.classList.contains('ac-handle')) {
            state.slicer.isResizingAutoCrop = true;
            state.slicer.activeAutoCropIndex = parseInt(e.target.dataset.index);
            state.slicer.activeAutoCropHandle = e.target.dataset.handle;
            return;
        }
        
        const rect = container.getBoundingClientRect();
        
        // Compute relative click coordinates as percent (0 to 100)
        state.slicer.isDrawing = true;
        state.slicer.startX = ((e.clientX - rect.left) / rect.width) * 100;
        state.slicer.startY = ((e.clientY - rect.top) / rect.height) * 100;
        
        // Initialize selection visual
        selection.style.left = `${state.slicer.startX}%`;
        selection.style.top = `${state.slicer.startY}%`;
        selection.style.width = `0%`;
        selection.style.height = `0%`;
        selection.classList.remove('hidden');
    });

    document.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        const curY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
        
        if (state.slicer.isResizingAutoCrop) {
            const idx = state.slicer.activeAutoCropIndex;
            const box = state.slicer.pendingAutoCrops[idx];
            if (!box) return;
            
            if (state.slicer.activeAutoCropHandle === 'top') {
                const bottomY = box.y + box.height;
                if (curY < bottomY) {
                    box.y = curY;
                    box.height = bottomY - curY;
                }
            } else if (state.slicer.activeAutoCropHandle === 'bottom') {
                if (curY > box.y) {
                    box.height = curY - box.y;
                }
            } else if (state.slicer.activeAutoCropHandle === 'left') {
                const rectWidth = container.getBoundingClientRect().width;
                const curX = Math.max(0, Math.min(100, ((e.clientX - container.getBoundingClientRect().left) / rectWidth) * 100));
                const rightX = box.x + box.width;
                if (curX < rightX) {
                    box.x = curX;
                    box.width = rightX - curX;
                }
            } else if (state.slicer.activeAutoCropHandle === 'right') {
                const rectWidth = container.getBoundingClientRect().width;
                const curX = Math.max(0, Math.min(100, ((e.clientX - container.getBoundingClientRect().left) / rectWidth) * 100));
                if (curX > box.x) {
                    box.width = curX - box.x;
                }
            }
            
            // Fast DOM update
            const div = container.querySelector(`.auto-crop-box[data-index="${idx}"]`);
            if (div) {
                div.style.top = `${box.y}%`;
                div.style.left = `${box.x}%`;
                div.style.height = `${box.height}%`;
                div.style.width = `${box.width}%`;
            }
            return;
        }
        
        if (!state.slicer.isDrawing) return;
        
        // Relative mouse coordinates
        const curX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        
        // Bounding box computations
        const left = Math.min(state.slicer.startX, curX);
        const top = Math.min(state.slicer.startY, curY);
        const width = Math.abs(state.slicer.startX - curX);
        const height = Math.abs(state.slicer.startY - curY);
        
        selection.style.left = `${left}%`;
        selection.style.top = `${top}%`;
        selection.style.width = `${width}%`;
        selection.style.height = `${height}%`;
        
        state.slicer.currentCrop = { x: left, y: top, width: width, height: height };
    });

    document.addEventListener('mouseup', () => {
        if (state.slicer.isResizingAutoCrop) {
            state.slicer.isResizingAutoCrop = false;
            state.slicer.activeAutoCropIndex = -1;
            state.slicer.activeAutoCropHandle = null;
            return;
        }
        
        if (state.slicer.isDrawing) {
            state.slicer.isDrawing = false;
            
            const crop = state.slicer.currentCrop;
            if (crop && crop.width > 2 && crop.height > 2) {
                // Instantly push to pending crops!
                state.slicer.pendingAutoCrops.push({
                    x: crop.x,
                    y: crop.y,
                    width: crop.width,
                    height: crop.height
                });
                renderAutoCrops();
                
                // Show the "Save All" button, hide the manual save
                document.getElementById('btn-save-crop').classList.add('hidden');
            }
            
            // Hide the drawing selection box
            document.getElementById('crop-selection-box').classList.add('hidden');
            state.slicer.currentCrop = null;
        }
    });
}

function getSubjectForQuestion(qNum) {
    const phyStart = parseInt(document.getElementById('range-phy-start').value);
    const phyEnd = parseInt(document.getElementById('range-phy-end').value);
    const chemStart = parseInt(document.getElementById('range-chem-start').value);
    const chemEnd = parseInt(document.getElementById('range-chem-end').value);
    const bioStart = parseInt(document.getElementById('range-bio-start').value);
    const bioEnd = parseInt(document.getElementById('range-bio-end').value);
    
    if (!isNaN(phyStart) && !isNaN(phyEnd) && qNum >= phyStart && qNum <= phyEnd) return 'Physics';
    if (!isNaN(chemStart) && !isNaN(chemEnd) && qNum >= chemStart && qNum <= chemEnd) return 'Chemistry';
    if (!isNaN(bioStart) && !isNaN(bioEnd) && qNum >= bioStart && qNum <= bioEnd) return 'Biology';
    return 'General';
}

function getTotalSavedQuestions() {
    return state.activeTest.crops.reduce((sum, crop) => sum + (crop.num_questions || 1), 0);
}

function calculateNextQuestionNumber() {
    const nextQ = getTotalSavedQuestions() + 1;
    
    document.getElementById('active-q-number').innerText = `Q${nextQ}`;
    
    const subject = getSubjectForQuestion(nextQ);
    const subBadge = document.getElementById('active-q-subject');
    subBadge.innerText = subject;
    subBadge.className = `badge ${subject.toLowerCase()}`;
}

async function autoDetectQuestionsOnPage() {
    showLoader("✨ Selecting full page...");
    try {
        const pageNum = state.activeTest.pages[state.slicer.currentPageIndex].page_number;
        const res = await apiCall('/api/auto_detect_crops', {
            test_id: state.activeTest.test_id,
            page_number: pageNum
        });
        
        if (res.boxes && res.boxes.length > 0) {
            state.activeTest.pages[state.slicer.currentPageIndex].pendingAutoCrops = res.boxes;
            state.slicer.pendingAutoCrops = res.boxes;
            renderAutoCrops();
            
            document.getElementById('btn-save-crop').classList.add('hidden');
        } else {
            alert("Could not select page. Please crop manually.");
        }
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

async function selectAllPages() {
    if (!confirm("This will automatically save the full page for ALL remaining pages in the PDF. Proceed?")) return;
    
    showLoader("✨ Processing all pages...");
    try {
        for (let idx = 0; idx < state.activeTest.pages.length; idx++) {
            const pageNum = state.activeTest.pages[idx].page_number;
            
            const res = await apiCall('/api/auto_detect_crops', {
                test_id: state.activeTest.test_id,
                page_number: pageNum
            });
            
            if (res.boxes && res.boxes.length > 0) {
                // Just store the pending crop on the page object
                state.activeTest.pages[idx].pendingAutoCrops = res.boxes;
            }
        }
        
        // Refresh UI for the current page
        updateSlicerUI();
        
        alert("All pages have been selected! Use Left/Right arrows to navigate, Up/Down to set question counts, and Enter to save.");
        
    } catch(err) {
        console.error(err);
        alert("An error occurred while bulk processing.");
    } finally {
        hideLoader();
    }
}

function renderAutoCrops() {
    const container = document.getElementById('auto-crops-container');
    container.innerHTML = "";
    
    let currentQNum = getTotalSavedQuestions() + 1;
    
    state.slicer.pendingAutoCrops.forEach((box, index) => {
        if (!box.num_questions) box.num_questions = 1;
        
        let labelText = box.num_questions === 1 ? `Q${currentQNum}` : `Q${currentQNum}-Q${currentQNum + box.num_questions - 1}`;
        
        const div = document.createElement('div');
        div.className = "auto-crop-box";
        div.style.left = `${box.x}%`;
        div.style.top = `${box.y}%`;
        div.style.width = `${box.width}%`;
        div.style.height = `${box.height}%`;
        div.dataset.index = index;
        
        div.innerHTML = `
            <div class="crop-label" style="display: flex; align-items: center; gap: 5px; cursor: default; pointer-events: auto;">
                <span style="min-width:35px">${labelText}</span>
                <input type="number" min="1" max="20" value="${box.num_questions}" 
                    class="num-qs-input" title="Questions in this box" 
                    data-index="${index}" style="width:40px; color:black; font-size:12px; border:none; border-radius:3px; padding:0 2px;">
            </div>
            <div class="ac-handle top" data-index="${index}" data-handle="top"></div>
            <div class="ac-handle bottom" data-index="${index}" data-handle="bottom"></div>
            <div class="ac-handle left" data-index="${index}" data-handle="left"></div>
            <div class="ac-handle right" data-index="${index}" data-handle="right"></div>
            <div class="delete-btn" data-index="${index}">x</div>
        `;
        
        container.appendChild(div);
        currentQNum += box.num_questions;
    });
    
    // Attach change listeners for num_questions
    container.querySelectorAll('.num-qs-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index);
            const val = parseInt(e.target.value) || 1;
            state.slicer.pendingAutoCrops[idx].num_questions = Math.max(1, val);
            renderAutoCrops(); // Re-render to update labels
        });
        input.addEventListener('mousedown', (e) => e.stopPropagation());
    });
    
    // Attach delete listeners
    container.querySelectorAll('.delete-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const idx = parseInt(e.target.dataset.index);
            state.slicer.pendingAutoCrops.splice(idx, 1);
            renderAutoCrops();
            if(state.slicer.pendingAutoCrops.length === 0) {
                cancelAutoCropsMode();
            }
        };
    });
}

function cancelAutoCropsMode() {
    state.slicer.pendingAutoCrops = [];
    document.getElementById('auto-crops-container').innerHTML = "";
}

async function saveAllAutoCrops() {
    if (state.slicer.pendingAutoCrops.length === 0) return;
    
    showLoader(`Saving ${state.slicer.pendingAutoCrops.length} question blocks...`);
    const pageNum = state.activeTest.pages[state.slicer.currentPageIndex].page_number;
    
    try {
        for (let i = 0; i < state.slicer.pendingAutoCrops.length; i++) {
            const crop = state.slicer.pendingAutoCrops[i];
            const qNum = getTotalSavedQuestions() + 1; // Base QNum for this block
            const subject = getSubjectForQuestion(qNum);
            
            const cropRes = await apiCall('/api/crop_question', {
                test_id: state.activeTest.test_id,
                page_number: pageNum,
                crop_box: crop,
                question_number: qNum
            });
            
            state.activeTest.crops.push({
                question_number: qNum,
                num_questions: crop.num_questions || 1, // Store how many questions are in this block
                page_number: pageNum,
                crop_box: crop,
                subject: subject,
                image_url: cropRes.image_url
            });
            
            // Assign subject for each question in the block
            for (let j = 0; j < (crop.num_questions || 1); j++) {
                state.activeTest.subjects[(qNum + j).toString()] = getSubjectForQuestion(qNum + j);
            }
        }
        
        // Clear the pending auto crop from the page object so it doesn't show up again
        state.activeTest.pages[state.slicer.currentPageIndex].pendingAutoCrops = null;
        cancelAutoCropsMode();
        calculateNextQuestionNumber();
        renderCropsList();
        
        // Auto-advance to next page
        if (state.slicer.currentPageIndex < state.activeTest.pages.length - 1) {
            changeSlicerPage(1);
        } else {
            alert("This was the final page. All crops saved successfully!");
        }
        
    } catch(err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

async function saveActiveCrop(silent = false) {
    const crop = state.slicer.currentCrop;
    if (!crop) return;
    
    const qNum = getTotalSavedQuestions() + 1;
    const subject = getSubjectForQuestion(qNum);
    const pageNum = state.activeTest.pages[state.slicer.currentPageIndex].page_number;
    
    if (!silent) showLoader(`Slicing Question ${qNum}...`);
    
    try {
        const cropRes = await apiCall('/api/crop_question', {
            test_id: state.activeTest.test_id,
            page_number: pageNum,
            crop_box: crop,
            question_number: qNum
        });
        
        // Add to crop list
        state.activeTest.crops.push({
            question_number: qNum,
            num_questions: 1,
            page_number: pageNum,
            crop_box: crop,
            subject: subject,
            image_url: cropRes.image_url
        });
        
        // Save subject mapping
        state.activeTest.subjects[qNum.toString()] = subject;
        
        // Reset selection
        document.getElementById('crop-selection-box').classList.add('hidden');
        document.getElementById('btn-save-crop').disabled = true;
        state.slicer.currentCrop = null;
        
        if (!silent) {
            calculateNextQuestionNumber();
            renderCropsList();
        }
    } catch (err) {
        console.error(err);
    } finally {
        if (!silent) hideLoader();
    }
}

function renderCropsList() {
    const container = document.getElementById('crops-list');
    container.innerHTML = "";
    
    document.getElementById('total-crops-count').innerText = getTotalSavedQuestions();
    
    state.activeTest.crops.forEach((crop, idx) => {
        const card = document.createElement('div');
        card.className = "crop-item";
        
        const qCount = crop.num_questions || 1;
        const qLabel = qCount > 1 
            ? `Q${crop.question_number}-Q${crop.question_number + qCount - 1}` 
            : `Q${crop.question_number}`;
        
        card.innerHTML = `
              <div class="details">
                  <span class="q-num">${qLabel}</span>
                  <span class="badge ${crop.subject.toLowerCase()}">${crop.subject}</span>
                  <span class="page-meta" style="font-size:0.75rem; color:var(--text-muted)">Pg ${crop.page_number}</span>
              </div>
              <button class="btn-delete-crop" data-index="${idx}">&times;</button>
          `;
          card.style.flexDirection = '';
          card.style.alignItems = '';
        
        container.appendChild(card);
    });
    
    // Add delete hooks
    container.querySelectorAll('.btn-delete-crop').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.activeTest.crops.splice(idx, 1);
            
            // Re-index remaining crops
            let currentQ = 1;
            const cleanSubjects = {};
            
            state.activeTest.crops.forEach((c) => {
                c.question_number = currentQ;
                c.subject = getSubjectForQuestion(currentQ);
                
                const count = c.num_questions || 1;
                for (let j = 0; j < count; j++) {
                    const qNumStr = (currentQ + j).toString();
                    cleanSubjects[qNumStr] = getSubjectForQuestion(currentQ + j);
                }
                currentQ += count;
            });
            
            state.activeTest.subjects = cleanSubjects;
            
            calculateNextQuestionNumber();
            renderCropsList();
        });
    });
}

/* ==========================================================================
   PROCEED TO DETAILS & SAVE
   ========================================================================== */

async function proceedToDetails() {
    if (state.activeTest.crops.length === 0) {
        alert("Please crop at least 1 question before proceeding!");
        return;
    }
    
    state.activeTest.title = document.getElementById('slicer-test-title').value || "Untitled NEET Mock Test";
    state.activeTest.timerSeconds = (parseInt(document.getElementById('slicer-test-timer').value) || 180) * 60;
    
    showLoader("Saving mock test crops data...");
    
    try {
        // Save metadata to server
        const metadata = {
            title: state.activeTest.title,
            timer_seconds: state.activeTest.timerSeconds,
            pages: state.activeTest.pages,
            crops: state.activeTest.crops,
            subjects: state.activeTest.subjects,
            answer_key: state.activeTest.answer_key
        };
        
        await apiCall('/api/save_test', {
            test_id: state.activeTest.test_id,
            metadata: metadata
        });
        
        // Show test details setup
        showTestDetailsPanel();
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

function showTestDetailsPanel() {
    const test = state.activeTest;
    document.getElementById('details-test-title').innerText = test.title;
    document.getElementById('meta-total-questions').innerText = `${getTotalSavedQuestions()} Questions Sliced`;
    
    // Subject Range Sync Label
    document.getElementById('meta-phy-range').innerText = `Q${document.getElementById('range-phy-start').value} - Q${document.getElementById('range-phy-end').value}`;
    document.getElementById('meta-chem-range').innerText = `Q${document.getElementById('range-chem-start').value} - Q${document.getElementById('range-chem-end').value}`;
    document.getElementById('meta-bio-range').innerText = `Q${document.getElementById('range-bio-start').value} - Q${document.getElementById('range-bio-end').value}`;
    
    // Populate textarea if there is a loaded answer key
    const rawKeys = [];
    Object.entries(test.answer_key || {}).forEach(([q, a]) => {
        rawKeys.push(`${q}. (${a})`);
    });
    document.getElementById('answer-key-input').value = rawKeys.join(' ');
    
    // Populate parsed answer key grid
    renderAnswerSheetTable();
    
    // Hooks
    document.getElementById('btn-back-slicer').onclick = () => showView('view-slicer');
    document.getElementById('btn-start-exam').onclick = startMockExam;
    
    showView('view-test-details');
}

function renderAnswerSheetTable() {
    const tbody = document.getElementById('parsed-answers-body');
    tbody.innerHTML = "";
    
    state.activeTest.crops.forEach(crop => {
        const count = crop.num_questions || 1;
        
        for (let i = 0; i < count; i++) {
            const qNum = crop.question_number + i;
            const qStr = qNum.toString();
            const sub = state.activeTest.subjects[qStr] || crop.subject;
            const currentAns = state.activeTest.answer_key[qStr] || "";
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>Q${qStr}</strong></td>
                <td><span class="badge ${sub.toLowerCase()}">${sub}</span></td>
                <td>
                    <select class="select-correct-option" data-question="${qStr}">
                        <option value="" ${currentAns === "" ? "selected" : ""}>Not Set</option>
                        <option value="1" ${currentAns === "1" || currentAns === "A" ? "selected" : ""}>Option (1) / A</option>
                        <option value="2" ${currentAns === "2" || currentAns === "B" ? "selected" : ""}>Option (2) / B</option>
                        <option value="3" ${currentAns === "3" || currentAns === "C" ? "selected" : ""}>Option (3) / C</option>
                        <option value="4" ${currentAns === "4" || currentAns === "D" ? "selected" : ""}>Option (4) / D</option>
                    </select>
                </td>
            `;
            
            tbody.appendChild(row);
        }
    });

    // Add change listeners
    tbody.querySelectorAll('.select-correct-option').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const q = e.target.dataset.question;
            state.activeTest.answer_key[q] = e.target.value;
        });
    });
}
