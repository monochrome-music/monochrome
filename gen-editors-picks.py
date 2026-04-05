#!/usr/bin/env python3

import urllib.request
import urllib.parse
import json
import re
import sys
import hashlib
import time
import os
import subprocess
import shutil
import tempfile

INPUT_FILE = "editors-picks-input.txt"
IMAGES_DIR = "public/editors-picks-images"
COUNTRY = "US"

# Tidal internal token replace when expired
TIDAL_TOKEN = "eyJraWQiOiJ2OU1GbFhqWSIsImFsZyI6IkVTMjU2In0.eyJ0eXBlIjoibzJfYWNjZXNzIiwic2NvcGUiOiIiLCJnVmVyIjowLCJzVmVyIjowLCJjaWQiOjEzNTU3LCJhdCI6IklOVEVSTkFMIiwiZXhwIjoxNzc1MzY0MTQwLCJpc3MiOiJodHRwczovL2F1dGgudGlkYWwuY29tL3YxIn0.6ui6itHVQ-OXPF0F9mbf5KcKz1fKYJNsa1vBAj60upXpcN-DQG8JPKBlqJN6RuBEH8yhwYj2wh4YJ-TOOuO8DA"

TIDAL_HEADERS = {
    "accept": "*/*",
    "authorization": f"Bearer {TIDAL_TOKEN}",
}

# PodcastIndex credentials
PODCAST_API_KEY = "YU5HMSDYBQQVYDF6QN4P"
PODCAST_API_SECRET = "8hCvpjSL7T$S7^5ftnf5MhqQwYUYVjM^fmUL3Ld$"
PODCASTINDEX_BASE = "https://api.podcastindex.org/api/1.0"


# ── Tidal helpers ─────────────────────────────────────────────────────────────

def tidal_get(path, params=None):
    if params is None:
        params = {}
    params.setdefault("countryCode", COUNTRY)
    url = f"https://api.tidal.com/v1/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=TIDAL_HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        return None


def fetch_album(album_id):
    return tidal_get(f"albums/{album_id}")


def fetch_artist(artist_id):
    return tidal_get(f"artists/{artist_id}")


def fetch_track(track_id):
    return tidal_get(f"tracks/{track_id}")


def fetch_playlist(uuid):
    return tidal_get(f"playlists/{uuid}")


# ── PodcastIndex helper ───────────────────────────────────────────────────────

def podcast_get(endpoint):
    api_time = str(int(time.time()))
    raw = PODCAST_API_KEY + PODCAST_API_SECRET + api_time
    auth_hash = hashlib.sha1(raw.encode()).hexdigest()
    headers = {
        "User-Agent": "MonochromeMusic/1.0",
        "X-Auth-Key": PODCAST_API_KEY,
        "X-Auth-Date": api_time,
        "Authorization": auth_hash,
    }
    url = f"{PODCASTINDEX_BASE}{endpoint}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        return None


def fetch_podcast(feed_id):
    return podcast_get(f"/podcasts/byfeedid?id={feed_id}&pretty")


# ── Image processing ───────────────────────────────────────────────────────────

def clear_images_dir():
    if os.path.exists(IMAGES_DIR):
        shutil.rmtree(IMAGES_DIR)
    os.makedirs(IMAGES_DIR, exist_ok=True)


