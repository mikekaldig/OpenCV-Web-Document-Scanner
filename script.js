let cvReady = false;
let stream = null;
const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

// DOM Elements
const mainMenu = document.getElementById('main-menu');
const scannerView = document.getElementById('scanner-view');
const resultView = document.getElementById('result-view');
const startButton = document.getElementById('start-button');
const captureButton = document.getElementById('capture-button');
const rescanButton = document.getElementById('rescan-button');
const statusMessage = document.getElementById('status-message');
const resultImage = document.getElementById('result-image');
const downloadLink = document.getElementById('download-link');

// v1.2: Debug Panel Elements
const debugPanel = document.getElementById('debug-panel');
const debugContent = document.getElementById('debug-content');
const debugToggle = document.getElementById('debug-toggle');
const clearLog = document.getElementById('clear-log');

// Performance-Optimierung für Mobilgeräte
const MAX_PROCESSING_WIDTH = 640;

let biggestContour = null;
let documentStableCount = 0;
let autoScanTimer = null;
const STABLE_FRAMES_REQUIRED = 15; // Kürzere Zeit für mobile Geräte
const AUTO_SCAN_DELAY = 1500; // Kürzere Verzögerung

// v1.3.1: Optimierte Multi-Frame Processing Variablen
const FRAME_HISTORY_SIZE = 4; // Optimiert: 4 Frames für bessere Performance
const CONFIDENCE_THRESHOLD = 0.62; // v1.3.2: leicht gesenkt für bessere Erkennung bei schwieriger Beleuchtung
const HIGH_CONFIDENCE_THRESHOLD = 0.85; // Neu: Threshold für sofortige Erkennung
let frameHistory = []; // History der letzten Frames
let contourHistory = []; // History der gefundenen Konturen
let confidenceHistory = []; // History der Confidence-Werte
let frameCounter = 0;

// v1.3.1: Performance Monitoring & Validation
let performanceStats = {
    avgFrameTime: 0,
    frameCount: 0,
    lastFrameTime: performance.now(),
    adaptiveThreshold: CONFIDENCE_THRESHOLD
};

// v1.3.1: Erweiterte Validierungs-Metriken
let validationStats = {
    sessionStart: Date.now(),
    totalScans: 0,
    successfulScans: 0,
    failedScans: 0,
    avgConfidenceScore: 0,
    highConfidenceScans: 0,
    documentDetections: 0,
    documentLosses: 0,
    stabilityScore: 0,
    performanceBenchmarks: {
        fastFrames: 0,    // < 50ms
        normalFrames: 0,  // 50-100ms
        slowFrames: 0,    // > 100ms
        avgProcessingTime: 0
    },
    qualityMetrics: {
        avgDocumentArea: 0,
        avgRectangularityScore: 0,
        avgAspectRatioScore: 0,
        frameStabilityCount: 0
    }
};

// --- Initialization ---
function onOpenCvReady() {
    console.log('OpenCV is ready.');
    console.log('cv object:', typeof cv !== 'undefined' ? 'verfügbar' : 'nicht verfügbar');
    cvReady = true;
    startButton.disabled = false;
    startButton.textContent = 'Scan starten';
    console.log('Start-Button aktiviert');

    // v1.3.2: Debug logging mit Session-Start (Basis 1.3.1)
    addDebugLog('🚀 <span style="color: #0f0">OpenCV geladen</span> - v1.3.2 (Basis 1.3.1) bereit');
    addDebugLog(`📱 Browser: ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'}`);
    addDebugLog(`🎯 Multi-Frame: ${FRAME_HISTORY_SIZE} Frames | Confidence: ${CONFIDENCE_THRESHOLD}`);
    addDebugLog(`⚡ Performance: ${MAX_PROCESSING_WIDTH}px | Auto-Scan: ${AUTO_SCAN_DELAY}ms`);
    addDebugLog(`🔬 <span style="color: #0af">Validation-System aktiviert</span> - Session: ${new Date().toLocaleTimeString()}`);
}

// Fallback falls OpenCV nicht lädt
setTimeout(() => {
    if (!cvReady) {
        console.error('OpenCV hat nach 10 Sekunden nicht geladen');
        startButton.textContent = 'OpenCV Ladefehler';
        startButton.disabled = true;
    }
}, 10000);

// --- Event Listeners ---
startButton.addEventListener('click', startScanner);
captureButton.addEventListener('click', captureAndWarp);
rescanButton.addEventListener('click', () => {
    resultView.classList.add('hidden');
    if (biggestContour) {
        biggestContour.delete();
        biggestContour = null;
    }
    startScanner();
});

// v1.2: Debug Panel Event Listeners
debugToggle.addEventListener('click', () => {
    if (debugPanel.style.display === 'none' || !debugPanel.style.display) {
        debugPanel.style.display = 'block';
        debugToggle.textContent = 'Hide Logs';
    } else {
        debugPanel.style.display = 'none';
        debugToggle.textContent = 'Show Logs';
    }
});

clearLog.addEventListener('click', () => {
    debugContent.innerHTML = '';
    addDebugLog('Debug log cleared');
});

// v1.2: Debug Logging Function
function addDebugLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.style.borderBottom = '1px solid #222';
    logEntry.style.padding = '2px 0';
    logEntry.innerHTML = `<span style="color: #666">${timestamp}</span> ${message}`;
    debugContent.appendChild(logEntry);

    // Auto-scroll to bottom
    debugContent.scrollTop = debugContent.scrollHeight;

    // Längere Logs bei zu vielen Einträgen kürzen (Performance)
    if (debugContent.children.length > 500) {
        for (let i = 0; i < 100; i++) {
            debugContent.removeChild(debugContent.firstChild);
        }
    }

    // Limit to 100 log entries
    while (debugContent.children.length > 100) {
        debugContent.removeChild(debugContent.firstChild);
    }

    // Also log to console
    console.log(`[${timestamp}] ${message}`);
}

