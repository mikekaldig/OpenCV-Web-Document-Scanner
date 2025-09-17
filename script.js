// --- DOM elements & globals ---
let cvReady = false;
let stream = null;

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

const startButton = document.getElementById('start-button');
const captureButton = document.getElementById('capture-button');
const rescanButton = document.getElementById('rescan-button');
const addPageButton = document.getElementById('add-page-button');
const createPdfButton = document.getElementById('create-pdf-button');
const pageCounterEl = document.getElementById('page-counter');

const mainMenu = document.getElementById('main-menu');
const scannerView = document.getElementById('scanner-view');
const resultView = document.getElementById('result-view');
const statusMessage = document.getElementById('status-message');
const resultImage = document.getElementById('result-image');
const downloadLink = document.getElementById('download-link');
const startError = document.getElementById('start-error');

// Multi-Page Scan State
let scannedPages = []; // Array Base64 PNG Strings

function resetMultiPageSession() {
    scannedPages = [];
    updatePageCounter();
}

function updatePageCounter() {
    if (pageCounterEl) {
        pageCounterEl.textContent = `Gespeicherte Seiten: ${scannedPages.length}`;
    }
    if (createPdfButton) {
        createPdfButton.style.display = scannedPages.length > 0 ? 'inline-block' : 'none';
    }
    // Thumbnails synchron halten
    try { if (typeof renderThumbnails === 'function') renderThumbnails(); } catch(_) {}
}

async function createPdfFromPages() {
    if (!scannedPages.length) {
        alert('Keine Seiten zum Erstellen eines PDFs.');
        return;
    }
    // Falls jsPDF noch nicht geladen ist, versuchen wir es dynamisch nachzuladen
    if (!window.jspdf || !window.jspdf.jsPDF) {
        addDebugLog('⚠️ jsPDF nicht vorhanden – versuche Nachladen (local-first)...');
        await ensureJsPdfLoaded();
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('PDF Bibliothek (jsPDF) konnte nicht geladen werden.');
        return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < scannedPages.length; i++) {
        const dataUrl = scannedPages[i];
        const img = new Image();
        img.src = dataUrl;
        await new Promise(r => { img.onload = r; img.onerror = r; });
        const ratio = Math.min(pageW / img.width, pageH / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        const x = (pageW - w) / 2;
        const y = (pageH - h) / 2;
        if (i > 0) pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', x, y, w, h);
    }
    pdf.save(`scan_${new Date().toISOString().slice(0,10)}.pdf`);
    addDebugLog('📄 PDF erstellt mit ' + scannedPages.length + ' Seite(n)');
    resetMultiPageSession();
}

if (addPageButton) {
    addPageButton.addEventListener('click', () => {
        if (!(resultImage && resultImage.src && resultImage.src.startsWith('data:image'))) {
            alert('Kein gültiges Bild zum Hinzufügen gefunden.');
            return;
        }
        const current = resultImage.src;
        if (scannedPages[scannedPages.length - 1] !== current) {
            scannedPages.push(current);
            addDebugLog(`➕ Seite hinzugefügt (#${scannedPages.length})`);
        } else {
            addDebugLog('ℹ️ Seite nicht erneut hinzugefügt (Duplikat)');
        }
        updatePageCounter();
        resultView.classList.add('hidden');
        startScanner();
    });
}

if (createPdfButton) {
    createPdfButton.addEventListener('click', createPdfFromPages);
}

// Dynamisches Laden von jsPDF falls initial nicht verfügbar (Netzwerk-Lag etc.)
let __jspdfLoadPromise = null;
function loadJsPdfScript() {
    if (__jspdfLoadPromise) return __jspdfLoadPromise;
    __jspdfLoadPromise = new Promise((resolve) => {
        try {
            const existing = document.querySelector('script[data-dynamic-jspdf]');
            if (existing) {
                existing.addEventListener('load', () => resolve(true));
                existing.addEventListener('error', () => resolve(false));
                return;
            }
            const s = document.createElement('script');
            // Local-first: versuchen, aus assets/js zu laden
            s.src = 'assets/js/jspdf.umd.min.js';
            s.crossOrigin = 'anonymous';
            s.referrerPolicy = 'no-referrer';
            s.setAttribute('data-dynamic-jspdf', '1');
            s.onload = () => { addDebugLog('✅ jsPDF (lokal) geladen'); resolve(true); };
            s.onerror = async () => {
                addDebugLog('❌ jsPDF lokal nicht gefunden – versuche CDN');
                // Retry via CDN
                try {
                    const cdn = document.createElement('script');
                    cdn.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                    cdn.crossOrigin = 'anonymous';
                    cdn.referrerPolicy = 'no-referrer';
                    cdn.setAttribute('data-dynamic-jspdf', '1');
                    cdn.onload = () => { addDebugLog('✅ jsPDF (CDN) geladen'); resolve(true); };
                    cdn.onerror = () => { addDebugLog('❌ jsPDF Nachladen (CDN) fehlgeschlagen'); resolve(false); };
                    document.head.appendChild(cdn);
                } catch (_) { resolve(false); }
            };
            document.head.appendChild(s);
        } catch (_) { resolve(false); }
    });
    return __jspdfLoadPromise;
}

async function ensureJsPdfLoaded(timeoutMs = 4000) {
    if (window.jspdf && window.jspdf.jsPDF) return true;
    await loadJsPdfScript();
    if (window.jspdf && window.jspdf.jsPDF) return true;
    // Warten in kleinen Intervallen (Race mit Netz / Cache)
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
        if (window.jspdf && window.jspdf.jsPDF) return true;
        await new Promise(r => setTimeout(r, 100));
    }
    return !!(window.jspdf && window.jspdf.jsPDF);
}

// Früh versuchen zu laden, falls der statische Tag blockiert wurde
window.addEventListener('load', () => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        // Verzögert anstoßen damit Haupt-Thread frei bleibt
        setTimeout(() => { ensureJsPdfLoaded(); }, 300);
    }
});

// --- Thumbnails: Render, Delete, Reorder, Click-Preview ---
const thumbsEl = document.getElementById('thumbnails');

