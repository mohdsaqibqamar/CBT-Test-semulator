import os
import fitz  # PyMuPDF
from PIL import Image
def convert_pdf_to_images(pdf_path, output_dir, dpi=150):
    """
    Converts all pages of a PDF to high-resolution PNG images.
    Returns a list of dictionaries with page number, image path, width, and height.
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found at {pdf_path}")
    
    os.makedirs(output_dir, exist_ok=True)
    
    doc = fitz.open(pdf_path)
    pages_meta = []
    
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        
        # Render page to a pixmap (image)
        pix = page.get_pixmap(dpi=dpi)
        
        page_filename = f"page_{page_num + 1}.png"
        page_filepath = os.path.join(output_dir, page_filename)
        
        # Save image
        pix.save(page_filepath)
        
        # Get width and height
        width, height = pix.width, pix.height
        
        pages_meta.append({
            "page_number": page_num + 1,
            "image_path": page_filepath,
            "width": width,
            "height": height
        })
        
    doc.close()
    return pages_meta

def crop_question_image(page_image_path, crop_box, output_path):
    """
    Crops a question from a page image using percentage-based coordinates.
    crop_box: dict containing 'x', 'y', 'width', 'height' as percentage values (0-100)
    """
    if not os.path.exists(page_image_path):
        raise FileNotFoundError(f"Page image not found at {page_image_path}")
    
    # Ensure target directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with Image.open(page_image_path) as img:
        img_width, img_height = img.size
        
        # Convert percentages (0-100) to actual pixel coordinates
        left = int((crop_box['x'] / 100.0) * img_width)
        top = int((crop_box['y'] / 100.0) * img_height)
        width = int((crop_box['width'] / 100.0) * img_width)
        height = int((crop_box['height'] / 100.0) * img_height)
        
        # Boundary validation
        right = min(left + width, img_width)
        bottom = min(top + height, img_height)
        left = max(0, left)
        top = max(0, top)
        
        if right <= left or bottom <= top:
            raise ValueError("Invalid crop box coordinates")
            
        cropped_img = img.crop((left, top, right, bottom))
        
        # Save cropped question image
        cropped_img.save(output_path, "PNG")
        
    return output_path

def detect_questions_on_page(page_image_path):
    """
    Returns a single bounding box covering the entire page (with a tiny 1% margin).
    This allows the user to easily select a full-page question block.
    """
    if not os.path.exists(page_image_path):
        raise FileNotFoundError(f"Page image not found at {page_image_path}")
        
    # Return one large box covering almost the entire page
    return [{
        "x": 1.0,
        "y": 1.0,
        "width": 98.0,
        "height": 98.0
    }]