// --- Core Functions ---
async function startScanner() {
    console.log('startScanner aufgerufen, cvReady:', cvReady);
    if (!cvReady) {
        console.error('OpenCV noch nicht bereit');
        return;
    }
    console.log('Versuche Kamera-Zugriff...');
    try {
        const constraints = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
        console.log('Rufe getUserMedia auf mit constraints:', constraints);
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Stream erhalten:', stream);
        video.srcObject = stream;
        console.log('Video srcObject gesetzt');

        video.onloadedmetadata = () => {
            console.log('Video metadata geladen');
            video.play();
            mainMenu.classList.add('hidden');
            scannerView.classList.remove('hidden');

            setTimeout(() => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const videoRect = video.getBoundingClientRect();
                canvas.style.width = videoRect.width + 'px';
                canvas.style.height = videoRect.height + 'px';
                canvas.style.top = video.offsetTop + 'px';
                canvas.style.left = video.offsetLeft + 'px';
                requestAnimationFrame(processFrame);
            }, 100);
        };

    } catch (err) {
        statusMessage.textContent = `Kamera-Fehler: ${err.message}`;
        console.error('Error accessing camera:', err);
    }
}

function stopScanner() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    if (autoScanTimer) {
        clearTimeout(autoScanTimer);
        autoScanTimer = null;
    }
    documentStableCount = 0;

    // v1.3: Cleanup Multi-Frame History
    cleanupHistory();

    scannerView.classList.add('hidden');
}

// v1.3: Cleanup Function für Multi-Frame Data
function cleanupHistory() {
    // Frame History aufräumen
    frameHistory.forEach(frame => {
        if (frame && !frame.isDeleted()) frame.delete();
    });
    frameHistory = [];

    // Contour History aufräumen
    contourHistory.forEach(entry => {
        if (entry.contour && !entry.contour.isDeleted()) entry.contour.delete();
    });
    contourHistory = [];

    confidenceHistory = [];
    frameCounter = 0;

    addDebugLog('🧹 <span style="color: #888">Multi-Frame History bereinigt</span>');
}

