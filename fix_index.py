import codecs
import re

with codecs.open("index.html", "r", "utf-16") as f:
    content = f.read()

# Fix the JSPF panel script
original_bug =  "JSPF (JSON Shareable Playlist Format) is supported by     const replayGainPreamp = document.getElementById('replay-gain-preamp');\r\n    if (replayGainPreamp) {\r\n        replayGainPreamp.value = replayGainSettings.getPreamp();\r\n        replayGainPreamp.addEventListener('change', (e) => {\r\n            const val = parseFloat(e.target.value);\r\n            replayGainSettings.setPreamp(isNaN(val) ? 3 : val);\r\n            player.applyReplayGain();\r\n        });\r\n    }                Import playlists with rich metadata including MusicBrainz identifiers."

original_bug_unix = original_bug.replace("\r\n", "\n")

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

if original_bug in content:
    content = content.replace(original_bug, replacement)
elif original_bug_unix in content:
    content = content.replace(original_bug_unix, replacement.replace('\r\n', '\n'))
else:
    print("BUG NOT FOUND")

# Check for other unescaped scripts
# A simple regex to find "const", "let", "var" outside `<script>` or other tags
content_no_script = re.sub(r'<script.*?>.*?</script>', '', content, flags=re.DOTALL)
content_no_style = re.sub(r'<style.*?>.*?</style>', '', content_no_script, flags=re.DOTALL)

# Remove all HTML tags to see what literal text is left
text_content = re.sub(r'<[^>]+>', '', content_no_style, flags=re.DOTALL)

# Find remaining JS keywords
anomalies = []
for keyword in ["const ", "let ", "var ", "=>", "function()"]:
    if keyword in text_content:
        anomalies.append(keyword)
if anomalies:
    print("Found potential anomalies:", anomalies)
else:
    print("No other anomalies found")

with codecs.open("index.html", "w", "utf-16") as f:
    f.write(content)

print("Done fixing JSPF!")
