import http.server
import ssl
import os
import datetime
import base64
import json

# Get the directory of the script
script_dir = os.path.dirname(os.path.abspath(__file__))
# Change the current working directory to the script's directory
os.chdir(script_dir)

LOG_FILE = "debug.log"
MAX_LOG_SIZE = 5 * 1024 * 1024  # 5MB

def rotate_log_if_needed():
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_LOG_SIZE:
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            os.rename(LOG_FILE, f"debug_{ts}.log")
    except Exception:
        pass

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable caching so updated JS/HTML are always fetched during development
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        return super().end_headers()
    def do_POST(self):
        if self.path == '/log':
            try:
                content_length = int(self.headers['Content-Length'])
                log_message = self.rfile.read(content_length).decode('utf-8')
                
                # Log-Nachricht mit Zeitstempel in eine Datei schreiben
                rotate_log_if_needed()
                with open(LOG_FILE, "a") as log_file:
                    timestamp = datetime.datetime.now().isoformat()
                    log_file.write(f"{timestamp}: {log_message}\n")
                
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'Log received')
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f'Server error: {e}'.encode('utf-8'))
        
        elif self.path == '/save-image':
            try:
                content_length = int(self.headers['Content-Length'])
                data = self.rfile.read(content_length).decode('utf-8')
                image_data = json.loads(data)
                
                # Base64-codiertes Bild dekodieren
                image_base64 = image_data.get('image', '')
                if image_base64.startswith('data:image/png;base64,'):
                    image_base64 = image_base64[22:]  # Entferne data-URL Prefix
                
                # Timestamp für eindeutigen Dateinamen
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                image_type = image_data.get('type', 'scan')
                filename = f"{image_type}_{timestamp}.png"
                
                # Bild speichern
                with open(filename, "wb") as img_file:
                    img_file.write(base64.b64decode(image_base64))
                
                # Log-Eintrag
                rotate_log_if_needed()
                with open(LOG_FILE, "a") as log_file:
                    log_file.write(f"{datetime.datetime.now().isoformat()}: Bild gespeichert: {filename}\n")
                
                response = json.dumps({"status": "success", "filename": filename})
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(response.encode('utf-8'))
                
            except Exception as e:
                error_msg = f'Server error while saving image: {e}'
                rotate_log_if_needed()
                with open(LOG_FILE, "a") as log_file:
                    log_file.write(f"{datetime.datetime.now().isoformat()}: {error_msg}\n")
                    
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                error_response = json.dumps({"status": "error", "message": str(e)})
                self.wfile.write(error_response.encode('utf-8'))
        
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not Found')

server_address = ('0.0.0.0', 8000)
httpd = http.server.HTTPServer(server_address, MyHTTPRequestHandler)

# Modern SSLContext setup (replaces deprecated ssl.wrap_socket)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
context.options |= ssl.OP_NO_SSLv2 | ssl.OP_NO_SSLv3  # disable old protocols
context.minimum_version = ssl.TLSVersion.TLSv1_2
httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

print(f"Serving HTTPS on https://{server_address[0]}:{server_address[1]}")
httpd.serve_forever()