function processFrame() {
    if (!stream || !video.videoWidth) {
        requestAnimationFrame(processFrame);
        return;
    }

    // v1.3.1: Performance Monitoring
    const frameStart = performance.now();

    let src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
    let scaled = new cv.Mat();
    let gray = new cv.Mat();
    let thresh = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let tempCanvas = document.createElement('canvas');
    let tempCtx = tempCanvas.getContext('2d');

    try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Stabile Methode zur Bilderfassung
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        src.data.set(tempCtx.getImageData(0, 0, video.videoWidth, video.videoHeight).data);
        
        // Skalierungsfaktor berechnen
        const scale = MAX_PROCESSING_WIDTH / video.videoWidth;
        const dsize = new cv.Size(MAX_PROCESSING_WIDTH, video.videoHeight * scale);
        cv.resize(src, scaled, dsize, 0, 0, cv.INTER_AREA);

        // v1.3: Enhanced Pipeline with Multi-Frame Processing
        cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
        frameCounter++;

        // v1.3: Multi-Frame Processing
        addToFrameHistory(gray);

        // Stage 1: Frame Averaging (wenn genügend Frames vorhanden)
        let processFrame = gray;
        let avgFrame = calculateFrameAverage();
        if (avgFrame && frameHistory.length >= 3) {
            processFrame = avgFrame;
        }

        // Stage 2: Bilateral Filter für Rauschreduzierung
        let filtered = new cv.Mat();
        try {
            cv.bilateralFilter(processFrame, filtered, 9, 75, 75);

            // Stage 3: Adaptive Canny Thresholds
            const medianVal = calculateSimpleMedian(filtered);
            const sigma = 0.33;
            const lower = Math.max(0, (1.0 - sigma) * medianVal);
            const upper = Math.min(255, (1.0 + sigma) * medianVal);

            cv.Canny(filtered, thresh, lower, upper);

            // Stage 4: Morphologische Operationen
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
            cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernel);

            cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // v1.3: Enhanced Debug-Logging mit Multi-Frame Info
            const debugInfo = `v1.3: ${contours.size()} Konturen, Frame#${frameCounter}, Avg:${avgFrame ? 'Y' : 'N'}, Canny(${lower.toFixed(1)}, ${upper.toFixed(1)})`;
            console.log(debugInfo);

            // Web-Debug für Handy
            if (contours.size() > 0) {
                addDebugLog(`🎬 Frame ${frameCounter} | <span style="color: #0ff">${contours.size()}</span> Konturen | ${avgFrame ? '<span style="color: #0f0">Multi-Frame</span>' : 'Single'} | Canny(<span style="color: #ff0">${lower.toFixed(1)}</span>, <span style="color: #ff0">${upper.toFixed(1)}</span>)`);
            }

            kernel.delete();
            if (avgFrame) avgFrame.delete();
        } catch (error) {
            console.error('v1.3 Pipeline Error:', error.message);
            addDebugLog(`❌ <span style="color: #f00">Pipeline Error:</span> ${error.message}`);
            // Fallback zur v1.1 Pipeline bei Fehlern
            cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
            cv.Canny(gray, thresh, 50, 100);
            cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            console.log(`v1.3: ${contours.size()} Konturen (Fallback)`);
            addDebugLog(`🔄 <span style="color: #fa0">Fallback aktiv:</span> ${contours.size()} Konturen`);
        } finally {
            if (filtered && !filtered.isDeleted()) filtered.delete();
            if (avgFrame && !avgFrame.isDeleted()) avgFrame.delete();
        }

        // v1.3: Confidence-basierte Dokumenterkennung
        let foundContour = findDocumentContour(contours, scale);
        let confidence = 0.0;

        if (foundContour) {
            confidence = calculateContourConfidence(foundContour, {width: MAX_PROCESSING_WIDTH, height: video.videoHeight * scale});
            addToContourHistory(foundContour, confidence);

            // Temporal Stabilization - verwende historisch beste Kontur
            let stabilizedContour = getTemporallyStabilizedContour();
            if (stabilizedContour) {
                if (foundContour) foundContour.delete();
                foundContour = stabilizedContour;
            }
        }

        const resultInfo = `v1.3: Dokument ${foundContour ? 'GEFUNDEN' : 'NICHT GEFUNDEN'}, Confidence: ${confidence.toFixed(2)}`;
        console.log(resultInfo);

        // Web-Debug für Dokumenterkennung mit erweiterten Validierungs-Metriken
        if (foundContour && confidence >= CONFIDENCE_THRESHOLD) {
            let avgConfidence = confidenceHistory.length > 0 ?
                (confidenceHistory.reduce((a, b) => a + b, 0) / confidenceHistory.length) : confidence;

            // Validierungs-Statistiken aktualisieren
            validationStats.documentDetections++;
            validationStats.avgConfidenceScore = (validationStats.avgConfidenceScore * (validationStats.documentDetections - 1) + confidence) / validationStats.documentDetections;

            if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
                validationStats.highConfidenceScans++;
            }

            addDebugLog(`📄 <span style="color: #0f0">DOKUMENT GEFUNDEN!</span> Conf: <span style="color: #ff0">${confidence.toFixed(2)}</span> | Avg: <span style="color: #f80">${avgConfidence.toFixed(2)}</span> | History: ${contourHistory.length}/${FRAME_HISTORY_SIZE} | Erkennungen: ${validationStats.documentDetections}`);

            // Server-Log für wichtige Dokument-Erkennungen (nur High-Confidence)
            if (confidence >= HIGH_CONFIDENCE_THRESHOLD && validationStats.documentDetections % 10 === 0) {
                logErrorToServer(`DOCUMENT_DETECTION: ${JSON.stringify({
                    confidence: confidence,
                    avgConfidence: avgConfidence,
                    detectionCount: validationStats.documentDetections,
                    timestamp: new Date().toISOString()
                })}`);
            }
        } else if (foundContour && confidence < CONFIDENCE_THRESHOLD) {
            validationStats.documentLosses++;
            addDebugLog(`🔍 <span style="color: #fa0">Dokument unsicher...</span> Conf: <span style="color: #f00">${confidence.toFixed(2)}</span> < ${CONFIDENCE_THRESHOLD} | Verluste: ${validationStats.documentLosses}`);
        } else if (contours.size() > 0) {
            addDebugLog(`🔍 <span style="color: #fa0">Suche Dokument...</span> ${contours.size()} Konturen, aber kein Dokument`);
        }

        // v1.3: Nur Konturen mit ausreichender Confidence verwenden
        if (foundContour && confidence >= CONFIDENCE_THRESHOLD) {
            if (biggestContour) {
                if (isContourSimilar(biggestContour, foundContour)) {
                    documentStableCount++;
                } else {
                    documentStableCount = 0;
                }
                biggestContour.delete();
            } else {
                documentStableCount = 0;
            }

            biggestContour = foundContour;
            drawContour(biggestContour, 1 / scale); 
            
            if (documentStableCount >= STABLE_FRAMES_REQUIRED) {
                statusMessage.textContent = 'Stabil erkannt. Scan wird ausgelöst...';
                if (!autoScanTimer) {
                    addDebugLog(`📸 <span style="color: #0f0">AUTO-SCAN</span> wird in ${AUTO_SCAN_DELAY}ms ausgelöst`);
                    autoScanTimer = setTimeout(() => {
                        safeCapture();
                        autoScanTimer = null;
                    }, AUTO_SCAN_DELAY);
                }
            } else {
                statusMessage.textContent = `Dokument erkannt! (${documentStableCount}/${STABLE_FRAMES_REQUIRED})`;
                if (autoScanTimer) clearTimeout(autoScanTimer);
                autoScanTimer = null;
            }
        } else {
            documentStableCount = 0;
            statusMessage.textContent = 'Suche Dokument...';
            if (biggestContour) biggestContour.delete();
            biggestContour = null;
            if (autoScanTimer) clearTimeout(autoScanTimer);
            autoScanTimer = null;
        }

    } catch (error) {
        console.error('Error in processFrame:', error);
        logErrorToServer(error); // Fehler an den Server loggen
    } finally {
        src.delete();
        scaled.delete();
        gray.delete();
        thresh.delete();
        contours.delete();
        hierarchy.delete();
    }

    // v1.3.1: Performance Monitoring & Validation
    const frameTime = performance.now() - frameStart;
    performanceStats.frameCount++;
    performanceStats.avgFrameTime = (performanceStats.avgFrameTime * (performanceStats.frameCount - 1) + frameTime) / performanceStats.frameCount;

    // Performance-Kategorisierung für Benchmarks
    if (frameTime < 50) {
        validationStats.performanceBenchmarks.fastFrames++;
    } else if (frameTime <= 100) {
        validationStats.performanceBenchmarks.normalFrames++;
    } else {
        validationStats.performanceBenchmarks.slowFrames++;
    }
    validationStats.performanceBenchmarks.avgProcessingTime = performanceStats.avgFrameTime;

    // Adaptive Threshold basierend auf Performance
    if (frameTime > 100 && performanceStats.adaptiveThreshold < 0.75) { // Slow device
        performanceStats.adaptiveThreshold = Math.min(0.75, performanceStats.adaptiveThreshold + 0.01);
    } else if (frameTime < 50 && performanceStats.adaptiveThreshold > 0.60) { // Fast device
        performanceStats.adaptiveThreshold = Math.max(0.60, performanceStats.adaptiveThreshold - 0.01);
    }

    // Erweiterte Performance Debug & Validation alle 60 Frames
    if (performanceStats.frameCount % 60 === 0) {
        const sessionDuration = (Date.now() - validationStats.sessionStart) / 1000;
        const fps = performanceStats.frameCount / sessionDuration;

        addDebugLog(`⚡ <span style="color: #0af">Performance:</span> ${frameTime.toFixed(1)}ms/frame (Avg: ${performanceStats.avgFrameTime.toFixed(1)}ms) | FPS: ${fps.toFixed(1)} | Adaptive: ${performanceStats.adaptiveThreshold.toFixed(2)}`);
        addDebugLog(`📊 <span style="color: #fa0">Benchmarks:</span> Fast:${validationStats.performanceBenchmarks.fastFrames} Normal:${validationStats.performanceBenchmarks.normalFrames} Slow:${validationStats.performanceBenchmarks.slowFrames}`);

        logValidationSummary();

        // Automatische System-Gesundheitsprüfung alle 5 Minuten (300 Frames bei ~60 FPS)
        if (performanceStats.frameCount % 300 === 0) {
            const healthCheck = validateSystemHealth();
            if (healthCheck.status !== 'insufficient_data') {
                addDebugLog(`🏥 <span style="color: #0af">SYSTEM HEALTH:</span> ${healthCheck.status}`);
                if (healthCheck.issues.length > 0) {
                    healthCheck.issues.forEach(issue => addDebugLog(`  ${issue}`));
                }
                if (healthCheck.warnings.length > 0) {
                    healthCheck.warnings.forEach(warning => addDebugLog(`  ${warning}`));
                }
                console.log('HEALTH_CHECK:', JSON.stringify(healthCheck));
                logErrorToServer(`HEALTH_CHECK: ${JSON.stringify(healthCheck)}`);
            }
        }
    }

    requestAnimationFrame(processFrame);
}

