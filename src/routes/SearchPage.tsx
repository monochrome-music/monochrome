const tabs = [
    { id: 'tracks', layout: 'track-list' },
    { id: 'albums', layout: 'card-grid' },
    { id: 'artists', layout: 'card-grid' },
    { id: 'playlists', layout: 'card-grid' },
    { id: 'podcasts', layout: 'card-grid' },
] as const;

export function SearchPage() {
    return (
        <>
            <h1 className="section-title" id="search-results-title">
                Search results
            </h1>
            <div aria-label="Search result types" className="search-tabs" role="tablist">
                {tabs.map((tab, index) => (
                    <button
                        aria-controls={`search-tab-${tab.id}`}
                        aria-selected={index === 0 ? 'true' : 'false'}
                        className={`search-tab${index === 0 ? ' active' : ''}`}
                        data-tab={tab.id}
                        key={tab.id}
                        role="tab"
                        type="button"
                    >
                        {tab.id[0].toUpperCase() + tab.id.slice(1)}
                    </button>
                ))}
            </div>
            {tabs.map((tab, index) => (
                <div
                    aria-hidden={index === 0 ? 'false' : 'true'}
                    className={`search-tab-content${index === 0 ? ' active' : ''}`}
                    id={`search-tab-${tab.id}`}
                    key={tab.id}
                    role="tabpanel"
                >
                    <div className={tab.layout} id={`search-${tab.id}-container`} />
                </div>
            ))}
        </>
    );
}
