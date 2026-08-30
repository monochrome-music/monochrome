import type { ComponentChildren } from 'preact';
import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';

const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function ActionButton({
    children,
    className = 'btn-primary',
    icon,
    id,
    title,
    hidden = false,
    ...props
}: {
    children?: ComponentChildren;
    className?: string;
    icon?: string;
    id: string;
    title: string;
    hidden?: boolean;
    [key: `data-${string}`]: string | undefined;
}) {
    return (
        <button
            className={className}
            id={id}
            style={hidden ? { display: 'none' } : undefined}
            title={title}
            type="button"
            {...props}
        >
            {icon ? <Icon svg={icon} size={18} /> : null}
            {children ? <span>{children}</span> : null}
        </button>
    );
}

function DetailImage({ id, alt = '' }: { id: string; alt?: string }) {
    return (
        <img
            alt={alt}
            className="detail-header-image"
            crossOrigin="anonymous"
            id={id}
            referrerPolicy="no-referrer"
            src={transparentPixel}
        />
    );
}

export function AlbumPage() {
    return (
        <>
            <header className="detail-header">
                <DetailImage id="album-detail-image" />
                <div className="detail-header-info">
                    <h1 className="title" id="album-detail-title" />
                    <div className="meta" id="album-detail-meta" />
                    <div className="meta" id="album-detail-producer" />
                    <div className="detail-ratings">
                        <div className="ratings" id="album-detail-ratings-critics" />
                        <div className="ratings" id="album-detail-ratings-users" />
                    </div>
                    <div className="detail-header-actions">
                        <ActionButton icon={icons.play} id="play-album-btn" title="Play album">
                            Play album
                        </ActionButton>
                        <ActionButton icon={icons.shuffle} id="shuffle-album-btn" title="Shuffle">
                            Shuffle
                        </ActionButton>
                        <ActionButton hidden icon={icons.mix} id="album-mix-btn" title="Mix">
                            Mix
                        </ActionButton>
                        <ActionButton icon={icons.download} id="download-album-btn" title="Download">
                            Download
                        </ActionButton>
                        <ActionButton
                            className="btn-secondary"
                            icon={icons.plus}
                            id="add-album-to-playlist-btn"
                            title="Add to playlist"
                        >
                            Add to playlist
                        </ActionButton>
                        <ActionButton
                            className="btn-secondary like-btn"
                            data-action="toggle-like"
                            data-type="album"
                            icon={icons.heart}
                            id="like-album-btn"
                            title="Save to favorites"
                        >
                            Save
                        </ActionButton>
                        <ActionButton
                            className="btn-secondary"
                            data-action="card-menu"
                            data-type="album"
                            icon={icons.moreVertical}
                            id="album-menu-btn"
                            title="More options"
                        />
                    </div>
                </div>
            </header>
            <div className="album-content-layout">
                <div className="track-list" id="album-detail-tracklist" />
                <RelatedSection
                    id="album-section-more-albums"
                    titleId="album-title-more-albums"
                    title="From artist"
                    target="album-detail-more-albums"
                />
                <RelatedSection
                    id="album-section-eps"
                    titleId="album-title-eps"
                    title="EPs and singles"
                    target="album-detail-eps"
                />
                <RelatedSection
                    id="album-section-similar-artists"
                    title="Similar artists"
                    target="album-detail-similar-artists"
                />
                <RelatedSection
                    id="album-section-similar-albums"
                    title="Similar albums"
                    target="album-detail-similar-albums"
                />
            </div>
        </>
    );
}

function RelatedSection({
    id,
    title,
    titleId,
    target,
}: {
    id: string;
    title: string;
    titleId?: string;
    target: string;
}) {
    return (
        <section className="content-section related-section" id={id} style={{ display: 'none' }}>
            <h2 className="section-title" id={titleId}>
                {title}
            </h2>
            <div className="card-grid" id={target} />
        </section>
    );
}