function findDocumentContour(contours, scale) {
    let maxArea = 0;
    let biggest = null;
    const minArea = (MAX_PROCESSING_WIDTH * MAX_PROCESSING_WIDTH) * 0.05; // Mindestfläche 5% des Bildes

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt, false);
        if (area > minArea) {
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
            if (approx.rows === 4) {
                if (area > maxArea) {
                    if (biggest) biggest.delete();
                    maxArea = area;
                    biggest = approx.clone();
                }
            }
            approx.delete();
        }
        cnt.delete();
    }
    return biggest;
}

function drawContour(contour, scale) {
    ctx.beginPath();
    ctx.moveTo(contour.data32S[0] * scale, contour.data32S[1] * scale);
    for (let i = 1; i < contour.rows; i++) {
        ctx.lineTo(contour.data32S[i * 2] * scale, contour.data32S[i * 2 + 1] * scale);
    }
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.7)';
    ctx.stroke();
}

function isContourSimilar(c1, c2) {
    // ... (Implementierung kann für den Moment vereinfacht werden)
    return true;
}

// v1.2: Sichere Helper Functions für Enhanced Edge Detection
function calculateSimpleMedian(mat) {
    try {
        // Vereinfachte Median-Berechnung mit Sampling für Performance
        let data = mat.data;
        let sampleSize = Math.min(10000, data.length); // Max 10k Pixel samplen
        let step = Math.floor(data.length / sampleSize);

        let samples = [];
        for (let i = 0; i < data.length; i += step) {
            samples.push(data[i]);
        }

        samples.sort((a, b) => a - b);
        let median = samples[Math.floor(samples.length / 2)];

        // Sanity check
        return (median >= 0 && median <= 255) ? median : 128;
    } catch (error) {
        console.warn('calculateSimpleMedian error, using fallback:', error.message);
        return 128; // Sicherer Fallback
    }
}

// v1.3: Multi-Frame Processing Helper Functions
function addToFrameHistory(grayFrame) {
    // Kopiere Frame für History
    let frameCopy = grayFrame.clone();
    frameHistory.push(frameCopy);

    // Begrenze History-Größe
    if (frameHistory.length > FRAME_HISTORY_SIZE) {
        let oldFrame = frameHistory.shift();
        oldFrame.delete();
    }
}

function calculateFrameAverage() {
    if (frameHistory.length < 2) return null;

    try {
        let avgFrame = new cv.Mat.zeros(frameHistory[0].rows, frameHistory[0].cols, cv.CV_32FC1);

        // Summiere alle Frames
        for (let i = 0; i < frameHistory.length; i++) {
            let tempFrame = new cv.Mat();
            frameHistory[i].convertTo(tempFrame, cv.CV_32FC1);
            cv.add(avgFrame, tempFrame, avgFrame);
            tempFrame.delete();
        }

        // Teile durch Anzahl Frames
        cv.divide(avgFrame, new cv.Scalar(frameHistory.length), avgFrame);

        // Zurück zu 8-bit
        let result = new cv.Mat();
        avgFrame.convertTo(result, cv.CV_8UC1);
        avgFrame.delete();

        return result;
    } catch (error) {
        console.warn('calculateFrameAverage error:', error.message);
        return null;
    }
}

