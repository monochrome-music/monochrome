#!/usr/bin/env python3

import urllib.request
import urllib.parse
import json
import re
import sys
import hashlib
import time
import os
import tempfile
import base64

INPUT_FILE = "editors-picks-input.txt"
COUNTRY = "US"

TIDAL_CLIENT_ID = "txNoH4kkV41MfH25"
TIDAL_CLIENT_SECRET = "dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98="

_tidal_token = None


def get_tidal_token():
    global _tidal_token
    if _tidal_token:
        return _tidal_token

    credentials = base64.b64encode(f"{TIDAL_CLIENT_ID}:{TIDAL_CLIENT_SECRET}".encode()).decode()
    params = urllib.parse.urlencode({
        "client_id": TIDAL_CLIENT_ID,
        "client_secret": TIDAL_CLIENT_SECRET,
        "grant_type": "client_credentials",
    })
    req = urllib.request.Request(
        "https://auth.tidal.com/v1/oauth2/token",
        data=params.encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {credentials}",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            _tidal_token = data["access_token"]
            return _tidal_token
    except Exception as e:
        print(f"Error getting Tidal token: {e}", file=sys.stderr)
        return None


def tidal_get(path, params=None):
    if params is None:
        params = {}
    params.setdefault("countryCode", COUNTRY)

    token = get_tidal_token()
    if not token:
        return None

    url = f"https://api.tidal.com/v1/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
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
        "cover": d.get("cover"),
        "explicit": d.get("explicit"),
        "audioQuality": d.get("audioQuality"),
        "mediaMetadata": d.get("mediaMetadata"),
    }


def transform_artist(d):
    return {
        "type": "artist",
        "id": d.get("id"),
        "name": d.get("name"),
        "picture": d.get("picture"),
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
            "cover": album.get("cover"),
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
        "cover": cover,
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
        "cover": cover,
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
