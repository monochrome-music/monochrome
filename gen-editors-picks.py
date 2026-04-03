#!/usr/bin/env python3

import urllib.request
import json
import re
import sys

INPUT_FILE = "editors-picks-input.txt"

TOKEN = "eyJraWQiOiJ2OU1GbFhqWSIsImFsZyI6IkVTMjU2In0.eyJ0eXBlIjoibzJfYWNjZXNzIiwic2NvcGUiOiIiLCJnVmVyIjowLCJzVmVyIjowLCJjaWQiOjEzNTU3LCJhdCI6IklOVEVSTkFMIiwiZXhwIjoxNzc1MTI4ODUzLCJpc3MiOiJodHRwczovL2F1dGgudGlkYWwuY29tL3YxIn0.qRoN8BRLM3R5WAXM3kS2hkWyaGk5tWF0FaHWJmkrWNvI48hKyS9lhVOTSnP1XkFEfdXv6aTzGUNUewyp-O_d3w"

HEADERS = {
    "accept": "*/*",
    "authorization": f"Bearer {TOKEN}",
}

def read_album_ids(path):
    ids = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                ids.append(int(line))
            except ValueError:
                print(f"Skipping invalid ID: {line!r}", file=sys.stderr)
    return ids

def fetch_album(album_id):
    url = f"https://api.tidal.com/v1/albums/{album_id}?countryCode=US"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"Error fetching {album_id}: {e}", file=sys.stderr)
        return None

def transform_album(api_data):
    return {
        "type": "album",
        "id": api_data.get("id"),
        "title": api_data.get("title"),
        "artist": {
            "id": api_data.get("artist", {}).get("id"),
            "name": api_data.get("artist", {}).get("name"),
        },
        "releaseDate": api_data.get("releaseDate"),
        "cover": api_data.get("cover"),
        "explicit": api_data.get("explicit"),
        "audioQuality": api_data.get("audioQuality"),
        "mediaMetadata": api_data.get("mediaMetadata"),
    }

albums = read_album_ids(INPUT_FILE)

picks = []
for album_id in albums:
    data = fetch_album(album_id)
    if data:
        picks.append(transform_album(data))

with open("public/editors-picks.json", "w") as f:
    json.dump(picks, f, indent=4)

print(f"Written {len(picks)} albums to public/editors-picks.json")