function renderThumbnails() {
    if (!thumbsEl) return;
    thumbsEl.innerHTML = '';
    scannedPages.forEach((dataUrl, idx) => {
        const item = document.createElement('div');
        item.className = 'thumb';
        item.draggable = true;
        item.dataset.index = String(idx);
        const img = document.createElement('img');
        img.src = dataUrl;
        const del = document.createElement('div');
        del.className = 'del';
        del.title = 'Entfernen';
        del.textContent = '×';
        item.appendChild(img);
        item.appendChild(del);
        thumbsEl.appendChild(item);
    });
}

function updateUIAfterPagesChange() {
    updatePageCounter();
    renderThumbnails();
}

if (thumbsEl) {
    // Click handlers (delegiert)
    thumbsEl.addEventListener('click', (e) => {
        const target = e.target;
        const thumb = target.closest('.thumb');
        if (!thumb) return;
        const idx = parseInt(thumb.dataset.index || '-1', 10);
        if (isNaN(idx) || idx < 0 || idx >= scannedPages.length) return;
        if (target.classList.contains('del')) {
            // Delete
            scannedPages.splice(idx, 1);
            addDebugLog(`🗑️ Seite ${idx + 1} entfernt`);
            // Vorschau ggf. auf neue letzte Seite setzen
            if (scannedPages.length > 0) {
                const last = scannedPages[Math.min(idx, scannedPages.length - 1)];
                resultImage.src = last;
                downloadLink.href = last;
            }
            updateUIAfterPagesChange();
            return;
        }
        // Preview on click
        const sel = scannedPages[idx];
        resultImage.src = sel;
        downloadLink.href = sel;
        addDebugLog(`👁️ Vorschau Seite ${idx + 1}`);
    });

    // Drag & Drop Reorder
    let dragIdx = null;
    thumbsEl.addEventListener('dragstart', (e) => {
        const thumb = e.target.closest('.thumb');
        if (!thumb) return;
        dragIdx = parseInt(thumb.dataset.index || '-1', 10);
        thumb.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });
    thumbsEl.addEventListener('dragend', (e) => {
        const thumb = e.target.closest('.thumb');
        if (thumb) thumb.classList.remove('dragging');
        dragIdx = null;
    });
    thumbsEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });
    thumbsEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetThumb = e.target.closest('.thumb');
        if (!targetThumb) return;
        const dropIdx = parseInt(targetThumb.dataset.index || '-1', 10);
        if (dragIdx === null || isNaN(dropIdx) || dropIdx < 0 || dropIdx >= scannedPages.length) return;
        if (dragIdx === dropIdx) return;
        const [moved] = scannedPages.splice(dragIdx, 1);
        scannedPages.splice(dropIdx, 0, moved);
        addDebugLog(`🔀 Seite von ${dragIdx + 1} nach ${dropIdx + 1} verschoben`);
        renderThumbnails();
    });
}

// Hilfsfunktion: Overlay-Canvas exakt über dem Video ausrichten
function alignOverlayToVideo() {
    try {
        if (!video || !canvas || !scannerView) return;
        const vRect = video.getBoundingClientRect();
        const sRect = scannerView.getBoundingClientRect();
        // Position relativ zur Scanner-View berechnen
        const relTop = vRect.top - sRect.top;
        const relLeft = vRect.left - sRect.left;
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvas.style.top = relTop + 'px';
        canvas.style.left = relLeft + 'px';
        canvas.style.width = vRect.width + 'px';
        canvas.style.height = vRect.height + 'px';
        // Einmaliges Debugging der Geometrie
        if (!window.__overlayGeomLogged) {
            window.__overlayGeomLogged = true;
            addDebugLog(`📐 Overlay-Align: videoCss=${Math.round(vRect.width)}x${Math.round(vRect.height)} at (${Math.round(vRect.left - sRect.left)},${Math.round(vRect.top - sRect.top)}) | videoPx=${video.videoWidth}x${video.videoHeight}`);
        }
    } catch (_) { /* ignore layout errors */ }
}

// WebGL PoC elements
const webglToggle = document.getElementById('webgl-toggle');
const webglCanvas = document.getElementById('webgl-canvas');
const webglToggleState = document.getElementById('webgl-toggle-state');
let webglSupported = false;
let webglEnabled = false;
let webglInitDone = false;
// WebGL Quali-Optionen wieder deaktiviert (zurück zur Basis)
const webglDownscaleSel = null;
const webglBlurChk = null;
let webglDownscale = 1.0;
let webglDoBlur = true;

// v1.3.3: Test Mode (deaktiviert Auto-Scan)
const testModeToggle = document.getElementById('testmode-toggle');
const testModeToggleState = document.getElementById('testmode-toggle-state');
let testMode = false;

// v1.3.3: Perf Test controls
const perfTestStartBtn = document.getElementById('perf-test-start');
const perfTestSecondsInput = document.getElementById('perf-test-seconds');
let perfTestTimer = null;
let perfTestInterval = null;
let perfTestActive = false;
let perfTestId = null;

function getDebugPanelText() {
    try {
        // Concatenate all debug entries as plain text lines
        const nodes = Array.from(debugContent.children || []);
        return nodes.map(n => n.textContent || '').join('\n');
    } catch (_) {
        return '';
    }
}

async function uploadClientLog(reasonTag = 'FINAL', useBeaconIfPossible = false) {
    try {
        const content = getDebugPanelText();
        const meta = {
            id: perfTestId || undefined,
            reason: reasonTag,
            seconds: (perfTestSecondsInput && parseInt(perfTestSecondsInput.value || '0', 10)) || undefined,
            timestamp: new Date().toISOString(),
            webglSupported,
            webglEnabled,
            testMode,
        };
        const payload = JSON.stringify({ content, meta });
        if (useBeaconIfPossible && typeof navigator !== 'undefined' && navigator.sendBeacon) {
            try {
                const ok = navigator.sendBeacon('/save-client-log', new Blob([payload], { type: 'application/json' }));
                if (ok) {
                    logInfoThrottled('CLIENT_LOG_UPLOAD beacon-ok');
                    return;
                }
            } catch (_) { /* fall through */ }
        }
        await fetch('/save-client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
        });
        logInfoThrottled('CLIENT_LOG_UPLOAD fetch-ok');
    } catch (e) {
        // Swallow errors; logging should not break the app
    }
}

