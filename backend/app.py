import os
import sys
import json
import uuid
import shutil
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer
import urllib.parse

# Import Tkinter for native file dialogs (built-in to Python on Windows)
import tkinter as tk
from tkinter import filedialog
import datetime

# Import PDF processing logic
from pdf_processor import convert_pdf_to_images, crop_question_image, detect_questions_on_page

# App directories
if getattr(sys, 'frozen', False):
    # Running in a PyInstaller bundle
    BASE_DIR = sys._MEIPASS
    FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
    # Data directory goes next to the executable
    DATA_DIR = os.path.join(os.path.dirname(sys.executable), "data")
else:
    # Running from source
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
    DATA_DIR = os.path.join(BASE_DIR, "data")

os.makedirs(DATA_DIR, exist_ok=True)
import zipfile

# Global webview window reference
app_window = None

class DesktopAPI:
    def export_test(self, test_id, test_title):
        global app_window
        if not app_window:
            return {"status": "error", "message": "Desktop window not initialized."}
        
        import webview
        
        file_types = ('CBT Test Files (*.cbttest)', 'All files (*.*)')
        # Fix string formatting issue for filename
        clean_title = "".join(c if c.isalnum() else "_" for c in test_title)
        
        result = app_window.create_file_dialog(
            webview.SAVE_DIALOG, 
            directory='', 
            save_filename=f'{clean_title}_{test_id[:6]}.cbttest',
            file_types=file_types
        )
        
        if result:
            save_path = result[0]
            if not save_path.endswith('.cbttest'):
                save_path += '.cbttest'
            
            test_info_path = os.path.join(DATA_DIR, test_id, "info.json")
            test_folder_path = os.path.join(DATA_DIR, test_id)
            
            try:
                with zipfile.ZipFile(save_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    # We only need the test folder itself, because info.json is inside it!
                    if os.path.exists(test_folder_path):
                        for root, dirs, files in os.walk(test_folder_path):
                            for file in files:
                                file_path = os.path.join(root, file)
                                # Archive relative to data folder (e.g. "test_123/...")
                                arcname = os.path.relpath(file_path, DATA_DIR)
                                zipf.write(file_path, arcname)
                return {"status": "success", "message": f"Test exported successfully to {save_path}"}
            except Exception as e:
                return {"status": "error", "message": f"Failed to export: {str(e)}"}
        return {"status": "cancelled"}

    def import_test(self):
        global app_window
        if not app_window:
            return {"status": "error", "message": "Desktop window not initialized."}
        
        import webview
        
        file_types = ('CBT Test Files (*.cbttest)', 'All files (*.*)')
        result = app_window.create_file_dialog(
            webview.OPEN_DIALOG, 
            allow_multiple=False, 
            file_types=file_types
        )
        
        if result:
            import_path = result[0]
            try:
                with zipfile.ZipFile(import_path, 'r') as zipf:
                    # Security check
                    for name in zipf.namelist():
                        if '..' in name or name.startswith('/') or name.startswith('\\'):
                            return {"status": "error", "message": "Invalid or unsafe test file."}
                    
                    # Extract contents into data folder
                    zipf.extractall(DATA_DIR)
                return {"status": "success", "message": "Test imported successfully!"}
            except Exception as e:
                return {"status": "error", "message": f"Failed to import: {str(e)}"}
        return {"status": "cancelled"}

class CBTRequestHandler(SimpleHTTPRequestHandler):
    """
    Custom HTTP request handler to serve static frontend files, 
    cropped question images, and handle API requests.
    """
    def __init__(self, *args, **kwargs):
        # Override directory to serve frontend by default
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def translate_path(self, path):
        """
        Custom path translation to serve `/data/...` requests from the local data folder,
        and everything else from the frontend folder.
        """
        # Parse URL path
        parsed_url = urllib.parse.urlparse(path)
        url_path = parsed_url.path
        
        # If requesting data folder
        if url_path.startswith('/data/'):
            relative_path = url_path[6:]  # Strip '/data/'
            # Prevent directory traversal attacks
            relative_path = os.path.normpath(relative_path).lstrip(os.path.sep)
            return os.path.join(DATA_DIR, relative_path)
            
        return super().translate_path(path)

    def do_OPTIONS(self):
        """Handle pre-flight requests for CORS if needed"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        """Add CORS headers to all responses"""
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_POST(self):
        """Handle JSON API Post requests"""
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        if path.startswith('/api/'):
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                params = json.loads(post_data.decode('utf-8')) if post_data else {}
            except Exception:
                params = {}
                
            self.handle_api_request(path, params)
        else:
            self.send_error(404, "Endpoint not found")

    def handle_api_request(self, endpoint, params):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        
        response = {"success": False, "error": None}
        
        try:
            # 1. Select PDF File via Native File Dialog
            if endpoint == '/api/select_pdf':
                # Run Tkinter file dialog in the main thread or safely in helper
                root = tk.Tk()
                root.withdraw() # Hide main window
                root.attributes("-topmost", True) # Bring to front
                
                file_path = filedialog.askopenfilename(
                    title="Select Question Paper PDF",
                    filetypes=[("PDF files", "*.pdf")]
                )
                root.destroy()
                
                if file_path:
                    response["success"] = True
                    response["file_path"] = file_path
                    response["file_name"] = os.path.basename(file_path)
                else:
                    response["success"] = False
                    response["error"] = "No file selected"

            # 2. Convert PDF to PNG Pages
            elif endpoint == '/api/convert_pdf':
                pdf_path = params.get('pdf_path')
                test_id = params.get('test_id', str(uuid.uuid4()))
                
                test_pages_dir = os.path.join(DATA_DIR, test_id, "pages")
                # Increased DPI to 400 so zoomed images look as crisp as original PDFs
                pages_meta = convert_pdf_to_images(pdf_path, test_pages_dir, dpi=400)
                
                # Make paths relative to serve via HTTP
                for page in pages_meta:
                    page["image_url"] = f"/data/{test_id}/pages/{os.path.basename(page['image_path'])}"
                
                response["success"] = True
                response["test_id"] = test_id
                response["pages"] = pages_meta

            # 3. Crop Question Bounding Box
            elif endpoint == '/api/crop_question':
                test_id = params.get('test_id')
                page_number = params.get('page_number')
                crop_box = params.get('crop_box') # {x, y, width, height} in percentages
                question_num = params.get('question_number')
                
                page_img_path = os.path.join(DATA_DIR, test_id, "pages", f"page_{page_number}.png")
                output_path = os.path.join(DATA_DIR, test_id, "questions", f"Q_{question_num}.png")
                
                cropped_path = crop_question_image(page_img_path, crop_box, output_path)
                
                response["success"] = True
                response["image_url"] = f"/data/{test_id}/questions/Q_{question_num}.png?t={uuid.uuid4().hex[:6]}"

            # 3.5 Auto Detect Questions
            elif endpoint == '/api/auto_detect_crops':
                test_id = params.get('test_id')
                page_number = params.get('page_number')
                
                page_img_path = os.path.join(DATA_DIR, test_id, "pages", f"page_{page_number}.png")
                
                boxes = detect_questions_on_page(page_img_path)
                
                response["success"] = True
                response["boxes"] = boxes

            # 4. Save Test Metadata (Title, ranges, answer keys)
            elif endpoint == '/api/save_test':
                test_id = params.get('test_id')
                metadata = params.get('metadata') # dictionary containing metadata
                
                if not metadata:
                    response["success"] = False
                    response["error"] = "Invalid or empty metadata provided"
                else:
                    test_dir = os.path.join(DATA_DIR, test_id)
                    os.makedirs(test_dir, exist_ok=True)
                    
                    info_path = os.path.join(test_dir, "info.json")
                    with open(info_path, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, indent=4, ensure_ascii=False)
                        
                    response["success"] = True

            # 5. List All Created Tests
            elif endpoint == '/api/list_tests':
                tests = []
                if os.path.exists(DATA_DIR):
                    for folder_name in os.listdir(DATA_DIR):
                        info_path = os.path.join(DATA_DIR, folder_name, "info.json")
                        if os.path.exists(info_path):
                            try:
                                with open(info_path, 'r', encoding='utf-8') as f:
                                    info = json.load(f)
                                    # Ensure test_id matches folder name
                                    info["test_id"] = folder_name
                                    tests.append(info)
                            except Exception:
                                pass
                response["success"] = True
                response["tests"] = tests

            # 5.5 Delete Test
            elif endpoint == '/api/delete_test':
                test_id = params.get('test_id')
                if test_id:
                    test_dir = os.path.join(DATA_DIR, test_id)
                    if os.path.exists(test_dir):
                        import shutil
                        shutil.rmtree(test_dir)
                    response["success"] = True
                else:
                    response["error"] = "No test_id provided"

            # 6. Load Single Test Data
            elif endpoint == '/api/get_test':
                test_id = params.get('test_id')
                info_path = os.path.join(DATA_DIR, test_id, "info.json")
                
                if os.path.exists(info_path):
                    with open(info_path, 'r', encoding='utf-8') as f:
                        info = json.load(f)
                        
                    # Load all past attempts
                    attempts = []
                    results_dir = os.path.join(DATA_DIR, test_id, "results")
                    if os.path.exists(results_dir):
                        for res_file in os.listdir(results_dir):
                            if res_file.endswith('.json'):
                                try:
                                    with open(os.path.join(results_dir, res_file), 'r', encoding='utf-8') as rf:
                                        res_data = json.load(rf)
                                        attempts.append({
                                            "result_id": res_file.replace('result_', '').replace('.json', ''),
                                            "overall": res_data.get("overall", {}),
                                            "time_taken": res_data.get("time_taken", 0),
                                            "timestamp": res_data.get("timestamp", "Unknown Date")
                                        })
                                except Exception:
                                    pass
                                    
                    # Sort attempts by timestamp descending (newest first)
                    attempts.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
                    info["attempts"] = attempts
                    
                    response["success"] = True
                    response["test"] = info
                else:
                    response["error"] = "Test not found"

            # 7. Submit Test Results & Analytics
            elif endpoint == '/api/submit_result':
                test_id = params.get('test_id')
                user_answers = params.get('answers') or {}  # Dict: { "1": "A", "2": "C", ... }
                time_taken = params.get('time_taken', 0)
                result_id_param = params.get('result_id') # Optional for re-evaluation
                
                info_path = os.path.join(DATA_DIR, test_id, "info.json")
                if not os.path.exists(info_path):
                    raise FileNotFoundError("Test metadata not found")
                    
                with open(info_path, 'r', encoding='utf-8') as f:
                    test_info = json.load(f) or {}
                
                answer_key = test_info.get("answer_key") or {} # Dict: { "1": "3", "2": "1", ... }
                subjects = test_info.get("subjects") or {} # Dict: { "1": "Physics", ... }
                
                # Evaluation
                results = {
                    "overall": {"score": 0, "correct": 0, "incorrect": 0, "skipped": 0, "total_questions": len(subjects)},
                    "breakdown": {},
                    "answers": {},
                    "time_taken": time_taken,
                    "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %I:%M %p")
                }
                
                # Initialize breakdown subjects
                unique_subjects = set(subjects.values())
                for sub in unique_subjects:
                    results["breakdown"][sub] = {"score": 0, "correct": 0, "incorrect": 0, "skipped": 0, "total": 0}
                
                for q_num in subjects.keys():
                    correct_ans = answer_key.get(q_num, "")
                    sub = subjects.get(q_num, "General")
                    if sub not in results["breakdown"]:
                        results["breakdown"][sub] = {"score": 0, "correct": 0, "incorrect": 0, "skipped": 0, "total": 0}
                        
                    results["breakdown"][sub]["total"] += 1
                    
                    user_ans = user_answers.get(q_num)
                    
                    # Convert format like "3" or "1" to A, B, C, D if user answers are A, B, C, D
                    # Option mapping: A=1, B=2, C=3, D=4 OR A=A, etc.
                    # Standard NEET answer sheet input format: "1. (3)" means question 1 is option 3 (C)
                    # Let's clean the correct answer to compare fairly.
                    
                    is_correct = False
                    is_skipped = True
                    
                    if user_ans:
                        is_skipped = False
                        
                        # Match user selection (A, B, C, D or 1, 2, 3, 4) with correct answer (1, 2, 3, 4 or A, B, C, D)
                        clean_user = str(user_ans).strip().upper()
                        clean_correct = str(correct_ans).strip().upper()
                        
                        # Map A->1, B->2, C->3, D->4
                        mapping_alpha_num = {"A": "1", "B": "2", "C": "3", "D": "4"}
                        mapping_num_alpha = {"1": "A", "2": "B", "3": "C", "4": "D"}
                        
                        if clean_user == clean_correct:
                            is_correct = True
                        elif mapping_alpha_num.get(clean_user) == clean_correct:
                            is_correct = True
                        elif mapping_num_alpha.get(clean_user) == clean_correct:
                            is_correct = True
                            
                    results["answers"][q_num] = {
                        "user_answer": user_ans,
                        "correct_answer": correct_ans,
                        "status": "correct" if is_correct else ("skipped" if is_skipped else "incorrect")
                    }
                    
                    if is_skipped:
                        results["overall"]["skipped"] += 1
                        results["breakdown"][sub]["skipped"] += 1
                    elif is_correct:
                        results["overall"]["correct"] += 1
                        results["overall"]["score"] += 4
                        results["breakdown"][sub]["correct"] += 1
                        results["breakdown"][sub]["score"] += 4
                    else:
                        results["overall"]["incorrect"] += 1
                        results["overall"]["score"] -= 1
                        results["breakdown"][sub]["incorrect"] += 1
                        results["breakdown"][sub]["score"] -= 1
                
                # Save result
                result_id = result_id_param if result_id_param else str(uuid.uuid4())[:8]
                results_dir = os.path.join(DATA_DIR, test_id, "results")
                os.makedirs(results_dir, exist_ok=True)
                
                result_file = os.path.join(results_dir, f"result_{result_id}.json")
                with open(result_file, 'w', encoding='utf-8') as f:
                    json.dump(results, f, indent=4)
                    
                response["success"] = True
                response["result_id"] = result_id
                response["results"] = results
                
            # 8. Load Result
            elif endpoint == '/api/get_result':
                test_id = params.get('test_id')
                result_id = params.get('result_id')
                result_file = os.path.join(DATA_DIR, test_id, "results", f"result_{result_id}.json")
                
                if os.path.exists(result_file):
                    with open(result_file, 'r', encoding='utf-8') as f:
                        res = json.load(f)
                    response["success"] = True
                    response["results"] = res
                else:
                    response["error"] = "Result not found"
            
            else:
                response["error"] = f"Unknown API endpoint: {endpoint}"
                
        except Exception as e:
            response["success"] = False
            response["error"] = str(e)
            
        self.wfile.write(json.dumps(response).encode('utf-8'))


class ThreadingHTTPServer(ThreadingTCPServer):
    """Multi-threaded HTTP Server for smooth parallel static asset serving"""
    allow_reuse_address = True

def start_local_server(port=8000):
    server_address = ('127.0.0.1', port)
    httpd = ThreadingHTTPServer(server_address, CBTRequestHandler)
    print(f"Starting server on http://127.0.0.1:{port}")
    httpd.serve_forever()

def main():
    # Force Tkinter styling and setup
    root = tk.Tk()
    root.withdraw()
    root.destroy()
    
    # Start multi-threaded local HTTP server on port 8000
    server_port = 8000
    server_thread = threading.Thread(target=start_local_server, args=(server_port,), daemon=True)
    server_thread.start()
    
    app_url = f"http://127.0.0.1:{server_port}/index.html"
    
    # Try using PyWebView for a native desktop application container
    launched = False
    global app_window
    try:
        import webview
        print("Launching PyWebView Window...")
        
        # Native Webview Configuration
        app_window = webview.create_window(
            title="NEET/JEE Computer-Based Test Simulator",
            url=app_url,
            js_api=DesktopAPI(),
            width=1366,
            height=768,
            resizable=True,
            min_size=(1024, 700)
        )
        
        # Start PyWebView loop
        webview.start()
        launched = True
    except Exception as e:
        print(f"PyWebView launch failed: {e}")
        print("Falling back to default browser...")
        
    if not launched:
        # Fallback to system default web browser (Chrome, Edge, etc.)
        # This guarantees the app ALWAYS works even if PyWebView dependencies fail to compile!
        webbrowser.open(app_url)
        print(f"Server is running. Open your browser to {app_url} if it didn't open automatically.")
        
        # Keep main thread alive
        try:
            import time
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("Shutting down...")

if __name__ == "__main__":
    main()