export function PlaylistPage() {
    return (
        <>
            <header className="detail-header">
                <div className="detail-header-cover-container">
                    <DetailImage alt="Playlist cover" id="playlist-detail-image" />
                    <div className="detail-header-collage" id="playlist-detail-collage" style={{ display: 'none' }} />
                </div>
                <div className="detail-header-info">
                    <h1 className="title" id="playlist-detail-title" />
                    <div className="meta" id="playlist-detail-meta" />
                    <div className="meta detail-description" id="playlist-detail-description" />
                    <div className="detail-header-actions">
                        <ActionButton icon={icons.play} id="play-playlist-btn" title="Play">
                            Play
                        </ActionButton>
                        <ActionButton icon={icons.shuffle} id="shuffle-playlist-btn" title="Shuffle">
                            Shuffle
                        </ActionButton>
                        <ActionButton icon={icons.download} id="download-playlist-btn" title="Download">
                            Download
                        </ActionButton>
                        <ActionButton
                            className="btn-secondary like-btn"
                            data-action="toggle-like"
                            data-type="playlist"
                            icon={icons.heart}
                            id="like-playlist-btn"
                            title="Save to favorites"
                        >
                            Save
                        </ActionButton>
                    </div>
                </div>
            </header>
            <form className="track-list-search-container" onSubmit={(event) => event.preventDefault()} role="search">
                <Icon className="search-icon" svg={icons.search} />
                <label className="sr-only" htmlFor="track-list-search-input">
                    Search playlist tracks
                </label>
                <input
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    className="track-list-search-input"
                    id="track-list-search-input"
                    placeholder="Search tracks"
                    spellcheck={false}
                    type="search"
                />
                <button
                    aria-label="Clear search"
                    className="search-clear-btn btn-icon"
                    style={{ display: 'none' }}
                    title="Clear search"
                    type="button"
                >
                    ×
                </button>
            </form>
            <div className="track-list" id="playlist-detail-tracklist" />
            <section
                className="content-section related-section"
                id="playlist-section-recommended"
                style={{ display: 'none' }}
            >
                <div className="section-header-row">
                    <div>
                        <h2 className="section-title">Recommended songs</h2>
                        <p className="section-description">Suggestions based on this playlist</p>
                    </div>
                    <ActionButton
                        className="btn-secondary home-section-action"
                        icon={icons.rotateCw}
                        id="refresh-recommended-songs-btn"
                        title="Refresh recommendations"
                    />
                </div>
                <div className="track-list" id="playlist-detail-recommended" />
            </section>
        </>
    );
}

export function FolderPage() {
    return (
        <>
            <header className="detail-header">
                <DetailImage alt="Folder cover" id="folder-detail-image" />
                <div className="detail-header-info">
                    <h1 className="title" id="folder-detail-title" />
                    <div className="meta" id="folder-detail-meta" />
                    <div className="detail-header-actions">
                        <ActionButton className="btn-secondary danger" id="delete-folder-btn" title="Delete folder">
                            Delete folder
                        </ActionButton>
                    </div>
                </div>
            </header>
            <div className="card-grid" id="folder-detail-container" />
        </>
    );
}

export function MixPage() {
    return (
        <>
            <header className="detail-header">
                <DetailImage alt="Mix cover" id="mix-detail-image" />
                <div className="detail-header-info">
                    <h1 className="title" id="mix-detail-title" />
                    <div className="meta" id="mix-detail-meta" />
                    <div className="meta detail-description" id="mix-detail-description" />
                    <div className="detail-header-actions">
                        <ActionButton icon={icons.play} id="play-mix-btn" title="Play">
                            Play
                        </ActionButton>
                        <ActionButton icon={icons.download} id="download-mix-btn" title="Download">
                            Download
                        </ActionButton>
                        <ActionButton
                            className="btn-secondary like-btn"
                            data-action="toggle-like"
                            data-type="mix"
                            hidden
                            icon={icons.heart}
                            id="like-mix-btn"
                            title="Save to favorites"
                        >
                            Save
                        </ActionButton>
                    </div>
                </div>
            </header>
            <div className="track-list" id="mix-detail-tracklist" />
        </>
    );
}