function finalizePerfTest(reason = 'PERF_TEST_END') {
    try {
        if (!perfTestActive) return;
        perfTestActive = false;
        if (perfTestTimer) { clearTimeout(perfTestTimer); perfTestTimer = null; }
        if (perfTestInterval) { clearInterval(perfTestInterval); perfTestInterval = null; }
    logQuickPerfSnapshot(reason);
    logValidationSummary();
        addDebugLog('🧪 <span style="color:#0af">PERF TEST DONE</span>');
    logErrorToServer('PERF_TEST_DONE');
    // Upload per-test client log (prefer beacon on finalize)
    uploadClientLog('PERF_TEST_DONE', true);
        if (perfTestStartBtn) {
            perfTestStartBtn.disabled = false;
            perfTestStartBtn.textContent = 'Start';
        }
    } catch (_) {}
}

// Robust WebGL capability check
function checkWebGLSupport() {
    try {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
        return !!gl;
    } catch (e) {
        return false;
    }
}

// Try to initialize WebGL when available (safe to call multiple times)
function initWebGLIfAvailable() {
    if (webglInitDone || webglSupported) return;
    try {
        const basicSupport = checkWebGLSupport();
        if (!basicSupport) {
            // keep N/A state
            return;
        }
        if (webglCanvas && typeof WebGLPoC !== 'undefined' && WebGLPoC.initWebGL) {
            if (!webglCanvas.width || !webglCanvas.height) {
                webglCanvas.width = 16;
                webglCanvas.height = 16;
            }
            WebGLPoC.initWebGL(webglCanvas);
            webglSupported = true;
            webglInitDone = true;
            addDebugLog('🧪 <span style="color: #0af">WebGL PoC initialisiert</span>');
            if (webglToggle) webglToggle.disabled = false;
            if (webglToggleState) {
                webglToggleState.textContent = webglToggle && webglToggle.checked ? 'ON' : 'OFF';
                webglToggleState.style.color = webglToggle && webglToggle.checked ? '#0f0' : '#fa6';
            }
            logInfoThrottled('WEBGL_INIT success');
        }
    } catch (e) {
        addDebugLog(`🧪 <span style=\"color:#f80\">WebGL Init Fehler:</span> ${e.message}`);
        logInfoThrottled(`WEBGL_INIT error ${e.message}`);
    }
}

// Small helpers for user-facing start errors
function showStartError(message) {
    if (startError) {
        startError.textContent = message;
        startError.style.display = 'block';
    }
}
function clearStartError() {
    if (startError) {
        startError.textContent = '';
        startError.style.display = 'none';
    }
}

// v1.2: Debug Panel Elements
const debugPanel = document.getElementById('debug-panel');
const debugContent = document.getElementById('debug-content');
const debugToggle = document.getElementById('debug-toggle');
const clearLog = document.getElementById('clear-log');
const debugFab = document.getElementById('debug-fab');

// Performance-Optimierung für Mobilgeräte
// Dynamisch anpassbare Basis-Parameter
let MAX_PROCESSING_WIDTH = 640; // wird je nach Speed-Tier skaliert
let biggestContour = null;
let documentStableCount = 0;
let autoScanTimer = null;
let STABLE_FRAMES_REQUIRED = 15; // kann dynamisch reduziert werden
let AUTO_SCAN_DELAY = 1500; // wird bei hoher Confidence reduziert

// Speed Tier System für schnelleres Tracking
const SpeedTiers = {
    QUALITY: { name: 'QUALITY', width: 720, bilateral: true, history: 4, stableFrames: 15, minDelay: 1200 },
    NORMAL:  { name: 'NORMAL',  width: 640, bilateral: true, history: 3, stableFrames: 10, minDelay: 1000 },
    FAST:    { name: 'FAST',    width: 520, bilateral: false, history: 2, stableFrames: 7,  minDelay: 800 },
    ULTRA:   { name: 'ULTRA',   width: 440, bilateral: false, history: 2, stableFrames: 5,  minDelay: 650 }
};
let currentSpeedTier = SpeedTiers.NORMAL;

function applySpeedTier(tier) {
    currentSpeedTier = tier;
    MAX_PROCESSING_WIDTH = tier.width;
    STABLE_FRAMES_REQUIRED = tier.stableFrames;
    // AUTO_SCAN_DELAY dynamisch später berechnet (abhängig von Confidence)
    addDebugLog(`🚀 Speed Tier: <span style="color:#0af">${tier.name}</span> (w=${tier.width}, hist=${tier.history}, stable=${tier.stableFrames})`);
}
applySpeedTier(SpeedTiers.NORMAL);

// v1.3.1: Optimierte Multi-Frame Processing Variablen
// Wird jetzt durch Speed Tier bestimmt
let FRAME_HISTORY_SIZE = currentSpeedTier.history; // initial
const CONFIDENCE_THRESHOLD = 0.62; // v1.3.2: leicht gesenkt für bessere Erkennung bei schwieriger Beleuchtung
const HIGH_CONFIDENCE_THRESHOLD = 0.85; // Neu: Threshold für sofortige Erkennung
let frameHistory = []; // History der letzten Frames

    // v1.3.3: Test Mode toggle initialisieren
    if (testModeToggle) {
        testMode = !!testModeToggle.checked;
        if (testModeToggleState) {
            testModeToggleState.textContent = testMode ? 'ON' : 'OFF';
            testModeToggleState.style.color = testMode ? '#0f0' : '#fa6';
        }
        testModeToggle.addEventListener('change', () => {
            testMode = !!testModeToggle.checked;
            if (testModeToggleState) {
                testModeToggleState.textContent = testMode ? 'ON' : 'OFF';
                testModeToggleState.style.color = testMode ? '#0f0' : '#fa6';
            }
            addDebugLog(`🧪 Test Mode ${testMode ? '<span style="color:#0f0">aktiv</span>' : '<span style=\"color:#fa6\">inaktiv</span>'}`);
            logInfoThrottled(`TESTMODE_TOGGLE ${testMode ? 'on' : 'off'}`);
            // Test Mode deaktiviert Auto-Scan => laufende Timer stoppen
            if (testMode && autoScanTimer) {
                clearTimeout(autoScanTimer);
                autoScanTimer = null;
            }
        });
    }
