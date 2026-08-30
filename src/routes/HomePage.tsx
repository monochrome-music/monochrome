import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';
import type { ComponentChildren } from 'preact';

function RefreshButton({ id, label = 'Refresh' }: { id: string; label?: string }) {
    return (
        <button aria-label={label} className="btn-secondary home-section-action" id={id} title={label} type="button">
            <Icon svg={label === 'Clear history' ? icons.trash : icons.rotateCw} size={16} />
        </button>
    );
}

function HomeSection({
    children,
    title,
    action,
}: {
    children: ComponentChildren;
    title: string;
    action?: ComponentChildren;
}) {
    return (
        <section className="content-section">
            <div className="section-header-row home-section-header">
                <h2 className="section-title">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

export function HomePage() {
    return (
        <>
            <div aria-label="Home views" className="home-header-tabs" role="tablist">
                <button aria-selected="true" className="home-tab active" data-tab="for-you" role="tab" type="button">
                    Home
                </button>
                <button aria-selected="false" className="home-tab" data-tab="explore" role="tab" type="button">
                    Hot &amp; New
                </button>
                <button aria-selected="false" className="home-tab" data-tab="editors-picks" role="tab" type="button">
                    Editor's Picks
                </button>
                <button aria-selected="false" className="home-tab" data-tab="aoty" role="tab" type="button">
                    AOTY
                </button>
            </div>

            <div aria-hidden="false" className="home-view active" id="home-view-for-you" role="tabpanel">
                <div className="home-welcome" id="home-welcome" style={{ display: 'none' }}>
                    <h1>Welcome to Monochrome</h1>
                    <p>You haven't listened to anything yet. Search for your favorite songs to get started.</p>
                </div>

                <div id="home-content" style={{ display: 'none' }}>
                    <HomeSection
                        action={
                            <div className="home-section-actions">
                                <button
                                    className="btn-primary"
                                    id="home-start-infinite-radio-btn"
                                    title="Start infinite radio"
                                    type="button"
                                >
                                    <Icon svg={icons.radio} size={16} />
                                    Start radio
                                </button>
                                <RefreshButton id="refresh-songs-btn" />
                            </div>
                        }
                        title="Recommended songs"
                    >
                        <div className="track-list" id="home-recommended-songs" />
                    </HomeSection>

                    <HomeSection action={<RefreshButton id="refresh-albums-btn" />} title="Recommended albums">
                        <div className="card-grid" id="home-recommended-albums" />
                    </HomeSection>

                    <HomeSection action={<RefreshButton id="refresh-artists-btn" />} title="Recommended artists">
                        <div className="card-grid" id="home-recommended-artists" />
                    </HomeSection>

                    <HomeSection
                        action={<RefreshButton id="clear-recent-btn" label="Clear history" />}
                        title="Jump back in"
                    >
                        <div className="card-grid" id="home-recent-mixed" />
                    </HomeSection>
                </div>
            </div>

            <div
                aria-hidden="true"
                className="home-view"
                id="home-view-explore"
                role="tabpanel"
                style={{ display: 'none' }}
            >
                <div id="explore-content">
                    <div className="card-grid" id="explore-grid" />
                </div>
            </div>

            <div
                aria-hidden="true"
                className="home-view"
                id="home-view-editors-picks"
                role="tabpanel"
                style={{ display: 'none' }}
            >
                <section className="content-section home-editor-picks">
                    <div className="card-grid" id="home-editors-picks" />
                </section>
            </div>

            <div
                aria-hidden="true"
                className="home-view"
                id="home-view-aoty"
                role="tabpanel"
                style={{ display: 'none' }}
            >
                <div id="aoty-content" />
            </div>
        </>
    );
}
