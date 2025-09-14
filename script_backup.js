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

// Performance-Optimierung für Mobilgeräte
const MAX_PROCESSING_WIDTH = 640;

let biggestContour = null;
let documentStableCount = 0;
let autoScanTimer = null;
const STABLE_FRAMES_REQUIRED = 15; // Kürzere Zeit für mobile Geräte
const AUTO_SCAN_DELAY = 1500; // Kürzere Verzögerung

// --- Initialization ---
function onOpenCvReady() {
    console.log('OpenCV is ready.');
    console.log('cv object:', typeof cv !== 'undefined' ? 'verfügbar' : 'nicht verfügbar');
    cvReady = true;
    startButton.disabled = false;
    startButton.textContent = 'Scan starten';
    console.log('Start-Button aktiviert');
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
    scannerView.classList.add('hidden');
}

function processFrame() {
    if (!stream || !video.videoWidth) {
        requestAnimationFrame(processFrame);
        return;
    }

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

        // Bildverarbeitung auf dem kleineren Bild
        cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        cv.Canny(gray, thresh, 50, 100);
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let foundContour = findDocumentContour(contours, scale);

        if (foundContour) {
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

async function logErrorToServer(error) {
    try {
        const response = await fetch('/log', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
            },
            body: `Error: ${error.message}\nStack: ${error.stack}`,
        });
        if (!response.ok) {
            console.error('Failed to send log to server');
        }
    } catch (e) {
        console.error('Error sending log to server:', e);
    }
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
        } else {
            console.error('Fehler beim Speichern:', result.message);
            logErrorToServer(`Fehler beim Speichern: ${result.message}`);
        }
    } catch (error) {
        console.error('Fehler beim Senden an Server:', error);
        logErrorToServer(`Fehler beim Senden an Server: ${error.message}`);
    }
}

// Initialer Zustand
startButton.disabled = true;
startButton.textContent = 'Lade KI-Modell...';