let contourHistory = []; // History der gefundenen Konturen
let confidenceHistory = []; // History der Confidence-Werte
let frameCounter = 0;
// v1.3.3+: Detektionsgröße und Mapping-Faktoren (Detektionsbild -> Video)
let lastDetW = 0, lastDetH = 0;
let lastInvDetScaleX = 1.0, lastInvDetScaleY = 1.0;

// v1.3.1: Performance Monitoring & Validation
let performanceStats = {
    avgFrameTime: 0,
    frameCount: 0,
    lastFrameTime: performance.now(),
    adaptiveThreshold: CONFIDENCE_THRESHOLD
};

// v1.3.3: Per-window performance counters (WebGL vs CPU)
let perfWindow = {
    webglFrames: 0,
    cpuFrames: 0,
    sumMsWebGL: 0,
    sumMsCPU: 0
};

// v1.3.3: Quick perf snapshot (on-demand) without waiting for 60-frame boundary
function logQuickPerfSnapshot(reason = 'SNAPSHOT') {
    try {
        const webglAvg = perfWindow.webglFrames > 0 ? (perfWindow.sumMsWebGL / perfWindow.webglFrames) : null;
        const cpuAvg = perfWindow.cpuFrames > 0 ? (perfWindow.sumMsCPU / perfWindow.cpuFrames) : null;
        const data = {
            reason,
            webgl: { supported: webglSupported, enabled: webglEnabled, frames: perfWindow.webglFrames, avgMs: webglAvg },
            cpu: { frames: perfWindow.cpuFrames, avgMs: cpuAvg },
            timestamp: new Date().toISOString()
        };
        addDebugLog(`📈 Snapshot [${reason}] | WebGL: ${webglEnabled ? 'on' : 'off'} (frames=${perfWindow.webglFrames}, avgMs=${webglAvg?.toFixed(1) ?? 'n/a'}) | CPU: (frames=${perfWindow.cpuFrames}, avgMs=${cpuAvg?.toFixed(1) ?? 'n/a'})`);
        logErrorToServer(`PERF_SNAPSHOT: ${JSON.stringify(data)}`);
    } catch (e) {
        // ignore snapshot errors
    }
}

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
    if (cvReady) {
        // Avoid double init
        return;
    }
    console.log('OpenCV is ready.');
    console.log('cv object:', typeof cv !== 'undefined' ? 'verfügbar' : 'nicht verfügbar');
    cvReady = true;
    startButton.disabled = false;
    startButton.textContent = 'Scan starten';
    console.log('Start-Button aktiviert');

    // v1.3.1: Debug logging mit Session-Start
    addDebugLog('🚀 <span style="color: #0f0">OpenCV geladen</span> - v1.3.3 (Basis 1.3.1) bereit');
    addDebugLog(`📱 Browser: ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'}`);
    addDebugLog(`🎯 Multi-Frame: ${FRAME_HISTORY_SIZE} Frames | Confidence: ${CONFIDENCE_THRESHOLD}`);
    addDebugLog(`⚡ Performance: ${MAX_PROCESSING_WIDTH}px | Auto-Scan: ${AUTO_SCAN_DELAY}ms`);
    addDebugLog(`🔬 <span style="color: #0af">Validation-System aktiviert</span> - Session: ${new Date().toLocaleTimeString()}`);
    // One-time server info
    logInfoThrottled('OpenCV ready v1.3.3 (basis 1.3.1)');

    // Try to init WebGL PoC
    try {
        const basicSupport = checkWebGLSupport();
        if (!basicSupport) {
            webglSupported = false;
            addDebugLog('🧪 <span style="color: #888">WebGL nicht verfügbar (Capability-Check)</span>');
            logInfoThrottled('WEBGL_CAPABILITY unsupported');
        } else if (webglCanvas && typeof WebGLPoC !== 'undefined' && WebGLPoC.initWebGL) {
            // Ensure canvas has a minimal size before context init
            if (!webglCanvas.width || !webglCanvas.height) {
                webglCanvas.width = 16;
                webglCanvas.height = 16;
            }
            WebGLPoC.initWebGL(webglCanvas);
            webglSupported = true;
            webglInitDone = true;
            addDebugLog('🧪 <span style="color: #0af">WebGL PoC verfügbar</span>');
            logInfoThrottled('WEBGL_CAPABILITY supported');
        } else {
            addDebugLog('🧪 <span style="color: #888">WebGL PoC nicht verfügbar</span>');
            if (typeof WebGLPoC === 'undefined') {
                logInfoThrottled('WEBGL_POC missing');
            }
            // Schedule retries to allow deferred webgl.js to load
            setTimeout(initWebGLIfAvailable, 300);
            setTimeout(initWebGLIfAvailable, 1200);
        }
    } catch (e) {
        webglSupported = false;
        addDebugLog(`🧪 <span style="color: #f80">WebGL nicht unterstützt:</span> ${e.message}`);
        logInfoThrottled(`WEBGL_ERROR ${e.message}`);
    }

    if (webglToggle) {
        if (!webglSupported) {
            webglToggle.checked = false;
            webglToggle.disabled = true;
            webglEnabled = false;
            if (webglToggleState) {
                webglToggleState.textContent = 'N/A';
                webglToggleState.style.color = '#888';
            }
        }
        webglToggle.addEventListener('change', (e) => {
            webglEnabled = !!webglToggle.checked && webglSupported;
            addDebugLog(`🧪 WebGL ${webglEnabled ? '<span style="color:#0f0">aktiv</span>' : '<span style="color:#888">inaktiv</span>'}`);
            // Also send a server-side info for later analysis
            logInfoThrottled(`WEBGL_TOGGLE ${webglEnabled ? 'on' : 'off'}`);
            if (webglToggleState) {
                webglToggleState.textContent = webglEnabled ? 'ON' : 'OFF';
                webglToggleState.style.color = webglEnabled ? '#0f0' : '#fa6';
            }
            // Reset perf window and schedule a quick snapshot after 6s
            perfWindow.webglFrames = 0;
            perfWindow.cpuFrames = 0;
            perfWindow.sumMsWebGL = 0;
            perfWindow.sumMsCPU = 0;
            setTimeout(() => logQuickPerfSnapshot(webglEnabled ? 'TOGGLE_ON_6S' : 'TOGGLE_OFF_6S'), 6000);
            // If toggled ON, also schedule an automatic validation summary after ~15s
            if (webglEnabled) {
                setTimeout(() => {
                    // Only summarize if WebGL still enabled to avoid mixing windows
                    if (webglEnabled) {
                        logValidationSummary();
                    }
                }, 15000);
            }
        });
        // Initialize visible state
        if (webglToggleState) {
            webglToggleState.textContent = (webglSupported && webglToggle.checked) ? 'ON' : (webglSupported ? 'OFF' : 'N/A');
            webglToggleState.style.color = (webglSupported && webglToggle.checked) ? '#0f0' : (webglSupported ? '#fa6' : '#888');
        }
    }

    // WebGL Quali-Optionen derzeit deaktiviert
}