function calculateContourConfidence(contour, frameSize) {
    try {
        // Confidence basierend auf verschiedenen Faktoren
        let area = cv.contourArea(contour);
        let perimeter = cv.arcLength(contour, true);

        // Relative Größe (sollte nicht zu klein/groß sein)
        let relativeArea = area / (frameSize.width * frameSize.height);
        let areaScore = Math.max(0, 1 - Math.abs(relativeArea - 0.3) * 2); // Optimal bei ~30% der Bildfläche

        // Rechteckigkeit (Dokumente sind meist rechteckig)
        let approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
        let rectangularityScore = approx.rows === 4 ? 1.0 : Math.max(0, 1 - Math.abs(approx.rows - 4) * 0.2);
        approx.delete();

        // Aspekt-Verhältnis (Dokumente haben bestimmte Proportionen)
        let rect = cv.boundingRect(contour);
        let aspectRatio = Math.max(rect.width, rect.height) / Math.min(rect.width, rect.height);
        let aspectScore = aspectRatio < 2.0 ? 1.0 : Math.max(0, 1 - (aspectRatio - 2.0) * 0.3);

        // Gesamtconfidence (gewichteter Durchschnitt)
        let confidence = (areaScore * 0.4 + rectangularityScore * 0.4 + aspectScore * 0.2);

        return Math.max(0, Math.min(1, confidence));
    } catch (error) {
        console.warn('calculateContourConfidence error:', error.message);
        return 0.0;
    }
}

function addToContourHistory(contour, confidence) {
    // Nur Konturen mit ausreichender Confidence hinzufügen
    if (confidence >= CONFIDENCE_THRESHOLD) {
        contourHistory.push({
            contour: contour.clone(),
            confidence: confidence,
            timestamp: Date.now()
        });
        confidenceHistory.push(confidence);

        // Begrenze History-Größe
        if (contourHistory.length > FRAME_HISTORY_SIZE) {
            let oldEntry = contourHistory.shift();
            oldEntry.contour.delete();
            confidenceHistory.shift();
        }
    }
}

function getTemporallyStabilizedContour() {
    if (contourHistory.length < 2) return null;

    // Finde Kontur mit höchster durchschnittlicher Confidence der letzten Frames
    let avgConfidence = confidenceHistory.reduce((a, b) => a + b, 0) / confidenceHistory.length;

    if (avgConfidence >= CONFIDENCE_THRESHOLD) {
        // Nimm die neueste Kontur mit höchster Confidence
        let bestEntry = contourHistory.reduce((best, current) =>
            current.confidence > best.confidence ? current : best
        );

        return bestEntry.contour.clone();
    }

    return null;
}

async function logErrorToServer(error) {
    // v1.3.1: Erweiterte Server-Logging mit POST-Request
    const logMessage = typeof error === 'string' ? error : (error.message || error);
    console.error('v1.3.2 Log:', logMessage);

    if (error.stack) {
        console.error('Stack:', error.stack);
    }

    // POST-Request an Server für persistente Speicherung
    try {
        const response = await fetch('/log', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: logMessage
        });

        if (!response.ok) {
            console.warn('Log-Server nicht erreichbar:', response.status);
        }
    } catch (fetchError) {
        console.warn('Fehler beim Senden an Log-Server:', fetchError.message);
        // Fallback: Lokales Logging wenn Server nicht erreichbar
    }
}

// v1.3.1: Validierungs-Zusammenfassung für automatische Analyse
function logValidationSummary() {
    const sessionDuration = (Date.now() - validationStats.sessionStart) / 1000;
    const minutes = Math.floor(sessionDuration / 60);
    const seconds = Math.floor(sessionDuration % 60);

    // Performance-Klassifizierung
    const totalFrames = validationStats.performanceBenchmarks.fastFrames +
                       validationStats.performanceBenchmarks.normalFrames +
                       validationStats.performanceBenchmarks.slowFrames;

    const performanceGrade = totalFrames > 0 ?
        (validationStats.performanceBenchmarks.fastFrames / totalFrames > 0.7 ? '🟢 EXCELLENT' :
         validationStats.performanceBenchmarks.slowFrames / totalFrames > 0.3 ? '🔴 POOR' : '🟡 GOOD') : '⚪ N/A';

    // Stabilität berechnen
    const stabilityRatio = validationStats.documentDetections > 0 ?
        (validationStats.documentDetections / (validationStats.documentDetections + validationStats.documentLosses)) : 0;

    // Erfolgsrate berechnen
    const successRate = validationStats.totalScans > 0 ?
        (validationStats.successfulScans / validationStats.totalScans) * 100 : 0;

    addDebugLog(`📊 <span style="color: #0af">═══ VALIDATION SUMMARY ═══</span>`);
    addDebugLog(`⏱️ Session: ${minutes}:${seconds.toString().padStart(2, '0')} | Performance: ${performanceGrade} (${validationStats.performanceBenchmarks.avgProcessingTime.toFixed(1)}ms avg)`);
    addDebugLog(`🎯 Detections: ${validationStats.documentDetections} | Losses: ${validationStats.documentLosses} | Stability: <span style="color: ${stabilityRatio > 0.8 ? '#0f0' : stabilityRatio > 0.6 ? '#fa0' : '#f00'}">${(stabilityRatio * 100).toFixed(1)}%</span>`);
    addDebugLog(`✅ Scans: ${validationStats.successfulScans}/${validationStats.totalScans} | Success-Rate: <span style="color: ${successRate > 90 ? '#0f0' : successRate > 70 ? '#fa0' : '#f00'}">${successRate.toFixed(1)}%</span>`);
    addDebugLog(`🔥 High-Confidence: ${validationStats.highConfidenceScans} | Avg-Confidence: ${validationStats.avgConfidenceScore.toFixed(2)}`);

    // Server-Log für Analyse
    const summaryData = {
        sessionDuration: sessionDuration,
        performance: performanceGrade,
        avgFrameTime: validationStats.performanceBenchmarks.avgProcessingTime,
        stabilityRatio: stabilityRatio,
        successRate: successRate,
        totalDetections: validationStats.documentDetections,
        totalScans: validationStats.totalScans,
        avgConfidence: validationStats.avgConfidenceScore,
        timestamp: new Date().toISOString()
    };

    console.log('VALIDATION_SUMMARY:', JSON.stringify(summaryData));
    logErrorToServer(`VALIDATION_SUMMARY: ${JSON.stringify(summaryData)}`);
}

