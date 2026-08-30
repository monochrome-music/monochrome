import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';

export function RecentPage() {
    return (
        <>
            <div className="section-header-row route-title-row">
                <h1 className="section-title">Recently played</h1>
                <button className="btn-secondary" id="clear-history-btn" title="Clear history" type="button">
                    <Icon svg={icons.trash} size={16} />
                    <span>Clear</span>
                </button>
            </div>
            <div className="track-list" id="recent-tracks-container" />
        </>
    );
}

export function UnreleasedPage() {
    return <div className="route-content" id="unreleased-content" />;
}