// If opencv.js loaded before this script, ensure initialization runs
if (window.__opencvReadyFired && !cvReady) {
    try { onOpenCvReady(); } catch (e) { console.error('Error running onOpenCvReady immediate:', e); }
}
document.addEventListener('DOMContentLoaded', () => {
    if (window.__opencvReadyFired && !cvReady) {
        try { onOpenCvReady(); } catch (e) { console.error('Error running onOpenCvReady post-DOM:', e); }
    }
});

// Fallback falls OpenCV nicht lädt
setTimeout(() => {
    if (!cvReady) {
        console.error('OpenCV hat nach 8 Sekunden nicht geladen');
        startButton.textContent = 'Warte auf OpenCV...';
        startButton.disabled = false;
    }
}, 8000);

// --- Event Listeners ---
startButton.addEventListener('click', startScanner);
captureButton.addEventListener('click', captureAndWarp);
rescanButton.addEventListener('click', () => {
    // Entfernt die zuletzt automatisch hinzugefügte Seite (Undo)
    if (scannedPages.length > 0) {
        const removed = scannedPages.pop();
        addDebugLog(`↩️ Letzte Seite entfernt (jetzt ${scannedPages.length})`);
        updatePageCounter();
        // Falls es noch Seiten gibt, letzte wieder anzeigen
        if (scannedPages.length > 0) {
            const last = scannedPages[scannedPages.length - 1];
            resultImage.src = last;
            downloadLink.href = last;
        }
    } else {
        addDebugLog('↩️ Keine Seite zum Entfernen');
    }
    resultView.classList.add('hidden');
    if (biggestContour) { try { biggestContour.delete(); } catch(_) {} biggestContour = null; }
    startScanner();
});

// v1.2: Debug Panel Event Listeners
if (debugToggle) {
    debugToggle.addEventListener('click', () => {
        if (debugPanel.style.display === 'none' || !debugPanel.style.display) {
            debugPanel.style.display = 'block';
            debugToggle.textContent = 'Hide Logs';
        } else {
            debugPanel.style.display = 'none';
            debugToggle.textContent = 'Show Logs';
        }
    });
}

clearLog.addEventListener('click', () => {
    debugContent.innerHTML = '';
    addDebugLog('Debug log cleared');
});

// Fallback floating Logs button toggler
if (debugFab) {
    debugFab.addEventListener('click', () => {
        const showing = (debugPanel.style.display === 'block');
        debugPanel.style.display = showing ? 'none' : 'block';
        if (debugToggle) debugToggle.textContent = showing ? 'Show Logs' : 'Hide Logs';
    });
}

// v1.3.3: Automated Perf Test
function startPerfTest() {
    if (!perfTestSecondsInput) return;
    const seconds = Math.max(5, Math.min(30, parseInt(perfTestSecondsInput.value || '12', 10)));
    // Ensure we are in scanner view and running
    if (!(scannerView && !scannerView.classList.contains('hidden')) && startButton) {
        try { startButton.click(); } catch (_) {}
    }
    // Force Test Mode ON during the perf window, remember previous state
    const prevTestMode = testMode;
    if (!testMode) {
        testMode = true;
        if (testModeToggle) testModeToggle.checked = true;
        if (testModeToggleState) {
            testModeToggleState.textContent = 'ON';
            testModeToggleState.style.color = '#0f0';
        }
        addDebugLog('🧪 Test Mode <span style="color:#0f0">aktiv</span> (erzwungen für Perf-Test)');
        // Cancel any pending auto-scan to keep test clean
        if (autoScanTimer) { clearTimeout(autoScanTimer); autoScanTimer = null; }
    }
    // Reset per-window counters for a clean measurement
    perfWindow.webglFrames = 0;
    perfWindow.cpuFrames = 0;
    perfWindow.sumMsWebGL = 0;
    perfWindow.sumMsCPU = 0;
    const meta = { seconds, webglSupported, webglEnabled, timestamp: new Date().toISOString() };
    addDebugLog(`🧪 <span style="color:#0af">PERF TEST START</span> ${seconds}s | WebGL: ${webglEnabled ? 'on' : 'off'}`);
    logErrorToServer(`PERF_TEST_START: ${JSON.stringify(meta)}`);
    // Create a simple test id for grouping files server-side
    perfTestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Upload initial log snapshot at start (connectivity check)
    uploadClientLog('START', true);
    // Disable button during run
    if (perfTestStartBtn) {
        perfTestStartBtn.disabled = true;
        perfTestStartBtn.textContent = 'Running…';
    }
    perfTestActive = true;
    // Periodic snapshots while running (helps on mobile timer throttling)
    if (perfTestInterval) clearInterval(perfTestInterval);
    perfTestInterval = setInterval(() => {
        if (perfTestActive) logQuickPerfSnapshot('PERF_TEST_TICK');
    }, 5000);
    // Schedule end-of-test actions
    if (perfTestTimer) clearTimeout(perfTestTimer);
    perfTestTimer = setTimeout(() => {
        finalizePerfTest('PERF_TEST_END');
        // Restore previous Test Mode state
        if (!prevTestMode) {
            testMode = false;
            if (testModeToggle) testModeToggle.checked = false;
            if (testModeToggleState) {
                testModeToggleState.textContent = 'OFF';
                testModeToggleState.style.color = '#fa6';
            }
            addDebugLog('🧪 Test Mode <span style="color:#fa6">inaktiv</span> (zurückgesetzt)');
        }
    }, seconds * 1000);
}

if (perfTestStartBtn) {
    perfTestStartBtn.addEventListener('click', startPerfTest);
}