// v1.3.1: Automatische Validierung basierend auf Metriken
function validateSystemHealth() {
    const sessionDuration = (Date.now() - validationStats.sessionStart) / 1000;

    // Nur validieren wenn genügend Daten vorhanden
    if (sessionDuration < 30 || performanceStats.frameCount < 60) {
        return { status: 'insufficient_data', message: 'Nicht genügend Daten für Validierung' };
    }

    const issues = [];
    const warnings = [];

    // Performance-Validierung
    if (validationStats.performanceBenchmarks.avgProcessingTime > 150) {
        issues.push('⚠️ Langsame Performance (>150ms/frame)');
    } else if (validationStats.performanceBenchmarks.avgProcessingTime > 100) {
        warnings.push('⚠️ Mittelmäßige Performance (>100ms/frame)');
    }

    // Stabilitäts-Validierung
    const stabilityRatio = validationStats.documentDetections > 0 ?
        (validationStats.documentDetections / (validationStats.documentDetections + validationStats.documentLosses)) : 0;

    if (stabilityRatio < 0.6) {
        issues.push('⚠️ Niedrige Stabilität (<60%)');
    } else if (stabilityRatio < 0.8) {
        warnings.push('⚠️ Mittlere Stabilität (<80%)');
    }

    // Success-Rate Validierung
    const successRate = validationStats.totalScans > 0 ?
        (validationStats.successfulScans / validationStats.totalScans) : 1;

    if (successRate < 0.7) {
        issues.push('⚠️ Niedrige Success-Rate (<70%)');
    } else if (successRate < 0.9) {
        warnings.push('⚠️ Mittlere Success-Rate (<90%)');
    }

    // Confidence-Validierung
    if (validationStats.avgConfidenceScore < 0.7) {
        issues.push('⚠️ Niedrige durchschnittliche Confidence');
    }

    const overallStatus = issues.length > 0 ? '🔴 ISSUES' :
                         warnings.length > 0 ? '🟡 WARNINGS' : '🟢 HEALTHY';

    return {
        status: overallStatus,
        issues: issues,
        warnings: warnings,
        metrics: {
            performance: validationStats.performanceBenchmarks.avgProcessingTime,
            stability: stabilityRatio * 100,
            successRate: successRate * 100,
            avgConfidence: validationStats.avgConfidenceScore
        }
    };
}

function safeCapture(retryCount = 0) {
    console.log(`safeCapture aufgerufen (Versuch ${retryCount + 1})`);
    
    // Maximale Anzahl von Versuchen
    const MAX_RETRIES = 10;
    
    if (retryCount >= MAX_RETRIES) {
        console.error('Maximale Anzahl von Versuchen erreicht, gebe auf');
        alert('Das Video konnte nicht erfasst werden. Bitte starten Sie den Scanner neu.');
        return;
    }
    
    // Detaillierte Video-Bereitschaftsprüfung
    const videoStatus = {
        exists: !!video,
        readyState: video ? video.readyState : 'N/A',
        dimensions: video ? `${video.videoWidth}x${video.videoHeight}` : 'N/A',
        currentTime: video ? video.currentTime : 'N/A',
        paused: video ? video.paused : 'N/A',
        ended: video ? video.ended : 'N/A',
        srcObject: video ? !!video.srcObject : 'N/A'
    };
    
    console.log('Detaillierter Video-Status:', videoStatus);
    
    // Umfassende Überprüfung
    const isVideoReady = video && 
                        video.srcObject &&
                        video.readyState >= 2 && 
                        video.videoWidth > 0 && 
                        video.videoHeight > 0 &&
                        !video.paused &&
                        !video.ended;
    
    if (!isVideoReady) {
        console.warn(`Video noch nicht bereit, warte 500ms und versuche erneut... (${retryCount + 1}/${MAX_RETRIES})`);
        
        // Falls Video pausiert ist, versuche es zu starten
        if (video && video.paused && !video.ended) {
            console.log('Video ist pausiert, versuche zu starten...');
            video.play().catch(e => console.error('Fehler beim Video-Start:', e));
        }
        
        setTimeout(() => safeCapture(retryCount + 1), 500);
        return;
    }
    
    console.log('Video ist bereit, führe Capture aus');
    // Video ist bereit, führe Capture aus
    captureAndWarp();
}

