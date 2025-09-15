# v1.3.2 — Conservative & Clean (Basis v1.3.1)

Datum: 2025-09-14

Kurzüberblick

- ✅ Basis-Pipeline aus v1.3.1 beibehalten (stabile Erkennung)
- 🎯 `CONFIDENCE_THRESHOLD` auf `0.62` gesenkt (robuster bei schwieriger Beleuchtung)
- 🧠 Gedrosseltes Server-Logging (INFO/HEARTBEAT) zur Reduktion von Log-Spam
- 🚫 No-Cache HTTP-Header: immer aktuelle JS/CSS ohne Browser-Cache
- 🗂️ Logrotation ab 5MB (`debug_YYYYMMDD_HHMMSS.log`)
- 🔐 Moderner SSLContext (TLS ≥ 1.2), ersetzt `ssl.wrap_socket` (Deprecation entfernt)

Stabilität & Kompatibilität

- Keine Änderungen an der Kernerkennung/Contour-Pipeline → Verhalten wie v1.3.1
- UI-Beschriftungen/Debug-Panel auf „v1.3.2“ aktualisiert

Wie starten

```bash
python3 server.py
# Danach im Browser öffnen: https://<host>:8443
```

Changelog-Details

- Vollständige Details: `versions/v1.3.2/VERSION.md`
- Vorversion: v1.3.1 – Optimized & Validated (als Basis übernommen)

Danke fürs Testen und Feedback! 🚀
