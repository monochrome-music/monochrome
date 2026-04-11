import re
with open("gen-editors-picks.py", "r") as f: content = f.read()

content = re.sub(r"IMAGES_DIR = \"public/editors-picks-images\"\n+", "", content)

# Remove clear_images_dir definition
content = re.sub(r"def clear_images_dir\(\):[\s\S]*?os\.makedirs[^\n]*\n+", "", content)
content = re.sub(r"clear_images_dir\(\)\n+", "", content)

# Remove the import line for subprocess, shutil if present
content = re.sub(r"import subprocess\n", "", content)
content = re.sub(r"import shutil\n", "", content)

# Replace download_and_process_cover
new_func = """def download_and_process_cover(cover_uuid):
    url = f"https://resources.tidal.com/images/{uuid_to_path_segments(cover_uuid)}/320x320.jpg"
    return f"https://wsrv.nl/?url={url}&w=250&h=250&output=webp"
"""
content = re.sub(r"def download_and_process_cover\(cover_uuid\):[\s\S]*?(?=def process_cover)", new_func + "\n\n", content)

with open("gen-editors-picks.py", "w") as f: f.write(content)