function captureAndWarp() {
    console.log('captureAndWarp aufgerufen');
    
    if (!biggestContour) {
        console.error('Kein Dokument gefunden');
        alert('Kein Dokument gefunden.');
        return;
    }

    // WICHTIG: Scanner erst NACH der Bilderfassung stoppen!

    // Verwende Canvas-Dimensionen als Fallback, da diese stabiler sind
    const useWidth = video.videoWidth > 0 ? video.videoWidth : canvas.width;
    const useHeight = video.videoHeight > 0 ? video.videoHeight : canvas.height;
    
    console.log('Verwende Dimensionen:', {
        'video.videoWidth': video.videoWidth,
        'video.videoHeight': video.videoHeight,
        'canvas.width': canvas.width,
        'canvas.height': canvas.height,
        'useWidth': useWidth,
        'useHeight': useHeight
    });

    if (useWidth === 0 || useHeight === 0) {
        console.error('Sowohl Video- als auch Canvas-Dimensionen sind ungültig');
        alert('Fehler: Keine gültigen Dimensionen gefunden. Bitte starten Sie den Scanner neu.');
        return;
    }

    let frame = new cv.Mat(useHeight, useWidth, cv.CV_8UC4);
    let dst = new cv.Mat();
    let M = null;
    let srcTri = null;
    let dstTri = null;
    let processed = null;

    try {
        // Detaillierte Debugging-Ausgabe
        console.log('Video-Status vor Erfassung:', {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState,
            currentTime: video.currentTime,
            paused: video.paused,
            ended: video.ended
        });

        // Warte kurz, falls Video noch lädt
        if (video.readyState < 4) {
            console.warn('Video noch nicht vollständig geladen, versuche trotzdem...');
        }

        // Alternative Methode: Verwende den vorhandenen Canvas anstatt Video direkt
        let tempCanvas = document.createElement('canvas');
        tempCanvas.width = useWidth;
        tempCanvas.height = useHeight;
        let tempCtx = tempCanvas.getContext('2d');
        
        console.log('Temp-Canvas erstellt:', tempCanvas.width, 'x', tempCanvas.height);
        
        // WICHTIGER FIX: Warte bis Video bereit ist
        if (video.readyState < 2) {
            throw new Error('Video ist noch nicht bereit für Aufnahme');
        }
        
        // Kopiere direkt vom Video BEVOR wir den Scanner stoppen
        console.log('Kopiere Video Frame SOFORT (bevor Video stoppt)');
        tempCtx.drawImage(video, 0, 0, useWidth, useHeight);
        
        console.log('Video Frame erfasst');
        const imageData = tempCtx.getImageData(0, 0, useWidth, useHeight);
        console.log('ImageData erhalten:', imageData.width, 'x', imageData.height);
        
        frame.data.set(imageData.data);
        console.log('Frame-Daten in cv.Mat gesetzt');

        // Eckpunkte und Skalierungsfaktor
        const scale = MAX_PROCESSING_WIDTH / frame.cols;
        const corners = getOrderedCorners(biggestContour, 1 / scale);
        const [tl, tr, br, bl] = corners;

        const widthA = Math.sqrt(((br.x - bl.x) ** 2) + ((br.y - bl.y) ** 2));
        const widthB = Math.sqrt(((tr.x - tl.x) ** 2) + ((tr.y - tl.y) ** 2));
        const maxWidth = Math.max(widthA, widthB);

        const heightA = Math.sqrt(((tr.x - br.x) ** 2) + ((tr.y - br.y) ** 2));
        const heightB = Math.sqrt(((tl.x - bl.x) ** 2) + ((tl.y - bl.y) ** 2));
        const maxHeight = Math.max(heightA, heightB);

        srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
        dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight]);
        
        M = cv.getPerspectiveTransform(srcTri, dstTri);
        let dsize = new cv.Size(maxWidth, maxHeight);
        cv.warpPerspective(frame, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

        // Bild verbessern
        processed = enhanceDocumentImage(dst);

        // Konvertiere cv.Mat zu RGBA für Canvas
        let rgbaImage = new cv.Mat();
        
        console.log('Processed Mat Info:', {
            cols: processed.cols,
            rows: processed.rows,
            channels: processed.channels(),
            type: processed.type(),
            depth: processed.depth()
        });
        
        // Konvertiere basierend auf dem aktuellen Format
        if (processed.channels() === 1) {
            // Grayscale zu RGBA
            cv.cvtColor(processed, rgbaImage, cv.COLOR_GRAY2RGBA);
            console.log('Konvertiert: GRAY zu RGBA');
        } else if (processed.channels() === 3) {
            // BGR zu RGBA
            cv.cvtColor(processed, rgbaImage, cv.COLOR_BGR2RGBA);
            console.log('Konvertiert: BGR zu RGBA');
        } else if (processed.channels() === 4) {
            // Bereits RGBA oder BGRA
            if (processed.type() === cv.CV_8UC4) {
                // BGRA zu RGBA
                cv.cvtColor(processed, rgbaImage, cv.COLOR_BGRA2RGBA);
                console.log('Konvertiert: BGRA zu RGBA');
            } else {
                // Bereits RGBA
                processed.copyTo(rgbaImage);
                console.log('Bereits RGBA');
            }
        } else {
            // Fallback: versuche direkt zu kopieren
            processed.copyTo(rgbaImage);
            console.log('Fallback: Direkte Kopie');
        }
        
        // Erstelle Canvas
        let outputCanvas = document.createElement('canvas');
        outputCanvas.width = rgbaImage.cols;
        outputCanvas.height = rgbaImage.rows;
        let outputCtx = outputCanvas.getContext('2d');
        
        console.log('Output Canvas Dimensionen:', outputCanvas.width, 'x', outputCanvas.height);
        
        // Erstelle ImageData aus RGBA cv.Mat
        const outputImageData = outputCtx.createImageData(rgbaImage.cols, rgbaImage.rows);
        const data = new Uint8ClampedArray(rgbaImage.data);
        outputImageData.data.set(data);
        
        // Zeichne ImageData auf Canvas
        outputCtx.putImageData(outputImageData, 0, 0);
        
        // Debug-Info
        console.log('Perspektivkorrektur abgeschlossen, Bildverbesserung wird angewendet');
        
        const finalImageData = outputCanvas.toDataURL('image/png');
        
        // Cleanup
        rgbaImage.delete();

        if (!finalImageData || finalImageData.length < 100) throw new Error("Bild konnte nicht erstellt werden");

        // Sende Bild an Server zur Speicherung und Analyse
        saveImageToServer(finalImageData, 'final');

        resultImage.src = finalImageData;
        downloadLink.href = finalImageData;
        
        // JETZT erst den Scanner stoppen, nachdem das Bild erfasst wurde
        stopScanner();
        
        resultImage.onload = () => {
            scannerView.classList.add('hidden');
            resultView.classList.remove('hidden');
        };

    } catch (error) {
        console.error('Fehler in captureAndWarp:', error);
        logErrorToServer(error);
        alert('Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.');
        rescanButton.click();
    } finally {
        frame.delete();
        dst.delete();
        if (M) M.delete();
        if (srcTri) srcTri.delete();
        if (dstTri) dstTri.delete();
        if (processed) processed.delete();
        if (biggestContour) biggestContour.delete();
        biggestContour = null;
    }
}