// Ensure we finalize perf test if the tab goes to background or unloads
let perfFinalizeBound = false;
function bindPerfFinalizeGuards() {
    if (perfFinalizeBound) return;
    perfFinalizeBound = true;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && perfTestActive) { finalizePerfTest('PERF_TEST_VISIBILITY'); uploadClientLog('VISIBILITY', true); }
    });
    window.addEventListener('pagehide', () => { if (perfTestActive) { finalizePerfTest('PERF_TEST_PAGEHIDE'); uploadClientLog('PAGEHIDE', true); } });
    window.addEventListener('beforeunload', () => { if (perfTestActive) { finalizePerfTest('PERF_TEST_BEFOREUNLOAD'); uploadClientLog('BEFOREUNLOAD', true); } });
}
bindPerfFinalizeGuards();

// Capture unexpected errors into the debug log and server log
window.addEventListener('error', (ev) => {
    try {
        const msg = ev?.message || 'Uncaught error';
        addDebugLog(`❗ <span style="color:#f55">ERROR:</span> ${msg}`);
        logErrorToServer(`CLIENT_ERROR ${msg}`);
    } catch (_) {}
}, true);

window.addEventListener('unhandledrejection', (ev) => {
    try {
        const reason = ev?.reason?.message || ev?.reason || 'unhandledrejection';
        addDebugLog(`❗ <span style="color:#f55">UNHANDLED REJECTION:</span> ${reason}`);
        logErrorToServer(`CLIENT_UNHANDLED_REJECTION ${reason}`);
    } catch (_) {}
}, true);

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

