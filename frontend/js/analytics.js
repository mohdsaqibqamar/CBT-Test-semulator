/**
 * ==========================================================================
 * NEET/JEE CBT SIMULATOR: ANALYTICS & SCORECARD RENDERER
 * ==========================================================================
 */

let activeResultData = null;
let activeResultId = null;
let reviewZoom = 100;

function renderScorecardReport(results, resultId = null) {
    activeResultData = results;
    if (resultId) {
        activeResultId = resultId;
    }
    
    // Set headers
    document.getElementById('scorecard-test-title').innerText = state.activeTest.title;
    
    // Overall Stats Sync
    const overall = results.overall;
    const scored = overall.score;
    const maxMarks = overall.total_questions * 4; // Max score metric
    
    document.getElementById('score-total').innerText = scored;
    document.getElementById('stat-correct').innerText = overall.correct;
    document.getElementById('stat-incorrect').innerText = overall.incorrect;
    document.getElementById('stat-skipped').innerText = overall.skipped;
    
    // Accuracy computation
    const totalAttempted = overall.correct + overall.incorrect;
    const accuracy = totalAttempted > 0 ? Math.round((overall.correct / totalAttempted) * 100) : 0;
    document.getElementById('stat-accuracy').innerText = `${accuracy}%`;
    
    // Render Subject-Wise Table Rows
    renderSubjectBreakdownTable(results.breakdown);
    
    // Render Clickable Sidebar Question Review
    renderReviewQuestionsSidebar("all");
    
    // Attach filter buttons hooks
    initReviewFilterHooks();
    
    // Automatically load the first question in the review pane
    if (overall.total_questions > 0) {
        loadReviewQuestion(1);
    }
    
    // Back to Profile/Dashboard Hook
    document.getElementById('btn-scorecard-back').onclick = () => {
        if (state.activeTest && state.activeTest.test_id) {
            showTestProfile(state.activeTest.test_id);
        } else {
            loadTestsList();
            showView('view-dashboard');
        }
    };
    
    // Setup Re-evaluate Button
    const btnReeval = document.getElementById('btn-scorecard-reevaluate');
    if (btnReeval) {
        btnReeval.onclick = handleScorecardReevaluate;
    }
    
    // Setup Review Zoom Buttons
    const btnZoomOut = document.getElementById('btn-review-zoom-out');
    const btnZoomIn = document.getElementById('btn-review-zoom-in');
    const btnZoomReset = document.getElementById('btn-review-zoom-reset');
    if (btnZoomOut) btnZoomOut.onclick = () => setReviewZoom(Math.max(10, reviewZoom - 10));
    if (btnZoomIn) btnZoomIn.onclick = () => setReviewZoom(Math.min(200, reviewZoom + 10));
    if (btnZoomReset) btnZoomReset.onclick = () => setReviewZoom(100);
    
    showView('view-scorecard');
}

function setReviewZoom(val) {
    reviewZoom = val;
    const imgEl = document.getElementById('review-display-image');
    if (imgEl) {
        imgEl.style.width = `${reviewZoom}%`;
    }
}

async function loadScorecardFromHistory(testId, resultId) {
    activeResultId = resultId;
    showLoader("Loading scorecard...");
    try {
        const res = await fetch(`${API_BASE}/data/${testId}/results/result_${resultId}.json?t=${Date.now()}`);
        if (!res.ok) throw new Error("Result not found on server");
        const results = await res.json();
        
        renderScorecardReport(results);
    } catch (err) {
        console.error(err);
        alert("Could not load scorecard data.");
    } finally {
        hideLoader();
    }
}

/* ==========================================================================
   SUBJECT WISE SCORE CARD TABLE
   ========================================================================== */

