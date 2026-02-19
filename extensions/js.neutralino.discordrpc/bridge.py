# bridge.py - Production Discord RPC Bridge (Linux/macOS)
import sys, json, socket, struct, os, uuid, base64, time

CLIENT_ID = "1462186088184549661"
LAST_STATUS = ""

def get_discord_path():
    for i in range(10):
        path = os.path.join(os.environ.get('XDG_RUNTIME_DIR', '/tmp'), f'discord-ipc-{i}')
        if os.path.exists(path): return path
    return None

def send_packet(s, op, data):
    payload = json.dumps(data).encode('utf-8')
    header = struct.pack('<II', op, len(payload))
    s.sendall(header + payload)

def recv_packet(s):
    try:
        header = s.recv(8)
        if len(header) < 8: return None
        op, length = struct.unpack('<II', header)
        payload = s.recv(length)
        return json.loads(payload.decode('utf-8'))
    except Exception:
        # Ignore errors and return None
        return None

def set_activity(ds, pid, details, state, img=None, start=None, end=None, large_text=None, small_img=None, small_txt=None):
    global LAST_STATUS
    current = f"{details}-{state}-{img}-{start}-{end}-{large_text}-{small_img}-{small_txt}"
    if current == LAST_STATUS: return
    LAST_STATUS = current

    activity = {
        "details": str(details or "Idling"),
        "state": str(state or "Monochrome"),
        "type": 2, # Listening
        "assets": {
            "large_image": img if img and img.startswith('http') else "monochrome",
            "large_text": str(large_text or "Monochrome")
        }
    }

    if small_img:
        activity["assets"]["small_image"] = str(small_img)
        activity["assets"]["small_text"] = str(small_txt or "")
    
    if start or end:
        activity["timestamps"] = {}
        if start: activity["timestamps"]["start"] = int(start)
        if end: activity["timestamps"]["end"] = int(end)
    
    send_packet(ds, 1, {
        "cmd": "SET_ACTIVITY",
        "args": {"pid": pid, "activity": activity},
        "nonce": str(uuid.uuid4())
    })

def main():
    # 1. Read config
    try:
        line = sys.stdin.readline()
        if not line: return
        config = json.loads(line)
    except Exception:
        # Ignore errors and exit
        return

    ppid = os.getppid()

    # 2. Connect to Discord
    ipc_path = get_discord_path()
    if not ipc_path: return
    try:
        ds = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        ds.connect(ipc_path)
    except Exception:
        # Ignore connection errors and exit
        return

    # 3. Handshake
    send_packet(ds, 0, {"v": 1, "client_id": CLIENT_ID})
    recv_packet(ds) # Mandatory read
    
    time.sleep(0.5)
    set_activity(ds, ppid, "Idling", "Monochrome")

    # 4. Minimal WebSocket Client
    ws = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ws.settimeout(1.0)
    try:
        ws.connect(('127.0.0.1', int(config['nlPort'])))
    except Exception:
        # Ignore connection errors and exit
        return
    
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET /?extensionId={config['nlExtensionId']}&connectToken={config['nlConnectToken']} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{config['nlPort']}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    ws.sendall(handshake.encode())
    
    # Skip HTTP response header
    resp = b""
    while b"\r\n\r\n" not in resp:
        try:
            chunk = ws.recv(1024)
            if not chunk: break
            resp += chunk
        except socket.timeout: continue

    # 5. Loop
    while True:
        # Watchdog
        try:
            os.kill(ppid, 0)
        except OSError: break

        try:
            head = ws.recv(2)
            if not head: break
            length = head[1] & 127
            if length == 126: length = struct.unpack(">H", ws.recv(2))[0]
            elif length == 127: length = struct.unpack(">Q", ws.recv(8))[0]
            
            data = b""
            while len(data) < length:
                data += ws.recv(length - len(data))
                
            msg = json.loads(data.decode('utf-8'))
            if msg['event'] == 'discord:update':
                d = msg['data']
                set_activity(ds, ppid, d.get('details'), d.get('state'), d.get('largeImageKey'), d.get('startTimestamp'), d.get('endTimestamp'), d.get('largeImageText'), d.get('smallImageKey'), d.get('smallImageText'))
            elif msg['event'] == 'discord:clear':
                set_activity(ds, ppid, "Idling", "Monochrome")
            elif msg['event'] == 'windowClose':
                break
        except socket.timeout:
            # Timeout is expected, continue polling
            continue
        except Exception:
            # Ignore other errors and continue
            continue

    # Cleanup
    try:
        send_packet(ds, 1, {
            "cmd": "SET_ACTIVITY",
            "args": {"pid": ppid, "activity": None},
            "nonce": str(uuid.uuid4())
        })
        time.sleep(0.1)
        ds.close()
    except Exception:
        # Ignore cleanup errors
        pass

if __name__ == "__main__":
    main()
