/**
 * ==========================================================================
 * NEET/JEE CBT SIMULATOR: SMART ANSWER KEY PARSER
 * ==========================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
    const btnParse = document.getElementById('btn-parse-answers');
    if (btnParse) {
        btnParse.addEventListener('click', parseRawAnswerInput);
    }
});

function parseRawAnswerInput() {
    const text = document.getElementById('answer-key-input').value.trim();
    if (!text) {
        alert("Please enter answer sheet text first!");
        return;
    }

    const parsedKey = {};
    
    // Regular Expression patterns to match common answer key formats:
    // Format 1: 1. (3) or 1. (C)
    // Format 2: 1-C or 1 - 3
    // Format 3: 1:3 or 1:C
    // Format 4: 1. 3 or 1. C
    // Regex matches: Group 1 = Question Number, Group 2 = Option (A,B,C,D or 1,2,3,4)
    
    // Pattern 1: Matches bracketed formats like "1. (3)" or "1 (C)"
    const bracketRegex = /(\d+)\s*[\s.:\-=\(]*\(([A-D1-4])\)/gi;
    
    // Pattern 2: Matches standard separator formats like "1 - C", "1:3", "1. 3"
    const separatorRegex = /(\d+)\s*[\s.:\-=\s]+([A-D1-4])\b/gi;
    
    let match;
    let count = 0;
    
    // First try bracketed match
    while ((match = bracketRegex.exec(text)) !== null) {
        const qNum = match[1];
        const rawAns = match[2].toUpperCase();
        parsedKey[qNum] = sanitizeAnswer(rawAns);
        count++;
    }
    
    // If no bracketed matches found, try standard separator format
    if (count === 0) {
        while ((match = separatorRegex.exec(text)) !== null) {
            const qNum = match[1];
            const rawAns = match[2].toUpperCase();
            parsedKey[qNum] = sanitizeAnswer(rawAns);
            count++;
        }
    }
    
    // Fallback: If still nothing, split by newlines and try to search key pairs
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
        alert("Could not parse any correct answers. Please verify your format!\nEnsure format resembles: 1. (3) 2. (1) or 1-A 2-C");
        return;
    }

    // Merge into active state
    Object.assign(state.activeTest.answer_key, parsedKey);
    
    // Show success message and re-render table
    alert(`Successfully parsed ${count} answers into the table!`);
    renderAnswerSheetTable();
}

/**
 * Standardize answers to numbers "1", "2", "3", "4" for reliable comparison
 */
function sanitizeAnswer(rawVal) {
    const clean = rawVal.toString().trim().toUpperCase();
    const map = {
        "A": "1", "B": "2", "C": "3", "D": "4",
        "1": "1", "2": "2", "3": "3", "4": "4"
    };
    return map[clean] || clean;
}