// Helper: robust error -> string
function formatErr(err) {
    try {
        if (err === undefined) return 'undefined';
        if (err === null) return 'null';
        if (typeof err === 'string') return err;
        if (typeof err === 'number') return String(err);
        if (err && typeof err === 'object') {
            if (err.message) return String(err.message);
            try { return JSON.stringify(err); } catch (_) { return Object.prototype.toString.call(err); }
        }
        return String(err);
    } catch (_) {
        return '[unformatable error]';
    }
}
async function startScanner() {
    console.log('startScanner aufgerufen, cvReady:', cvReady);
    if (!cvReady) {
        console.warn('OpenCV noch nicht bereit – starte Kamera trotzdem und warte im Loop.');
        addDebugLog('⏳ Warte auf OpenCV, Kamera wird bereits gestartet...');
    }
    console.log('Versuche Kamera-Zugriff...');
    try {
        startButton.disabled = true;
        startButton.textContent = 'Starte Kamera...';
        const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
        console.log('Rufe getUserMedia auf mit constraints:', constraints);
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Stream erhalten:', stream);
        video.srcObject = stream;
        console.log('Video srcObject gesetzt');

        const onReady = () => {
            console.log('Video metadata geladen');
            video.play().catch(() => {});
            mainMenu.classList.add('hidden');
            scannerView.classList.remove('hidden');

            // Sync overlay canvas to actual video pixel size (Backstore) und CSS-Position
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            alignOverlayToVideo();
            requestAnimationFrame(processFrame);
        };
        if (video.readyState >= 1) {
            onReady();
        } else {
            video.onloadedmetadata = onReady;
        }

    } catch (err) {
        statusMessage.textContent = `Kamera-Fehler: ${err.message}`;
        console.error('Error accessing camera:', err);
        startButton.disabled = false;
        startButton.textContent = 'Scan starten';
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
    if (!stream || !video.videoWidth || !cvReady) {
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

    let usedWebGL = false; // v1.3.3: track whether WebGL preprocessing was actually used
    try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Stabile Methode zur Bilderfassung
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
    tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    src.data.set(tempCtx.getImageData(0, 0, video.videoWidth, video.videoHeight).data);
        
    // Zielgröße für CPU-Scaling
    const scale = MAX_PROCESSING_WIDTH / video.videoWidth;
    const dsize = new cv.Size(MAX_PROCESSING_WIDTH, Math.round(video.videoHeight * scale));
        cv.resize(src, scaled, dsize, 0, 0, cv.INTER_AREA);

        // Dynamische Anpassung: Speed Tier Wechsel abhängig von Frame-Zeit & Stabilität
        if (performanceStats.frameCount > 30) {
            const avg = performanceStats.avgFrameTime;
            // Upgrade (schneller machen) wenn wir sehr viele langsame Frames (tracking wirkt träge)
            if (avg > 95 && currentSpeedTier !== SpeedTiers.FAST) {
                applySpeedTier(SpeedTiers.FAST);
                FRAME_HISTORY_SIZE = currentSpeedTier.history;
            } else if (avg > 120 && currentSpeedTier !== SpeedTiers.ULTRA) {
                applySpeedTier(SpeedTiers.ULTRA);
                FRAME_HISTORY_SIZE = currentSpeedTier.history;
            } else if (avg < 70 && currentSpeedTier === SpeedTiers.FAST) {
                applySpeedTier(SpeedTiers.NORMAL);
                FRAME_HISTORY_SIZE = currentSpeedTier.history;
            } else if (avg < 55 && currentSpeedTier === SpeedTiers.NORMAL) {
                applySpeedTier(SpeedTiers.QUALITY);
                FRAME_HISTORY_SIZE = currentSpeedTier.history;
            }
        }

        // v1.3: Enhanced Pipeline with Multi-Frame Processing
        // Optionale WebGL Vorverarbeitung (PoC): grayscale + optional blur
        let preprocMat = null;
        if (webglEnabled && webglSupported && typeof WebGLPoC !== 'undefined' && WebGLPoC.processWebGL) {
            try {
                // Render the scaled frame into an offscreen canvas
                const scCanvas = document.createElement('canvas');
                scCanvas.width = scaled.cols; scCanvas.height = scaled.rows;
                const scCtx = scCanvas.getContext('2d');
                const scImageData = new ImageData(new Uint8ClampedArray(scaled.data), scaled.cols, scaled.rows);
                scCtx.putImageData(scImageData, 0, 0);

                // Prefer direct GPU readback to avoid 2D-canvas overhead
                let proc = null;
                const t0 = performance.now();
                try {
                    proc = WebGLPoC.processWebGL(scCanvas, { readPixels: true, downscale: webglDownscale, blur: webglDoBlur, timings: true });
                } catch (e) {
                    // Fallback to canvas path if readPixels not supported
                    const processedCanvas = WebGLPoC.processWebGL(scCanvas, { downscale: webglDownscale, blur: webglDoBlur });
                    const rbCanvas = document.createElement('canvas');
                    rbCanvas.width = processedCanvas.width;
                    rbCanvas.height = processedCanvas.height;
                    const rbCtx = rbCanvas.getContext('2d');
                    try { rbCtx.drawImage(processedCanvas, 0, 0); } catch (e2) { throw new Error('drawImage failed: ' + e2.message); }
                    const procImg = rbCtx.getImageData(0, 0, rbCanvas.width, rbCanvas.height);
                    preprocMat = cv.matFromImageData(procImg);
                }
                if (proc && proc.pixels) {
                    // gl.readPixels returns data starting from bottom-left; flip to top-left for ImageData/cv
                    const w = proc.width, h = proc.height;
                    const src = proc.pixels; // Uint8Array
                    const rowBytes = w * 4;
                    const flipped = new Uint8ClampedArray(src.length);
                    for (let y = 0; y < h; y++) {
                        const srcOff = (h - 1 - y) * rowBytes;
                        const dstOff = y * rowBytes;
                        flipped.set(src.subarray(srcOff, srcOff + rowBytes), dstOff);
                    }
                    const imgData = new ImageData(flipped, w, h);
                    preprocMat = cv.matFromImageData(imgData);
                    addDebugLog('🧪 WebGL readPixels genutzt');
                    if (proc.timings) {
                        const tt = proc.timings;
                        addDebugLog(`🧪 WebGL timing: upload=${tt.upload.toFixed(1)}ms, draw=${tt.draw.toFixed(1)}ms, readback=${tt.readback.toFixed(1)}ms, total=${tt.total.toFixed(1)}ms (scale=${proc.scale?.toFixed?.(2) ?? '1.00'}, blur=${proc.blur?'on':'off'})`);
                    }
                }
                // Convert to grayscale (already grayscale RGB), but ensure single channel
                cv.cvtColor(preprocMat, gray, cv.COLOR_RGBA2GRAY);
                addDebugLog('🧪 WebGL Preprocessing angewendet');
                // Ensure this info also reaches the server logs at least once per session (bypass throttle)
                if (typeof window !== 'undefined') {
                    if (!window.__webglPreprocLoggedServer) {
                        window.__webglPreprocLoggedServer = true;
                        try {
                            fetch('/log', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'INFO: WebGL Preprocessing angewendet' });
                        } catch (e2) { /* ignore network errors */ }
                    }
                }
                usedWebGL = true;
            } catch (e) {
                const emsg = formatErr(e);
                addDebugLog(`🧪 <span style="color:#f80">WebGL Fehler, Fallback:</span> ${emsg}`);
                logErrorToServer(`WEBGL_FALLBACK ${emsg}`);
                cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
            }
        } else {
            cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
        }
        frameCounter++;

        // Aktualisiere effektive Mapping-Faktoren (Detektionsbild -> Video)
        if (gray && gray.cols > 0 && gray.rows > 0) {
            lastDetW = gray.cols; lastDetH = gray.rows;
            const vW = (video.videoWidth || canvas.width || 1);
            const vH = (video.videoHeight || canvas.height || 1);
            lastInvDetScaleX = vW / lastDetW;
            lastInvDetScaleY = vH / lastDetH;
        } else {
            lastDetW = MAX_PROCESSING_WIDTH;
            lastDetH = Math.max(1, Math.round(video.videoHeight * scale));
            const vW = (video.videoWidth || canvas.width || 1);
            const vH = (video.videoHeight || canvas.height || 1);
            lastInvDetScaleX = vW / lastDetW;
            lastInvDetScaleY = vH / lastDetH;
        }

        // v1.3: Multi-Frame Processing
        addToFrameHistory(gray);

        // Stage 1: Frame Averaging (wenn genügend Frames vorhanden)
        let procFrame = gray;
        let avgFrame = calculateFrameAverage();
        if (avgFrame && frameHistory.length >= 3) {
            procFrame = avgFrame;
        }

        // Stage 2: Bilateral Filter für Rauschreduzierung
    let filtered = new cv.Mat();
        try {
            if (currentSpeedTier.bilateral) {
                cv.bilateralFilter(procFrame, filtered, 7, 60, 60);
            } else {
                // Schnelleres Filter für schnelle Modi
                cv.medianBlur(procFrame, filtered, 3);
            }

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
            const emsg = formatErr(error);
            console.error('v1.3 Pipeline Error:', emsg);
            addDebugLog(`❌ <span style="color: #f00">Pipeline Error:</span> ${emsg}`);
            logErrorToServer(`PIPELINE_ERROR ${emsg}`);
            // Fallback zur v1.1 Pipeline bei Fehlern
            cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
            cv.Canny(gray, thresh, 50, 100);
            cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            console.log(`v1.3: ${contours.size()} Konturen (Fallback)`);
            addDebugLog(`🔄 <span style="color: #fa0">Fallback aktiv:</span> ${contours.size()} Konturen`);
        } finally {
            if (filtered && !filtered.isDeleted()) filtered.delete();
            if (avgFrame && !avgFrame.isDeleted()) avgFrame.delete();
            if (preprocMat && !preprocMat.isDeleted()) preprocMat.delete();
        }

        // v1.3: Confidence-basierte Dokumenterkennung
    let foundContour = findDocumentContour(contours, lastDetW, lastDetH);
        let confidence = 0.0;

        if (foundContour) {
            confidence = calculateContourConfidence(foundContour, {width: lastDetW, height: lastDetH});
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
            // Canvas vor dem Zeichnen leeren, dann Kontur pixelgenau zeichnen
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawContour(biggestContour, lastInvDetScaleX, lastInvDetScaleY); 
            
            if (documentStableCount >= STABLE_FRAMES_REQUIRED) {
                if (testMode) {
                    statusMessage.textContent = 'Stabil erkannt. Test Mode aktiv – kein Auto-Scan.';
                    if (autoScanTimer) { clearTimeout(autoScanTimer); autoScanTimer = null; }
                } else {
                    // Dynamischer Delay: hohe Confidence => schnellerer Trigger
                    const dynamicDelay = Math.max(currentSpeedTier.minDelay, Math.round(AUTO_SCAN_DELAY * (1.0 - Math.min(0.35, (confidence - 0.65)))));
                    statusMessage.textContent = `Stabil erkannt. Scan in ${dynamicDelay}ms...`;
                    if (!autoScanTimer) {
                        addDebugLog(`📸 <span style=\"color:#0f0\">AUTO-SCAN</span> (Delay=${dynamicDelay}ms, Tier=${currentSpeedTier.name})`);
                        autoScanTimer = setTimeout(() => { safeCapture(); autoScanTimer = null; }, dynamicDelay);
                    }
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

    // v1.3.3: Accumulate per-window perf by pipeline
    if (usedWebGL) {
        perfWindow.webglFrames++;
        perfWindow.sumMsWebGL += frameTime;
    } else {
        perfWindow.cpuFrames++;
        perfWindow.sumMsCPU += frameTime;
    }

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

        // Heartbeat nur jedes zweite 60er-Intervall (~120 Frames), gedrosselt
        if ((performanceStats.frameCount / 60) % 2 === 0) {
            logInfoThrottled(`HEARTBEAT v1.3.3 frames=${performanceStats.frameCount} avgMs=${performanceStats.avgFrameTime.toFixed(1)} fps=${fps.toFixed(1)}`);
        }

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

function findDocumentContour(contours, detWidth, detHeight) {
    let maxArea = 0;
    let biggest = null;
    const baseW = Math.max(1, detWidth || MAX_PROCESSING_WIDTH);
    const baseH = Math.max(1, detHeight || Math.round((MAX_PROCESSING_WIDTH * 9) / 16));
    const minArea = (baseW * baseH) * 0.05; // Mindestfläche 5% des Detektionsbildes

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

function drawContour(contour, scaleX, scaleY) {
    // Wichtig: Canvas-Backstore bleibt auf Video-Pixelmaß (video.videoWidth/Height)
    // CSS-Größe wird separat über alignOverlayToVideo gesetzt.
    ctx.beginPath();
    ctx.moveTo(contour.data32S[0] * scaleX, contour.data32S[1] * scaleY);
    for (let i = 1; i < contour.rows; i++) {
        ctx.lineTo(contour.data32S[i * 2] * scaleX, contour.data32S[i * 2 + 1] * scaleY);
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

// Throttled server logging (min 5s between posts)
let __lastServerLogTs = 0;
async function logErrorToServer(error) {
    // v1.3.1: Erweiterte Server-Logging mit POST-Request
    const logMessage = typeof error === 'string' ? error : (error.message || error);
    console.error('v1.3.3 Log:', logMessage);

    if (error.stack) {
        console.error('Stack:', error.stack);
    }

    // POST-Request an Server für persistente Speicherung
    try {
        const now = Date.now();
        if (now - __lastServerLogTs < 5000) {
            return; // Throttle
        }
        __lastServerLogTs = now;
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

// Info/Heartbeat-Logger (ebenfalls gedrosselt)
async function logInfoThrottled(message) {
    const now = Date.now();
    if (now - __lastServerLogTs < 5000) return;
    __lastServerLogTs = now;
    try { await fetch('/log', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `INFO: ${message}` }); } catch {}
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
    // v1.3.3: Compute per-window averages for WebGL vs CPU
    const webglAvg = perfWindow.webglFrames > 0 ? (perfWindow.sumMsWebGL / perfWindow.webglFrames) : null;
    const cpuAvg = perfWindow.cpuFrames > 0 ? (perfWindow.sumMsCPU / perfWindow.cpuFrames) : null;

    const summaryData = {
        sessionDuration: sessionDuration,
        performance: performanceGrade,
        avgFrameTime: validationStats.performanceBenchmarks.avgProcessingTime,
        webgl: { supported: webglSupported, enabled: webglEnabled, frames: perfWindow.webglFrames, avgMs: webglAvg },
        cpu: { frames: perfWindow.cpuFrames, avgMs: cpuAvg },
        stabilityRatio: stabilityRatio,
        successRate: successRate,
        totalDetections: validationStats.documentDetections,
        totalScans: validationStats.totalScans,
        avgConfidence: validationStats.avgConfidenceScore,
        timestamp: new Date().toISOString()
    };

    console.log('VALIDATION_SUMMARY:', JSON.stringify(summaryData));
    logErrorToServer(`VALIDATION_SUMMARY: ${JSON.stringify(summaryData)}`);

    // v1.3.3: reset perf window after logging to get next window metrics
    perfWindow.webglFrames = 0;
    perfWindow.cpuFrames = 0;
    perfWindow.sumMsWebGL = 0;
    perfWindow.sumMsCPU = 0;
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
    // Ecken aus Detektionsraum (lastDetW/lastDetH) in Videoraum umrechnen
    const corners = getOrderedCorners(biggestContour, lastInvDetScaleX, lastInvDetScaleY);
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
        // Automatisches Speichern jeder neuen Seite (kein Duplikat zur letzten)
        if (scannedPages.length === 0) {
            scannedPages.push(finalImageData);
            addDebugLog('➕ Seite #1 automatisch hinzugefügt');
        } else if (scannedPages[scannedPages.length - 1] !== finalImageData) {
            scannedPages.push(finalImageData);
            addDebugLog(`➕ Seite #${scannedPages.length} automatisch hinzugefügt`);
        } else {
            addDebugLog('ℹ️ Aufnahme entspricht letzter Seite – nicht erneut gespeichert');
        }
        updatePageCounter();
        
        // JETZT erst den Scanner stoppen, nachdem das Bild erfasst wurde
        stopScanner();
        
        resultImage.onload = () => {
            scannerView.classList.add('hidden');
            resultView.classList.remove('hidden');
            addDebugLog('📸 Einzelbild erfasst – bereit zum Hinzufügen oder PDF-Erstellung');
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

function getOrderedCorners(contour, scaleX = 1, scaleY = 1) {
    const points = [];
    for (let i = 0; i < contour.rows; i++) {
        points.push({ x: contour.data32S[i * 2] * scaleX, y: contour.data32S[i * 2 + 1] * scaleY });
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
    // late try to init WebGL if webgl.js loaded after opencv callback
    initWebGLIfAvailable();
    // Overlay bei Größenänderungen neu ausrichten
    window.addEventListener('resize', alignOverlayToVideo);
    window.addEventListener('orientationchange', alignOverlayToVideo);
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