def is_uuid_cover(cover_value):
    if not cover_value:
        return False
    return bool(re.match(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', cover_value))


def uuid_to_path_segments(uuid):
    return uuid.replace('-', '/')


def download_and_process_cover(cover_uuid):
    url = f"https://resources.tidal.com/images/{uuid_to_path_segments(cover_uuid)}/640x640.jpg"
    
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp:
            with open(tmp_path, 'wb') as f:
                shutil.copyfileobj(resp, f)
        
        output_path = os.path.join(IMAGES_DIR, f"{cover_uuid}.webp")
        
        subprocess.run(
            ['cwebp', '-q', '50', '-resize', '500', '500', tmp_path, '-o', output_path],
            check=True,
            capture_output=True
        )
        
        return f"https://monochrome.tf/editors-picks-images/{cover_uuid}.webp"
    except Exception as e:
        print(f"Error processing cover {cover_uuid}: {e}", file=sys.stderr)
        return None
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def process_cover(cover_value):
    if not cover_value:
        return cover_value
    if is_uuid_cover(cover_value):
        return download_and_process_cover(cover_value)
    return cover_value


# ── Transformers ──────────────────────────────────────────────────────────────

def transform_album(d):
    return {
        "type": "album",
        "id": d.get("id"),
        "title": d.get("title"),
        "artist": {
            "id": d.get("artist", {}).get("id"),
            "name": d.get("artist", {}).get("name"),
        },
        "releaseDate": d.get("releaseDate"),
        "cover": process_cover(d.get("cover")),
        "explicit": d.get("explicit"),
        "audioQuality": d.get("audioQuality"),
        "mediaMetadata": d.get("mediaMetadata"),
    }


def transform_artist(d):
    return {
        "type": "artist",
        "id": d.get("id"),
        "name": d.get("name"),
        "picture": process_cover(d.get("picture")),
    }


def transform_track(d):
    album = d.get("album") or {}
    return {
        "type": "track",
        "id": d.get("id"),
        "title": d.get("title"),
        "artist": {
            "id": d.get("artist", {}).get("id"),
            "name": d.get("artist", {}).get("name"),
        },
        "album": {
            "id": album.get("id"),
            "title": album.get("title"),
            "cover": process_cover(album.get("cover")),
        },
        "duration": d.get("duration"),
        "explicit": d.get("explicit"),
        "audioQuality": d.get("audioQuality"),
        "mediaMetadata": d.get("mediaMetadata"),
    }


def transform_playlist(d):
    # Tidal editorial playlist → rendered as album card with playlist href
    cover = d.get("squareImage") or d.get("image") or d.get("cover")
    return {
        "type": "playlist",
        "id": d.get("uuid"),
        "title": d.get("title"),
        "cover": process_cover(cover),
        "numberOfTracks": d.get("numberOfTracks", 0),
    }


def transform_userplaylist(d):
    # User playlist → rendered with createUserPlaylistCardHTML
    cover = d.get("squareImage") or d.get("image") or d.get("cover")
    creator = d.get("creator") or {}
    return {
        "type": "user-playlist",
        "id": d.get("uuid"),
        "name": d.get("title"),
        "cover": process_cover(cover),
        "numberOfTracks": d.get("numberOfTracks", 0),
        "username": creator.get("name"),
    }


def transform_podcast(d):
    feed = d.get("feed") or {}
    return {
        "type": "podcast",
        "id": str(feed.get("id", "")),
        "title": feed.get("title"),
        "author": feed.get("author") or feed.get("ownerName"),
        "image": feed.get("image") or feed.get("artwork"),
        "episodeCount": feed.get("episodeCount", 0),
    }


# ── Input parser ──────────────────────────────────────────────────────────────

def read_items(path):
    """
    Parses editors-picks-input.txt.
    Each non-comment line is either:
      - a bare number → album:<number>  (backwards-compatible)
      - type:value   → e.g. artist:123, track:456, playlist:uuid, podcast:789
    Supported types: album, artist, track, playlist, userplaylist, podcast
    """
    items = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if ":" in line:
                item_type, _, value = line.partition(":")
                items.append((item_type.strip().lower(), value.strip()))
            else:
                # bare number → album
                items.append(("album", line))
    return items


# ── Main ──────────────────────────────────────────────────────────────────────

clear_images_dir()

FETCHERS = {
    "album":       (fetch_album,       transform_album),
    "artist":      (fetch_artist,      transform_artist),
    "track":       (fetch_track,       transform_track),
    "playlist":    (fetch_playlist,    transform_playlist),
    "userplaylist":(fetch_playlist,    transform_userplaylist),
    "podcast":     (fetch_podcast,     transform_podcast),
}

items = read_items(INPUT_FILE)
picks = []

for item_type, item_id in items:
    if item_type not in FETCHERS:
        print(f"Unknown type '{item_type}' for id {item_id!r} - skipping", file=sys.stderr)
        continue
    fetch_fn, transform_fn = FETCHERS[item_type]
    data = fetch_fn(item_id)
    if data:
        picks.append(transform_fn(data))

with open("public/editors-picks.json", "w") as f:
    json.dump(picks, f, indent=4)

print(f"Written {len(picks)} items to public/editors-picks.json")
