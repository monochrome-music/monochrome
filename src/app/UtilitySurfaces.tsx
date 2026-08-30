interface ContextAction {
    action?: string;
    label?: string;
    typeFilter?: string;
    className?: string;
    labels?: Record<string, string>;
}

const contextActions: ContextAction[] = [
    { action: 'shuffle-play-card', label: 'Shuffle play', typeFilter: 'album,playlist,mix,user-playlist' },
    { action: 'start-infinite-radio', label: 'Start Infinite Radio', typeFilter: 'track,album,playlist,user-playlist' },
    { action: 'start-mix', label: 'Start mix', typeFilter: 'album,track,video' },
    { action: 'play-next', label: 'Play next' },
    { action: 'add-to-queue', label: 'Add to queue' },
    {
        action: 'toggle-like',
        label: 'Like',
        typeFilter: 'album,artist,playlist,mix,user-playlist',
        labels: {
            'data-label-album': 'Save album to library',
            'data-label-unlike-album': 'Remove album from library',
            'data-label-playlist': 'Save playlist to library',
            'data-label-unlike-playlist': 'Remove playlist from library',
        },
    },
    { action: 'toggle-pin', label: 'Pin', typeFilter: 'album,artist,playlist,user-playlist' },
    { action: 'add-to-playlist', label: 'Add to playlist', typeFilter: 'track,video' },
    { action: 'request-song', label: 'Request song', typeFilter: 'track,video' },
    { action: 'go-to-artist', label: 'Go to artist', typeFilter: 'track,album,video' },
    { action: 'go-to-album', label: 'Go to album', typeFilter: 'track,video' },
    { action: 'copy-link', label: 'Copy link' },
    { action: 'open-in-new-tab', label: 'Open in new tab' },
    { action: 'open-in-harmony', label: 'Open in Harmony', typeFilter: 'album' },
    { action: 'track-info', label: 'Track info', typeFilter: 'track,video' },
    { action: 'open-original-url', label: 'Open original URL', typeFilter: 'track,video' },
    { action: 'download', label: 'Download' },
    { className: 'separator' },
    {
        action: 'block-track',
        label: 'Block track',
        typeFilter: 'track',
        labels: { 'data-label-block': 'Block track', 'data-label-unblock': 'Unblock track' },
    },
    {
        action: 'block-album',
        label: 'Block album',
        typeFilter: 'album,track',
        labels: { 'data-label-block': 'Block album', 'data-label-unblock': 'Unblock album' },
    },
    {
        action: 'block-artist',
        label: 'Block artist',
        typeFilter: 'track,album,artist',
        labels: { 'data-label-block': 'Block artist', 'data-label-unblock': 'Unblock artist' },
    },
];

export function ContextMenu() {
    return (
        <ul aria-label="Music actions" role="menu">
            {contextActions.map((item, index) => (
                <li
                    className={item.className}
                    data-action={item.action}
                    data-type-filter={item.typeFilter}
                    key={item.action || `separator-${index}`}
                    role={item.className === 'separator' ? 'separator' : 'menuitem'}
                    {...item.labels}
                >
                    {item.label}
                </li>
            ))}
        </ul>
    );
}

export function SortMenu() {
    return (
        <ul aria-label="Sort playlist" role="menu">
            <li data-sort="custom" role="menuitem">
                Playlist order
            </li>
            <li className="requires-added-date" data-sort="added-newest" role="menuitem">
                Date added — newest
            </li>
            <li className="requires-added-date" data-sort="added-oldest" role="menuitem">
                Date added — oldest
            </li>
            <li data-sort="title" role="menuitem">
                Title — A–Z
            </li>
            <li data-sort="artist" role="menuitem">
                Artist — A–Z
            </li>
            <li data-sort="album" role="menuitem">
                Album — A–Z
            </li>
        </ul>
    );
}

export function ExportMenu() {
    return (
        <ul aria-label="Export playlist" role="menu">
            <li data-export-format="csv" role="menuitem">
                Export as CSV
            </li>
            <li data-export-format="json" role="menuitem">
                Export as JSON
            </li>
        </ul>
    );
}

export function EqualizerNodeMenu() {
    return (
        <ul aria-label="Equalizer node" role="menu">
            <li className="eq-ctx-channel" data-action="eq-channel-stereo" role="menuitem">
                Stereo
            </li>
            <li className="eq-ctx-channel" data-action="eq-channel-mid" role="menuitem">
                Mid
            </li>
            <li className="eq-ctx-channel" data-action="eq-channel-side" role="menuitem">
                Side
            </li>
            <li className="separator" role="separator" />
            <li className="eq-ctx-type" data-action="eq-type-lowshelf" role="menuitem">
                Low shelf
            </li>
            <li className="eq-ctx-type" data-action="eq-type-peaking" role="menuitem">
                Peaking
            </li>
            <li className="eq-ctx-type" data-action="eq-type-highshelf" role="menuitem">
                High shelf
            </li>
        </ul>
    );
}

export function EqualizerEmptyMenu() {
    return (
        <ul aria-label="Equalizer" role="menu">
            <li data-action="eq-add-node" role="menuitem">
                Add node
            </li>
        </ul>
    );
}

export function SidePanel() {
    return (
        <>
            <div aria-hidden="true" className="side-panel-resizer" id="side-panel-resizer" />
            <div className="panel-header">
                <h2 id="side-panel-title">Panel</h2>
                <div className="panel-controls" id="side-panel-controls" />
            </div>
            <div className="panel-content" id="side-panel-content" />
        </>
    );
}
