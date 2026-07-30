#!/usr/bin/env python3
"""
Detect Chinese text regions in a video frame using Tesseract OCR.

Usage:
    python3 detect_text.py <image_path> [--lang chi_sim] [--padding 20] [--min-conf 30]

Outputs JSON array of detected text regions:
    [{"x": 232, "y": 615, "width": 113, "height": 34, "text": "炼化妖骨有风险", "confidence": 91}, ...]

The regions are padded by --padding pixels on each side to ensure the
blur filter covers the full text including outline/shadow.
"""
import sys
import os
import json
import argparse

def main():
    parser = argparse.ArgumentParser(description='Detect Chinese text in a video frame')
    parser.add_argument('image_path', help='Path to the image frame')
    parser.add_argument('--lang', default='chi_sim', help='Tesseract language (default: chi_sim)')
    parser.add_argument('--padding', type=int, default=20, help='Padding around text in pixels (default: 20)')
    parser.add_argument('--min-conf', type=int, default=30, help='Minimum confidence threshold (default: 30)')
    parser.add_argument('--tessdata-prefix', default=None, help='Path to tessdata directory')
    parser.add_argument('--upscale', type=int, default=2, help='Upscale factor before OCR (default: 2, set to 1 to disable). Chinese text in low-res videos (576px) needs at least 2x upscaling for tesseract to detect reliably.')
    args = parser.parse_args()

    if args.tessdata_prefix:
        os.environ['TESSDATA_PREFIX'] = args.tessdata_prefix

    try:
        from PIL import Image
        import pytesseract
    except ImportError as e:
        print(json.dumps({"error": f"Missing dependency: {e}. Install with: pip install Pillow pytesseract"}))
        sys.exit(1)

    try:
        img = Image.open(args.image_path)
    except Exception as e:
        print(json.dumps({"error": f"Cannot open image: {e}"}))
        sys.exit(1)

    img_w, img_h = img.size

    # Upscale the image before OCR to improve detection of small Chinese text.
    # Tesseract struggles with Chinese characters below ~20px tall, which is
    # common in 576p/720p videos. Upscaling 2x makes the text ~40px, which
    # is reliably detected.
    if args.upscale > 1:
        img = img.resize((img_w * args.upscale, img_h * args.upscale), Image.LANCZOS)

    try:
        data = pytesseract.image_to_data(img, lang=args.lang, output_type=pytesseract.Output.DICT)
    except Exception as e:
        print(json.dumps({"error": f"OCR failed: {e}. Make sure tesseract and language data are installed."}))
        sys.exit(1)

    # Group nearby text boxes into clusters to avoid overlapping blur regions
    raw_boxes = []
    for i in range(len(data['text'])):
        conf = int(data['conf'][i]) if str(data['conf'][i]).lstrip('-').isdigit() else 0
        text = data['text'][i].strip()
        if conf >= args.min_conf and text:
            x = int(data['left'][i])
            y = int(data['top'][i])
            w = int(data['width'][i])
            h = int(data['height'][i])
            raw_boxes.append({
                'x': x, 'y': y, 'width': w, 'height': h,
                'text': text, 'confidence': conf
            })

    if not raw_boxes:
        print(json.dumps([]))
        return

    # Merge overlapping/nearby boxes (within 80px of each other)
    merged = []
    for box in raw_boxes:
        bx1, by1 = box['x'], box['y']
        bx2, by2 = box['x'] + box['width'], box['y'] + box['height']
        merged_box = None
        for existing in merged:
            ex1, ey1 = existing['x'], existing['y']
            ex2, ey2 = existing['x'] + existing['width'], existing['y'] + existing['height']
            # Check if boxes overlap or are very close (within 80px)
            if not (bx2 + 80 < ex1 or bx1 > ex2 + 80 or by2 + 80 < ey1 or by1 > ey2 + 80):
                # Merge
                nx1 = min(bx1, ex1)
                ny1 = min(by1, ey1)
                nx2 = max(bx2, ex2)
                ny2 = max(by2, ey2)
                existing['x'] = nx1
                existing['y'] = ny1
                existing['width'] = nx2 - nx1
                existing['height'] = ny2 - ny1
                existing['text'] = existing['text'] + box['text']
                existing['confidence'] = max(existing['confidence'], box['confidence'])
                merged_box = existing
                break
        if not merged_box:
            merged.append(dict(box))

    # Add padding and clamp to image bounds.
    # IMPORTANT: if we upscaled, scale coordinates back to original image size.
    result = []
    scale = 1.0 / args.upscale if args.upscale > 1 else 1.0
    for box in merged:
        # Scale back to original coordinates
        orig_x = int(box['x'] * scale)
        orig_y = int(box['y'] * scale)
        orig_w = int(box['width'] * scale)
        orig_h = int(box['height'] * scale)
        # Add padding (in original-scale pixels)
        px = max(0, orig_x - args.padding)
        py = max(0, orig_y - args.padding)
        px2 = min(img_w, orig_x + orig_w + args.padding)
        py2 = min(img_h, orig_y + orig_h + args.padding)
        result.append({
            'x': px,
            'y': py,
            'width': px2 - px,
            'height': py2 - py,
            'text': box['text'],
            'confidence': box['confidence']
        })

    print(json.dumps(result))

if __name__ == '__main__':
    main()