function renderSubjectBreakdownTable(breakdown) {
    const tbody = document.getElementById('scorecard-subject-body');
    tbody.innerHTML = "";
    
    let totalMaxMarks = 0;
    let grandScore = 0;
    let grandCorrect = 0;
    let grandIncorrect = 0;
    let grandSkipped = 0;
    
    Object.entries(breakdown).forEach(([subject, data]) => {
        const row = document.createElement('tr');
        const maxSubMarks = data.total * 4;
        
        totalMaxMarks += maxSubMarks;
        grandScore += data.score;
        grandCorrect += data.correct;
        grandIncorrect += data.incorrect;
        grandSkipped += data.skipped;
        
        row.innerHTML = `
            <td><strong>${subject}</strong></td>
            <td style="color:var(--color-answered)"><strong>${data.correct}</strong></td>
            <td style="color:var(--color-not-answered)"><strong>${data.incorrect}</strong></td>
            <td style="color:var(--color-general)"><strong>${data.skipped}</strong></td>
            <td>${maxSubMarks}</td>
            <td style="color:${data.score >= 0 ? 'var(--accent-blue)' : 'var(--color-not-answered)'}">
                <strong>${data.score}</strong>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    // Add Grand Summary Total Row at the bottom
    const totalRow = document.createElement('tr');
    totalRow.className = "grand-total-row";
    totalRow.style.borderTop = "2.5px solid var(--border-glass)";
    totalRow.style.background = "rgba(255,255,255,0.02)";
    
    totalRow.innerHTML = `
        <td><strong>Grand Total</strong></td>
        <td style="color:var(--color-answered)"><strong>${grandCorrect}</strong></td>
        <td style="color:var(--color-not-answered)"><strong>${grandIncorrect}</strong></td>
        <td style="color:var(--color-general)"><strong>${grandSkipped}</strong></td>
        <td><strong>${totalMaxMarks}</strong></td>
        <td style="color:var(--accent-blue); font-size:1.1rem"><strong>${grandScore}</strong></td>
    `;
    tbody.appendChild(totalRow);
}

/* ==========================================================================
   INTERACTIVE POST-EXAM REVIEW SIDEBAR & VIEWER
   ========================================================================== */

function renderReviewQuestionsSidebar(filterType) {
    const listContainer = document.getElementById('review-question-list');
    listContainer.innerHTML = "";
    
    const answers = activeResultData.answers;
    
    Object.entries(answers).forEach(([qNum, details]) => {
        const status = details.status; // 'correct', 'incorrect', 'skipped'
        
        // Apply filter logic
        if (filterType === 'incorrect' && status !== 'incorrect') return;
        if (filterType === 'skipped' && status !== 'skipped') return;
        
        const qCard = document.createElement('div');
        qCard.className = `review-q-card status-${status}`;
        qCard.dataset.question = qNum;
        
        // Find subject for tag
        const crop = state.activeTest.crops.find(c => {
            const start = c.question_number;
            const end = start + (c.num_questions || 1) - 1;
            const targetQ = parseInt(qNum);
            return targetQ >= start && targetQ <= end;
        });
        const sub = state.activeTest.subjects[qNum] || (crop ? crop.subject : "General");
        
        let badgeIcon = "⚪";
        if (status === 'correct') badgeIcon = "🟢";
        if (status === 'incorrect') badgeIcon = "🔴";
        
        qCard.innerHTML = `
            <div class="q-info">
                <span>Q${qNum}</span>
                <div class="q-sub">${sub}</div>
            </div>
            <div class="status-indicator">${badgeIcon}</div>
        `;
        
        qCard.onclick = () => {
            document.querySelectorAll('.review-q-card').forEach(c => c.classList.remove('active'));
            qCard.classList.add('active');
            loadReviewQuestion(parseInt(qNum));
        };
        
        listContainer.appendChild(qCard);
    });
}

function loadReviewQuestion(qNum) {
    const qStr = qNum.toString();
    const details = activeResultData.answers[qStr];
    if (!details) return;
    
    const crop = state.activeTest.crops.find(c => {
        const start = c.question_number;
        const end = start + (c.num_questions || 1) - 1;
        return qNum >= start && qNum <= end;
    });
    if (!crop) return;
    
    // Set headers
    document.getElementById('review-display-num').innerText = qNum;
    
    // Set status badge visual
    const statusBadge = document.getElementById('review-display-status');
    const status = details.status;
    
    if (status === 'correct') {
        statusBadge.innerText = "Correct";
        statusBadge.className = "badge success";
    } else if (status === 'incorrect') {
        statusBadge.innerText = "Incorrect";
        statusBadge.className = "badge chemistry";
    } else {
        statusBadge.innerText = "Skipped";
        statusBadge.className = "badge general";
    }
    
    // Set Crop Image source
    const imgEl = document.getElementById('review-display-image');
    imgEl.src = `${API_BASE}${crop.image_url}`;
    imgEl.style.width = `${reviewZoom}%`;
    
    // Sync marked option labels (Option mapping: A, B, C, D)
    const mapValToAlpha = { "1": "A", "2": "B", "3": "C", "4": "D", "A": "A", "B": "B", "C": "C", "D": "D" };
    
    const rawUserAns = details.user_answer;
    const rawCorrectAns = details.correct_answer;
    
    const userDisplay = rawUserAns ? mapValToAlpha[rawUserAns] || rawUserAns : "Skipped";
    const correctDisplay = mapValToAlpha[rawCorrectAns] || rawCorrectAns || "Not set";
    
    const uLabel = document.getElementById('review-user-ans');
    uLabel.innerText = userDisplay;
    
    // Style user answer color according to score accuracy
    if (status === 'correct') {
        uLabel.className = "val badge success";
    } else if (status === 'incorrect') {
        uLabel.className = "val badge chemistry";
    } else {
        uLabel.className = "val badge general";
    }
    
    document.getElementById('review-correct-ans').innerText = correctDisplay;
    
    // Sync active highlight class in list sidebar
    document.querySelectorAll('.review-q-card').forEach(card => {
        if (card.dataset.question === qStr) {
            card.classList.add('active');
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            card.classList.remove('active');
        }
    });
}

function initReviewFilterHooks() {
    document.querySelectorAll('.review-header .filter-buttons button').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.review-header .filter-buttons button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const filter = e.target.dataset.filter;
            renderReviewQuestionsSidebar(filter);
            
            // Reload the first visible question
            const listItems = document.querySelectorAll('.review-q-card');
            if (listItems.length > 0) {
                const firstQNum = parseInt(listItems[0].dataset.question);
                loadReviewQuestion(firstQNum);
            }
        };
    });
}

/* ==========================================================================
   RE-EVALUATE RESULT WITH NEW ANSWER KEY
   ========================================================================== */

async function handleScorecardReevaluate() {
    const text = document.getElementById('scorecard-answer-input').value.trim();
    if (!text) {
        alert("Please paste the answer key text first!");
        return;
    }
    if (!state.activeTest || !state.activeTest.test_id || !activeResultId || !activeResultData) {
        alert("Cannot re-evaluate. Missing context.");
        return;
    }

    // Reuse parser logic
    const parsedKey = {};
    const bracketRegex = /(\d+)\s*[\s.:\-=\(]*\(([A-D1-4])\)/gi;
    const separatorRegex = /(\d+)\s*[\s.:\-=\s]+([A-D1-4])\b/gi;
    let match;
    let count = 0;
    
    while ((match = bracketRegex.exec(text)) !== null) {
        parsedKey[match[1]] = sanitizeAnswer(match[2].toUpperCase());
        count++;
    }
    if (count === 0) {
        while ((match = separatorRegex.exec(text)) !== null) {
            parsedKey[match[1]] = sanitizeAnswer(match[2].toUpperCase());
            count++;
        }
    }
    if (count === 0) {
        const lines = text.split('\n');
        lines.forEach(line => {
            const parts = line.split(/[\s.:\-=\t]+/);
            if (parts.length >= 2) {
                const qNum = parts[0].trim();
                const rawAns = parts[1].trim().toUpperCase();
                if (/^\d+$/.test(qNum) && /^[A-D1-4]$/.test(rawAns)) {
                    parsedKey[qNum] = sanitizeAnswer(rawAns);
                    count++;
                }
            }
        });
    }

    if (count === 0) {
        alert("Could not parse any correct answers. Please verify your format!");
        return;
    }

    showLoader("Saving answer key and re-evaluating...");
    try {
        // Merge into active state
        state.activeTest.answer_key = state.activeTest.answer_key || {};
        Object.assign(state.activeTest.answer_key, parsedKey);
        
        // 1. Save new metadata
        const saveData = {
            test_id: state.activeTest.test_id,
            metadata: {
                test_id: state.activeTest.test_id,
                title: state.activeTest.title,
                timerSeconds: state.activeTest.timerSeconds,
                pages: state.activeTest.pages,
                crops: state.activeTest.crops,
                subjects: state.activeTest.subjects || {},
                answer_key: state.activeTest.answer_key
            }
        };
        const saveRes = await apiCall('/api/save_test', saveData);
        if (saveRes.error) throw new Error(saveRes.error);
        
        // 2. Submit user answers again to overwrite the result
        const userAnswers = {};
        Object.entries(activeResultData.answers).forEach(([q, details]) => {
            if (details.user_answer) {
                userAnswers[q] = details.user_answer;
            }
        });
        
        const submitData = {
            test_id: state.activeTest.test_id,
            result_id: activeResultId,
            answers: userAnswers,
            time_taken: activeResultData.time_taken || 0
        };
        const submitRes = await apiCall('/api/submit_result', submitData);
        if (submitRes.error) throw new Error(submitRes.error);
        
        alert(`Successfully mapped ${count} answers and re-evaluated!`);
        document.getElementById('scorecard-answer-input').value = ""; // Clear input
        
        // Reload scorecard
        await loadScorecardFromHistory(state.activeTest.test_id, activeResultId);
        
    } catch (err) {
        console.error(err);
        alert("Failed to re-evaluate: " + err.message);
    } finally {
        hideLoader();
    }
}
