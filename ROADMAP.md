# OpenCV Web Document Scanner – Entwicklungsplan (Roadmap)

Stand: 2025-09-14

Diese Roadmap strukturiert die nächsten inkrementellen Versionen. Jede Version hat klare Ziele, Akzeptanzkriterien, Tests und ein minimales Rollout-Prozedere – so können wir nach jedem Schritt valide testen und ggf. nachjustieren.

## 0) Aktueller Stand (v1.3.2)

 Bereits umgesetzt:

- Multi-Frame Averaging und temporale Stabilisierung (Kontur-/Confidence-Historie)
- Adaptive Canny (Median-basiert) + Fallback (Gaussian + fixed Canny)
- Bilateral Filter, Morphology Close (3×3) für Kantenkontinuität
- Confidence-Scoring (Area, Rectangularity, Aspect), Auto-Scan bei stabiler Erkennung
- Performance-/Health-Monitoring, gedrosseltes Server-Logging (INFO/HEARTBEAT)
- HTTPS (moderner SSLContext), No-Cache, Logrotation

 Noch offen (wichtige Kandidaten):

- CLAHE (Kontrastanhebung), adaptiveThreshold (Binarisierung)
- Morphologische Varianten (Opening/Gradient) + flexible Kernelgrößen
- Schatten-/Blendungs-Handling (Masken) – „Glare Suppression“ / „Shadow Compensation“
- Szenenanalyse (Helligkeit/Kontrast) und Auto-Switching zwischen Pipelines
- jscanify-Ideen als optionaler Modus
- Lernende Parameter (Qualitätsfeedback) und einfache Background-Modelle
- ML (TF.js) für Corner/Segmentation als separater Pfad

---

## v1.3.3 – Adaptive Kontrast & Binarisierung (Low-Risk, sofortiger Nutzen)

 Ziele:



- Optionales Preprocessing:
  - CLAHE auf Graubild (z. B. `clipLimit=2.0`, `tileGridSize=8×8`)
  - Alternative Binär-Pipeline: `cv.adaptiveThreshold(gray, …, cv.ADAPTIVE_THRESH_GAUSSIAN_C, blockSize, C)`
  - Morphologie-Varianten: Close/Open/Gradient (3×3 bzw. 5×5) konfigurierbar
- UI: kleines Settings-Panel (Toggles: `useCLAHE`, `useAdaptiveThresh`, `morphMode`, `kernelSize`)
- Debug: Pfad/Parameter in Panel (gedrosselt) sichtbar machen

 Akzeptanzkriterien:



- In 10 Testbildern mit ungleichmäßiger Beleuchtung und farbigem Papier: +10–20% stabilere Dokumentkontur (visuelle Kontrolle) vs. v1.3.2
- Keine Regression unter guter Beleuchtung (Erkennungsrate und FPS ~ gleich)
- Durchschnittliche Framezeit max. +10% bei aktivierten Features

 Tests:

- Datensets: gut belichtet, ungleichmäßig belichtet, leicht farbiges Papier
- Metriken: Kontur gefunden (ja/nein), Confidence, Stabilität, Framezeit (Øms), FPS
- Manuell: Overlay/Debug-Screenshots sichern

 Rollout-Checkliste:

- README & VERSION aktualisieren, Tag `v1.3.3`, Release Notes

 Risiken & Mitigation:

- Zu aggressive Binarisierung: per Toggle abschaltbar; Bounds für `blockSize`/`C` dokumentiert

---

## v1.3.4 – Szenenanalyse & Auto-Switching (mittleres Risiko)

 Ziele:



- Szenenanalyse: Helligkeit/Kontrast/Histogramm-Statistiken (mean, stdev, Anteil dunkler/heller Pixel)
- Auto-Pipeline-Switching:
  - Dunkel/kontrastarm → CLAHE + adaptiveThreshold
  - Hell/glare-verdächtig → Canny mit reduziertem oberen Threshold, Gradient + Close
- UI: Toggle „Auto Mode“ + manueller Override
- Debug: Entscheidungsweg/Statistiken je Frame anzeigen (gedrosselt)

 Akzeptanzkriterien:



- In Mixed-Lighting-Set +15% Erkennungsrate ggü. fixem Pfad bei <15% Performance-Kosten

 Tests:

- A/B: Auto vs. Canny-only vs. Adaptive-only; Szenen: hell/dunkel/backlight/farbiges Papier

 Rollout-Checkliste:

- Docs/Notes, `v1.3.4` taggen

---

## v1.3.5 – Schatten & Blendung (sichtbarer Effekt)

 Ziele:

- Glare-Maske: Helligkeitsspitzen (HSV-V oder L*a*b* L) detektieren; sanftes Glätten/Inpainting lokal vor Kantenbildung
- Schatten-Maske: Öffnung großer weicher Strukturen oder illumination normalization (z. B. `gray/(blur(gray)+eps)`, clamped)
- UI: Toggles `glareSuppression`, `shadowCompensation`

 Akzeptanzkriterien:

- In 5 Glare- & 5 Schatten-Szenen: +20% Kontinuität der Dokumentkanten (weniger Lücken), keine massiven Artefakte

 Tests:

- spezielle Reflektions-/Schatten-Fotos; visuelle Kontinuität der Kanten und Polygon-Fit

 Risiken & Mitigation:

- Überkompensation → enge Grenzwerte und Fallback; Visualkontrolle

---

## v1.3.6 – Kontur-Robustheit & Geometrie (Qualitätsgewinn)

 Ziele:

- Candidate-Ranking erweitern (Kantenlänge-Kontinuität, Gradientenstärke entlang Kontur, rechteckiger Fit, Off-Axis-Handling)
- Stabilere `approxPolyDP`-Parameter und Corner-Sortierung; Outlier-Reject (leichtgewichtig)
- UI: „Strict rectangle“ vs. „Flexible quadrilateral“ Option

 Akzeptanzkriterien:

- Weniger Falschpositive im unruhigen Hintergrund; stabilere Ecken über ≥10 Frames

---

## v1.4.0 – jscanify-Ideen portieren (optional)

 Ziele:

- Ausgewählte jscanify-Techniken als separater „J-Mode“ (opt-in) übernehmen
- Saubere Lizenz-/Credit-Hinweise; klare Trennung zu Standardpfad

 Akzeptanzkriterien:

- In „farbiges Papier auf einheitlicher Fläche“ mindestens gleichwertig zu v1.3.6, oft besser

---

## v1.5.0 – Lernende Parameter & Background-Modelle (experimentell)

Ziele:
- Qualitätsfeedback-Loop in LocalStorage (z. B. durchschnittliche Confidence/Stabilität je Szene) → Startwerte anpassen
- Einfache Background-Subtraction für stationäre Setups (optional)

Akzeptanzkriterien:
- Nach 3–5 Scans im gleichen Setup schnellerer Stabilitätspunkt, keine negativen Nebenwirkungen

---

## v2.0 – ML (TF.js) Corner/Segmentation (separater Pfad)

Ziele:
- Leichtes TF.js-Modell für Corner-Heatmaps oder grobe Segmentation (quantisiert)
- Hybrid: ML liefert Eckpunkte/Grobe Maske; OpenCV verfeinert Kante & Perspektive
- Strikte Fallbacks (WASM-only bleibt möglich)

Akzeptanzkriterien:
- Stabilere Ecke in schwierigen Settings bei akzeptabler Latenz (z. B. <120ms/frame mobil Low-Res)

---

## Globale Teststrategie & Metriken

 Datensets:

- Gut/neutral, ungleichmäßige Beleuchtung, Schatten/Blendung, farbiges Papier, unruhiger Hintergrund, Off-Axis

 Metriken (pro Version):

- Erkennungsrate (Quadrilaterale), durchschnittliche Confidence, Stabilität (Detections vs. Losses), False-Positive-Rate, FPS/Framezeit
- Automatisierte Zusammenfassung in Logs (bereits vorhanden), manuelle Overlays/Screenshots

 Akzeptanz-„Contract“ (I/O):

- Input: Frame + Settings (`useCLAHE`, `useAdaptiveThresh`, `morphMode`, `kernelSize`, `autoMode`, `glareSuppression`, `shadowCompensation`, …)
- Output: `bestContour` (4 Punkte) + `confidence` + `debugMeta`; bei Fehler sinnvoller Fallback/Status

---

## Release-Prozess (pro Version)

1) Implementieren (feature-flagged, sichere Defaults)
2) Mini-Datensets testen (A/B, Messwerte notieren)
3) Doku aktualisieren (README, VERSION, ggf. TEST_RESULTS)
4) Tag setzen (z. B. `v1.3.3`), Release Notes erstellen
5) Optional: Demo-Screenshots/Beispielbilder anhängen

---

## Nächster Schritt

Beginne mit v1.3.3 (CLAHE + adaptiveThreshold + Morph-Varianten inkl. UI-Toggles), messe die Effekte, dokumentiere im `TEST_RESULTS.md`, dann Release `v1.3.3`.
