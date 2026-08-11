import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';

function PlayerButton({
    id,
    label,
    icon,
    className = '',
    hidden = false,
}: {
    id?: string;
    label: string;
    icon: string;
    className?: string;
    hidden?: boolean;
}) {
    return (
        <button
            aria-label={label}
            className={className || undefined}
            id={id}
            style={hidden ? { display: 'none' } : undefined}
            title={label}
            type="button"
        >
            <Icon svg={icon} />
        </button>
    );
}

export function NowPlayingBar() {
    return (
        <>
            <div className="track-info">
                <img
                    alt="Current track cover"
                    className="cover"
                    crossOrigin="anonymous"
                    fetchPriority="high"
                    referrerPolicy="no-referrer"
                    src="/assets/appicon.png"
                />
                <div className="details">
                    <div className="title">Select a song</div>
                    <div className="album" />
                    <div className="artist" />
                </div>
            </div>

            <div className="player-controls">
                <div aria-live="polite" id="radio-loading-indicator">
                    <div className="animate-spin" />
                    <span>Finding more songs…</span>
                </div>
                <div className="buttons">
                    <PlayerButton icon={icons.shuffle} id="shuffle-btn" label="Shuffle" />
                    <PlayerButton icon={icons.arrowLeftToLine} id="prev-btn" label="Previous" />
                    <button aria-label="Play" className="play-pause-btn" title="Play" type="button" />
                    <PlayerButton icon={icons.arrowRightToLine} id="next-btn" label="Next" />
                    <PlayerButton icon={icons.repeat} id="repeat-btn" label="Repeat" />
                </div>
                <div className="progress-container">
                    <span id="current-time">0:00</span>
                    <div
                        aria-label="Playback position"
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={0}
                        className="progress-bar"
                        id="progress-bar"
                        role="slider"
                        tabIndex={0}
                    >
                        <div className="progress-fill" id="progress-fill" />
                    </div>
                    <span id="total-duration">0:00</span>
                </div>
            </div>

            <div className="volume-controls">
                <div className="player-actions-row">
                    <PlayerButton
                        className="now-playing-party-btn"
                        hidden
                        icon={icons.users}
                        id="now-playing-party-btn"
                        label="Open listening party"
                    />
                    <button
                        aria-label="Save to favorites"
                        className="like-btn"
                        data-action="toggle-like"
                        id="now-playing-like-btn"
                        style={{ display: 'none' }}
                        title="Save to favorites"
                        type="button"
                    />
                    <PlayerButton
                        className="desktop-only"
                        icon={icons.listPlus}
                        id="now-playing-add-playlist-btn"
                        label="Add to playlist"
                    />
                    <PlayerButton
                        className="mix-btn"
                        hidden
                        icon={icons.mix}
                        id="now-playing-mix-btn"
                        label="Track mix"
                    />
                    <PlayerButton hidden icon={icons.micVocal} id="toggle-lyrics-btn" label="Lyrics" />
                    <PlayerButton
                        className="desktop-only"
                        icon={icons.download}
                        id="download-current-btn"
                        label="Download current track"
                    />
                    <PlayerButton icon={icons.cast} id="cast-btn" label="Cast" />
                    <PlayerButton
                        className="mobile-only"
                        icon={icons.listPlus}
                        id="mobile-add-playlist-btn"
                        label="Add to playlist"
                    />
                    <PlayerButton className="mobile-only" icon={icons.clock} id="sleep-timer-btn" label="Sleep timer" />
                    <PlayerButton icon={icons.list} id="queue-btn" label="Queue" />
                </div>
                <div className="volume-slider-row desktop-only">
                    <button aria-label="Mute" id="volume-btn" title="Mute" type="button" />
                    <div
                        aria-label="Volume"
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={100}
                        className="volume-bar"
                        id="volume-bar"
                        role="slider"
                        tabIndex={0}
                    >
                        <div className="volume-fill" id="volume-fill" />
                    </div>
                    <PlayerButton icon={icons.clock} id="sleep-timer-btn-desktop" label="Sleep timer" />
                </div>
            </div>
        </>
    );
}
