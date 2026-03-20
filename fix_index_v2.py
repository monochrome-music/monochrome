import re
import os

def fix_index():
    file_path = "index.html"
    if not os.path.isabs(file_path):
        file_path = os.path.join(r"c:\Users\nolan\Documents\Workspace\Github\monochrome", file_path)

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # The exact block from previous view_file
    pattern = r'(JSPF \(JSON Shareable Playlist Format\) is supported by)\s+(const replayGainPreamp = document\.getElementById\(\'replay-gain-preamp\'\);.*?player\.applyReplayGain\(\);.*?})\s+(Import playlists with rich metadata including MusicBrainz identifiers\.)'
    
    # Matching the actual structure:
    # <p ...>
    # JSPF... const...
    # if...
    # ...
    # }... Import...
    # </p>
    
    found = False
    
    # Try more literal matching if regex fails
    if "const replayGainPreamp = document.getElementById('replay-gain-preamp');" in content:
        print("Found the bug by literal check")
        found = True

    # Attempt to replace
    # We want to keep the text, then a script, then more text.
    # The current state is text containing code.
    
    def repl_func(match):
        prefix = match.group(1)
        code = match.group(2)
        suffix = match.group(3)
        return prefix + " many media players. " + suffix + "\n                        </p>\n                        <script>\n                            " + code + "\n                        </script>\n                        <p style=\"display:none\">"

    new_content = re.sub(pattern, repl_func, content, flags=re.DOTALL)

    if new_content == content:
        print("COULD NOT FIND JSPF BUG WITH REGEX, checking for alternative patterns...")
        # Simpler regex for the start and end
        pattern2 = r'JSPF \(JSON Shareable Playlist Format\) is supported by.*?const replayGainPreamp.*?player\.applyReplayGain\(\);.*?}.*?Import playlists with'
        
        # Replacement with correct script
        replacement = """JSPF (JSON Shareable Playlist Format) is supported by many media players. Import playlists with rich metadata including MusicBrainz identifiers.
                        </p>
                        <script>
                            const replayGainPreamp = document.getElementById('replay-gain-preamp');
                            if (replayGainPreamp) {
                                replayGainPreamp.value = replayGainSettings.getPreamp();
                                replayGainPreamp.addEventListener('change', (e) => {
                                    const val = parseFloat(e.target.value);
                                    replayGainSettings.setPreamp(isNaN(val) ? 3 : val);
                                    player.applyReplayGain();
                                });
                            }
                        </script>
                        <p style="display:none">"""
        
        new_content2 = re.sub(pattern2, replacement, content, flags=re.DOTALL)
        if new_content2 != content:
            print("Fixed with pattern2")
            content = new_content2
        else:
            print("Manual fix failed as well. Check exact characters.")
    else:
        print("Fixed with main pattern")
        content = new_content

    # Scan for other anomalies
    content_no_script = re.sub(r'<script.*?>.*?</script>', '', content, flags=re.DOTALL)
    content_no_style = re.sub(r'<style.*?>.*?</style>', '', content_no_script, flags=re.DOTALL)
    text_content = re.sub(r'<[^>]+>', '', content_no_style, flags=re.DOTALL)

    anomalies = []
    # Narrow down the keywords to be more specific JS syntax
    for keyword in ["const ", "let ", "var ", ".addEventListener(", "document.getElementById"]:
        for match in re.finditer(re.escape(keyword), text_content):
            start = max(0, match.start() - 50)
            end = min(len(text_content), match.end() + 50)
            snippet = text_content[start:end].replace('\n', ' ')
            anomalies.append(f"Keyword '{keyword}' found at pos {match.start()}: ...{snippet}...")

    if anomalies:
        print("Potential anomalies found:")
        for a in anomalies:
            print(a)
    else:
        print("No other anomalies found")

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

    print("Done fixing index.html!")

if __name__ == "__main__":
    fix_index()
