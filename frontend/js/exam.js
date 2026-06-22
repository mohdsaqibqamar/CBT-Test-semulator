/**
 * ==========================================================================
 * NEET/JEE CBT SIMULATOR: NTA-STYLE EXAM ENGINE
 * ==========================================================================
 */

let examState = {
    test_id: null,
    totalQuestions: 0,
    currentQuestionNum: 1,
    timerSeconds: 180 * 60,
    totalTimerSeconds: 180 * 60,
    timerInterval: null,
    userAnswers: {},       // { "1": "A", "2": "C" }
    questionStates: {},     // { "1": "not-visited", "2": "answered" }
    zoom: 100
};

// Start Exam Entry Point
async function startMockExam() {
    // Sync final answer key changes to Python first
    showLoader("Initializing exam engine...");
    try {
        const metadata = {
            title: state.activeTest.title,
            pages: state.activeTest.pages,
            crops: state.activeTest.crops,
            subjects: state.activeTest.subjects,
            answer_key: state.activeTest.answer_key
        };
        
        await apiCall('/api/save_test', {
            test_id: state.activeTest.test_id,
            metadata: metadata
        });
        
        setupExamSession();
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

// Launcher shortcut from dashboard take-test button
async function startMockTestSetup(testId) {
    showLoader("Loading exam papers...");
    try {
        const res = await apiCall('/api/get_test', { test_id: testId });
        state.activeTest = res.test;
        state.activeTest.test_id = testId;
        
        setupExamSession();
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

function setupExamSession() {
    const test = state.activeTest;
    
    // Set state variables
    examState.test_id = test.test_id;
    examState.totalQuestions = test.crops.reduce((sum, c) => sum + (c.num_questions || 1), 0);
    examState.currentQuestionNum = 1;
    examState.timerSeconds = state.activeTest.timerSeconds || (180 * 60);
    examState.totalTimerSeconds = examState.timerSeconds;
    examState.userAnswers = {};
    examState.zoom = 100;
    
    // Initialize question state mappings
    examState.questionStates = {};
    for (let i = 1; i <= examState.totalQuestions; i++) {
        examState.questionStates[i.toString()] = "not-visited";
    }
    examState.questionStates["1"] = "not-answered"; // First question starts active
    
    // Reset Timer visually
    const hrs = Math.floor(examState.timerSeconds / 3600);
    const mins = Math.floor((examState.timerSeconds % 3600) / 60);
    const secs = examState.timerSeconds % 60;
    const timeStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    document.getElementById('header-timer').innerText = timeStr;
    document.getElementById('exam-timer').innerText = timeStr;
    
    // Build Question Grid Palette
    buildExamPalette();
    
    // Initialize Zoom and Image Wrapper Width
    document.getElementById('exam-image-wrapper').style.width = `100%`;
    
    // Bind Sizing & Nav Listeners
    initExamListeners();
    
    // Start countdown clock
    startExamTimer();
    
    // Load Question 1
    loadExamQuestion(1);
    
    showView('view-exam');
}

/* ==========================================================================
   PALETTE & GRID CONSTRUCTORS
   ========================================================================== */

function buildExamPalette() {
    const palette = document.getElementById('exam-palette');
    palette.innerHTML = "";
    
    document.getElementById('exam-total-count').innerText = examState.totalQuestions;
    
    for (let i = 1; i <= examState.totalQuestions; i++) {
        const circle = document.createElement('div');
        const qStr = i.toString();
        
        circle.id = `palette-q-${qStr}`;
        circle.className = `palette-circle not-visited`;
        circle.innerText = i;
        circle.dataset.question = qStr;
        
        circle.addEventListener('click', () => {
            saveQuestionStateOnLeave();
            loadExamQuestion(i);
        });
        
        palette.appendChild(circle);
    }
    
    updateAnswerStats();
}

function updateAnswerStats() {
    let answeredCount = 0;
    Object.values(examState.questionStates).forEach(st => {
        if (st === 'answered' || st === 'marked-answered') answeredCount++;
    });
    document.getElementById('exam-answered-count').innerText = answeredCount;
}

/* ==========================================================================
   QUESTION VIEWER CONTROLLER
   ========================================================================== */

function loadExamQuestion(qNum) {
    examState.currentQuestionNum = qNum;
    const qStr = qNum.toString();
    
    // Get active crop block that contains this question
    const crop = state.activeTest.crops.find(c => {
        const start = c.question_number;
        const end = start + (c.num_questions || 1) - 1;
        return qNum >= start && qNum <= end;
    });
    if (!crop) return;
    
    // Highlight active in palette (only for the specifically clicked question)
    document.querySelectorAll('.palette-circle').forEach(c => c.classList.remove('active'));
    const circle = document.getElementById(`palette-q-${qStr}`);
    if (circle) {
        circle.classList.add('active');
        
        // Remove not-visited state
        if (examState.questionStates[qStr] === 'not-visited') {
            examState.questionStates[qStr] = 'not-answered';
            circle.className = `palette-circle not-answered active`;
        }
    }
    
    // Update labels
    const blockStart = crop.question_number;
    const blockEnd = blockStart + (crop.num_questions || 1) - 1;
    if (crop.num_questions > 1) {
        document.getElementById('exam-q-number').innerText = `${blockStart} - ${blockEnd}`;
    } else {
        document.getElementById('exam-q-number').innerText = qNum;
    }
    
    const subject = state.activeTest.subjects[qStr] || crop.subject;
    const subBadge = document.getElementById('exam-current-subject');
    subBadge.innerText = subject;
    subBadge.className = `subject-badge ${subject.toLowerCase()}`;
    
    // Load question crop image (avoid reload flicker if same image)
    const imgEl = document.getElementById('exam-question-image');
    if (!imgEl.src.includes(crop.image_url)) {
        imgEl.src = `${API_BASE}${crop.image_url}`;
    }
    
    // Render Multi-Question Options Panel
    renderOptionsBlock(crop, qNum);
    
    // Update subject filter tabs highlights
    document.querySelectorAll('.sub-tab').forEach(tab => {
        if (tab.dataset.subject === subject) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // Auto Scroll active palette item into viewport
    if (circle) {
        circle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    applyExamZoom();
}

function renderOptionsBlock(crop, focusedQNum) {
    const container = document.getElementById('exam-options-container');
    container.innerHTML = "";
    
    const qStr = focusedQNum.toString();
    
    const qDiv = document.createElement('div');
    qDiv.innerHTML = `
        <div class="options-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
            <label class="option-card" style="margin:0;">
                <input type="radio" name="exam-option-${focusedQNum}" value="A" ${examState.userAnswers[qStr] === 'A' ? 'checked' : ''}>
                <span class="opt-indicator">A</span> Option (1)
            </label>
            <label class="option-card" style="margin:0;">
                <input type="radio" name="exam-option-${focusedQNum}" value="B" ${examState.userAnswers[qStr] === 'B' ? 'checked' : ''}>
                <span class="opt-indicator">B</span> Option (2)
            </label>
            <label class="option-card" style="margin:0;">
                <input type="radio" name="exam-option-${focusedQNum}" value="C" ${examState.userAnswers[qStr] === 'C' ? 'checked' : ''}>
                <span class="opt-indicator">C</span> Option (3)
            </label>
            <label class="option-card" style="margin:0;">
                <input type="radio" name="exam-option-${focusedQNum}" value="D" ${examState.userAnswers[qStr] === 'D' ? 'checked' : ''}>
                <span class="opt-indicator">D</span> Option (4)
            </label>
        </div>
    `;
    
    container.appendChild(qDiv);
}

function applyExamZoom() {
    const imgEl = document.getElementById('exam-question-image');
    if (imgEl) {
        imgEl.style.width = `${examState.zoom}%`;
    }
}

/* ==========================================================================
   NAVIGATION ACTION HANDLERS
   ========================================================================== */

function getCurrentCropBlock() {
    return state.activeTest.crops.find(c => {
        const start = c.question_number;
        const end = start + (c.num_questions || 1) - 1;
        return examState.currentQuestionNum >= start && examState.currentQuestionNum <= end;
    });
}

function saveQuestionStateOnLeave() {
    const qNum = examState.currentQuestionNum;
    const qStr = qNum.toString();
    const circle = document.getElementById(`palette-q-${qStr}`);
    if (!circle) return;
    
    const selectedRadio = document.querySelector(`input[name="exam-option-${qNum}"]:checked`);
    const hasAnswer = !!selectedRadio;
    
    let stateClass = "not-answered";
    if (examState.questionStates[qStr] && examState.questionStates[qStr].includes('marked')) {
        stateClass = hasAnswer ? "marked-answered" : "marked";
    } else {
        stateClass = hasAnswer ? "answered" : "not-answered";
    }
    
    examState.questionStates[qStr] = stateClass;
    circle.className = `palette-circle ${stateClass}`;
    
    if (hasAnswer) {
        examState.userAnswers[qStr] = selectedRadio.value;
    }
    
    updateAnswerStats();
}

function handleSaveNext() {
    const qNum = examState.currentQuestionNum;
    const qStr = qNum.toString();
    const circle = document.getElementById(`palette-q-${qStr}`);
    const selectedRadio = document.querySelector(`input[name="exam-option-${qNum}"]:checked`);
    
    if (selectedRadio) {
        examState.userAnswers[qStr] = selectedRadio.value;
        examState.questionStates[qStr] = "answered";
        if (circle) circle.className = "palette-circle answered";
    } else {
        delete examState.userAnswers[qStr];
        examState.questionStates[qStr] = "not-answered";
        if (circle) circle.className = "palette-circle not-answered";
    }
    
    updateAnswerStats();
    
    const nextQ = qNum + 1;
    if (nextQ <= examState.totalQuestions) {
        loadExamQuestion(nextQ);
    } else {
        alert("You have reached the final question. You can review your answers or click Submit Exam!");
    }
}

function handleClearResponse() {
    const qNum = examState.currentQuestionNum;
    const qStr = qNum.toString();
    const circle = document.getElementById(`palette-q-${qStr}`);
    
    document.querySelectorAll(`input[name="exam-option-${qNum}"]`).forEach(r => r.checked = false);
    delete examState.userAnswers[qStr];
    
    let stateClass = "not-answered";
    if (examState.questionStates[qStr] && examState.questionStates[qStr].includes('marked')) {
        stateClass = "marked";
    }
    
    examState.questionStates[qStr] = stateClass;
    if (circle) circle.className = `palette-circle ${stateClass} active`;
    
    updateAnswerStats();
}

function handleMarkReviewNext() {
    const qNum = examState.currentQuestionNum;
    const qStr = qNum.toString();
    const circle = document.getElementById(`palette-q-${qStr}`);
    const selectedRadio = document.querySelector(`input[name="exam-option-${qNum}"]:checked`);
    
    if (selectedRadio) {
        examState.userAnswers[qStr] = selectedRadio.value;
        examState.questionStates[qStr] = "marked-answered";
        if (circle) circle.className = "palette-circle marked-answered";
    } else {
        delete examState.userAnswers[qStr];
        examState.questionStates[qStr] = "marked";
        if (circle) circle.className = "palette-circle marked";
    }
    
    updateAnswerStats();
    
    const nextQ = qNum + 1;
    if (nextQ <= examState.totalQuestions) {
        loadExamQuestion(nextQ);
    } else {
        alert("You have reached the final question. You can review your answers or click Submit Exam!");
    }
}

/* ==========================================================================
   TIMER COUNTDOWN
   ========================================================================== */

function startExamTimer() {
    if (examState.timerInterval) clearInterval(examState.timerInterval);
    
    const hTimer = document.getElementById('header-timer');
    const eTimer = document.getElementById('exam-timer');
    const timerCard = document.querySelector('.timer-card');
    
    timerCard.classList.remove('warning');
    
    examState.timerInterval = setInterval(() => {
        examState.timerSeconds--;
        
        if (examState.timerSeconds <= 0) {
            clearInterval(examState.timerInterval);
            alert("⏰ Time is up! Your responses will be submitted automatically.");
            forceSubmitExam();
            return;
        }
        
        // Time format calculation
        const hrs = Math.floor(examState.timerSeconds / 3600);
        const mins = Math.floor((examState.timerSeconds % 3600) / 60);
        const secs = examState.timerSeconds % 60;
        
        const timeStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        hTimer.innerText = timeStr;
        eTimer.innerText = timeStr;
        
        // Alert at 15 minutes remaining
        if (examState.timerSeconds === 15 * 60) {
            timerCard.classList.add('warning');
            alert("⚠️ Warning: Only 15 minutes remaining!");
        }
    }, 1000);
}

/* ==========================================================================
   SUBMIT EXAM
   ========================================================================== */

async function submitMockExam() {
    saveQuestionStateOnLeave(); // Catch current un-saved answer
    
    const unvisited = Object.values(examState.questionStates).filter(s => s === 'not-visited').length;
    const unanswered = Object.values(examState.questionStates).filter(s => s === 'not-answered').length;
    const answered = Object.values(examState.questionStates).filter(s => s === 'answered' || s === 'marked-answered').length;
    
    const confirmMsg = `
    Are you sure you want to Submit your Mock Test?
    
    - Total Questions: ${examState.totalQuestions}
    - Answered: ${answered}
    - Unanswered: ${unanswered + unvisited}
    
    Once submitted, you cannot modify your answers!
    `;
    
    if (confirm(confirmMsg)) {
        clearInterval(examState.timerInterval);
        
        showLoader("Evaluating your answers against parsed key...");
        
        try {
            const timeSpent = examState.totalTimerSeconds - examState.timerSeconds;
            
            const submitRes = await apiCall('/api/submit_result', {
                test_id: examState.test_id,
                answers: examState.userAnswers,
                time_taken: timeSpent
            });
            
            // Pass results and the result_id to analytics engine
            if (typeof renderScorecardReport === 'function') {
                renderScorecardReport(submitRes.results, submitRes.result_id);
            }
        } catch (err) {
            console.error(err);
        } finally {
            hideLoader();
        }
    }
}

async function forceSubmitExam() {
    clearInterval(examState.timerInterval);
    showLoader("Submitting answers...");
    try {
        const timeSpent = 200 * 60;
        const submitRes = await apiCall('/api/submit_result', {
            test_id: examState.test_id,
            answers: examState.userAnswers,
            time_taken: timeSpent
        });
        if (typeof renderScorecardReport === 'function') {
            renderScorecardReport(submitRes.results, submitRes.result_id);
        }
    } catch (err) {
        console.error(err);
    } finally {
        hideLoader();
    }
}

/* ==========================================================================
   ZOOM & INTERFACE BINDINGS
   ========================================================================== */

function initExamListeners() {
    // Options Actions
    document.getElementById('btn-save-next').onclick = handleSaveNext;
    document.getElementById('btn-clear-response').onclick = handleClearResponse;
    document.getElementById('btn-mark-review').onclick = handleMarkReviewNext;
    document.getElementById('btn-submit-exam').onclick = submitMockExam;
    
    // Zoom Canvas Elements
    document.getElementById('btn-exam-zoom-in').onclick = () => {
        examState.zoom = Math.min(200, examState.zoom + 10);
        applyExamZoom();
    };
    document.getElementById('btn-exam-zoom-out').onclick = () => {
        examState.zoom = Math.max(10, examState.zoom - 10);
        applyExamZoom();
    };
    document.getElementById('btn-exam-zoom-reset').onclick = () => {
        examState.zoom = 100;
        applyExamZoom();
    };
    
    // Subject Filter Tabs Shortcut Navigation
    document.querySelectorAll('.sub-tab').forEach(tab => {
        tab.onclick = (e) => {
            const selectedSub = e.target.dataset.subject;
            
            // Find first question matching that subject range
            const firstQ = state.activeTest.crops.find(c => c.subject === selectedSub);
            if (firstQ) {
                saveQuestionStateOnLeave();
                loadExamQuestion(firstQ.question_number);
            }
        };
    });
}