function getOrderedCorners(contour, scale = 1) {
    const points = [];
    for (let i = 0; i < contour.rows; i++) {
        points.push({ x: contour.data32S[i * 2] * scale, y: contour.data32S[i * 2 + 1] * scale });
    }
    points.sort((a, b) => a.y - b.y);
    const top = points.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = points.slice(2, 4).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]];
}

function enhanceDocumentImage(img) {
    console.log('enhanceDocumentImage aufgerufen, Input Mat:', {
        cols: img.cols,
        rows: img.rows,
        channels: img.channels(),
        type: img.type()
    });
    
    // Erstmal das Originalbild zurückgeben ohne Verbesserung
    // um zu testen ob das Problem bei der Verbesserung liegt
    let result = img.clone();
    console.log('enhanceDocumentImage: Gebe Originalbild zurück');
    return result;
}

// UI Helfer
document.addEventListener('DOMContentLoaded', () => {
    if (isIOS()) {
        downloadLink.style.display = 'none';
        document.getElementById('ios-save-tip').style.display = 'block';
    } else {
        document.getElementById('ios-save-tip').style.display = 'none';
    }
});

function isIOS() {
    // Verwende userAgent anstatt deprecated platform
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    return /iPad|iPhone|iPod/.test(userAgent) 
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
}

// Funktion zum Speichern des Bildes auf dem Server
async function saveImageToServer(imageData, type = 'scan') {
    try {
        console.log(`Sende ${type}-Bild an Server zur Speicherung...`);
        
        const response = await fetch('/save-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: imageData,
                timestamp: new Date().toISOString(),
                type: type
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            console.log(`${type}-Bild erfolgreich gespeichert:`, result.filename);
            logErrorToServer(`${type}-Bild erfolgreich gespeichert: ${result.filename}`);

            // Validierungs-Statistiken für erfolgreiche Scans
            if (type === 'final') {
                validationStats.totalScans++;
                validationStats.successfulScans++;
                const successRate = (validationStats.successfulScans / validationStats.totalScans) * 100;
                const logMessage = `✅ SCAN ERFOLGREICH! ${result.filename} | Success-Rate: ${successRate.toFixed(1)}% (${validationStats.successfulScans}/${validationStats.totalScans})`;
                addDebugLog(`✅ <span style="color: #0f0">SCAN ERFOLGREICH!</span> ${result.filename} | Success-Rate: <span style="color: #0af">${successRate.toFixed(1)}%</span> (${validationStats.successfulScans}/${validationStats.totalScans})`);

                // Server-Log für erfolgreiche Scans
                logErrorToServer(`SCAN_SUCCESS: ${JSON.stringify({
                    filename: result.filename,
                    successRate: successRate,
                    totalScans: validationStats.totalScans,
                    timestamp: new Date().toISOString()
                })}`);
            }
        } else {
            console.error('Fehler beim Speichern:', result.message);
            logErrorToServer(`Fehler beim Speichern: ${result.message}`);

            // Validierungs-Statistiken für fehlgeschlagene Scans
            if (type === 'final') {
                validationStats.totalScans++;
                validationStats.failedScans++;
                const successRate = (validationStats.successfulScans / validationStats.totalScans) * 100;
                addDebugLog(`❌ <span style="color: #f00">SCAN FEHLGESCHLAGEN!</span> ${result.message} | Success-Rate: <span style="color: #fa0">${successRate.toFixed(1)}%</span> (${validationStats.successfulScans}/${validationStats.totalScans})`);
            }
        }
    } catch (error) {
        console.error('Fehler beim Senden an Server:', error);
        logErrorToServer(`Fehler beim Senden an Server: ${error.message}`);
    }
}

// Initialer Zustand
startButton.disabled = true;
startButton.textContent = 'Lade KI-Modell...';
