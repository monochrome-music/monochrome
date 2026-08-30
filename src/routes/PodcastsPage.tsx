import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';

const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function PodcastDetailPage() {
    return (
        <>
            <header className="detail-header">
                <img
                    alt=""
                    className="detail-header-image artist"
                    crossOrigin="anonymous"
                    id="podcasts-detail-image"
                    referrerPolicy="no-referrer"
                    src={transparentPixel}
                />
                <div className="detail-header-info">
                    <div className="type">Podcast</div>
                    <h1 className="title" id="podcasts-detail-name" />
                    <div className="meta" id="podcasts-detail-meta" />
                    <div className="detail-header-actions">
                        <button
                            className="btn-primary"
                            id="play-podcasts-btn"
                            title="Play latest episode"
                            type="button"
                        >
                            <Icon svg={icons.play} />
                            <span>Play latest</span>
                        </button>
                    </div>
                </div>
            </header>
            <section className="content-section">
                <h2 className="section-title">Episodes</h2>
                <div className="track-list" id="podcasts-episodes-container" />
            </section>
        </>
    );
}

export function PodcastBrowsePage() {
    return (
        <>
            <h1 className="section-title">Browse podcasts</h1>
            <div aria-label="Podcast categories" className="search-tabs" role="tablist">
                <button aria-selected="true" className="search-tab active" data-tab="trending" role="tab" type="button">
                    Trending
                </button>
                <button aria-selected="false" className="search-tab" data-tab="recent" role="tab" type="button">
                    Recent
                </button>
            </div>
            <div aria-hidden="false" className="search-tab-content active" id="podcasts-tab-trending" role="tabpanel">
                <div className="card-grid" id="podcasts-trending-container" />
            </div>
            <div aria-hidden="true" className="search-tab-content" id="podcasts-tab-recent" role="tabpanel">
                <div className="card-grid" id="podcasts-recent-container" />
            </div>
        </>
    );
}
